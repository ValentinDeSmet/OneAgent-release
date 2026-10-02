import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../../registry/src/index.ts";
import { resolvePhysicalPath, sha256 } from "../../shared/src/index.ts";
import { inventoryMemory } from "./memory-inventory.ts";
import { assertRegularFile, copyPrivateFile, describeFile } from "./memory-backup.ts";
import { verifyPrivateMemoryExport } from "./memory-private-export.ts";

const PREFIX = "oneagent-memory";
export interface PrivatePublicationReview {
  version: 1;
  review: string;
  repository: { id: number; name: string; path: string; visibility: "private" };
  branch: string;
  baseRevision: string;
  tree: string;
  configHash: string;
  referenceHash: string;
  archiveHash: string;
  archivePath: string;
  destination: "oneagent-memory";
  changes: Array<{ path: string; action: "add" | "modify" | "delete"; before: string | null; after: string | null }>;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}
export interface PrivatePublicationResult {
  status: "published" | "unchanged";
  repository: string;
  branch: string;
  revision: string;
  review: string;
  localCheckoutNeedsUpdate: boolean;
}
interface GitRequest { cwd: string; args: string[]; input?: string | Buffer; network?: boolean; isolated?: boolean }
/** Transport seam for offline tests. Never accept transport overrides from config or CLI. */
export interface PrivatePublicationTransport {
  git(request: GitRequest): Buffer;
  repository(name: string): Promise<unknown>;
}
interface LocalDestination { path: string; commonDir: string; name: string; branch: string; head: string }
interface Prepared { review: PrivatePublicationReview; gitRoot: string; transport: PrivatePublicationTransport; local: LocalDestination }

/** Read-only to the archive, active memory and destination checkout; no remote write. */
export async function previewPrivatePublication(configPath: string, archive: string, branch: string, transport?: PrivatePublicationTransport): Promise<PrivatePublicationReview> {
  return withPrepared(configPath, archive, branch, transport, async ({ review }) => review);
}

/** The caller must explicitly authorize this exact review digest. No automatic sync. */
export async function publishPrivateMemory(configPath: string, archive: string, branch: string, reviewed: string, transport?: PrivatePublicationTransport): Promise<PrivatePublicationResult> {
  if (!/^[a-f0-9]{64}$/.test(reviewed)) throw new Error("Publication requires --review <digest> from a reviewed preview-private result.");
  return withPrepared(configPath, archive, branch, transport, async (prepared) => {
    const { review, gitRoot, transport: io } = prepared;
    if (review.review !== reviewed) throw new Error("Publication review is stale: archive, destination, branch or configuration changed. Run preview-private and review it again.");
    if (!review.changes.length) return result(review, review.baseRevision, "unchanged");
    const revision = git(io, gitRoot, ["-c", "user.name=OneAgent Backup", "-c", "user.email=oneagent@localhost", "commit-tree", review.tree, "-p", review.baseRevision], `OneAgent private memory backup\n\nReview: ${review.review}\n`);
    // Reinspect after preparation. The lease below additionally protects the
    // remote branch from a concurrent write after this final read.
    const state = await inspectConfiguration(configPath, branch, io);
    if (state.configHash !== review.configHash || state.referenceHash !== review.referenceHash || JSON.stringify(state.local) !== JSON.stringify(prepared.local)) throw new Error("Destination or reference bindings changed during publication; preview again.");
    const remote = await privateRepository(io, prepared.local.name);
    if (remote.id !== review.repository.id) throw new Error("Remote repository identity changed; preview again.");
    if (remoteHead(io, gitRoot, prepared.local.name, branch) !== review.baseRevision) throw new Error("Remote branch changed; update the clone and preview again. No merge was attempted.");
    try {
      // This commit has exactly the reviewed base as its sole parent. The lease
      // is a compare-and-swap, never permission to replace divergent history.
      git(io, gitRoot, ["push", "--porcelain", "--no-verify", "--no-follow-tags", "--recurse-submodules=no", `--force-with-lease=refs/heads/${branch}:${review.baseRevision}`, canonicalUrl(prepared.local.name), `${revision}:refs/heads/${branch}`], undefined, true);
    } catch {
      throw new Error("Private publication failed or its acknowledgement was lost. Inspect the remote branch before retrying; the archive and local checkout are preserved.");
    }
    return result(review, revision, "published");
  });
}
function result(review: PrivatePublicationReview, revision: string, status: "published" | "unchanged"): PrivatePublicationResult {
  return { status, repository: review.repository.name, branch: review.branch, revision, review: review.review, localCheckoutNeedsUpdate: status === "published" };
}

async function withPrepared<T>(configPath: string, archive: string, branch: string, supplied: PrivatePublicationTransport | undefined, action: (prepared: Prepared) => Promise<T>): Promise<T> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oneagent-private-git-"));
  try {
    const io = supplied ?? defaultTransport();
    const archivePath = fs.realpathSync(archive);
    const snapshot = path.join(temporary, "archive");
    fs.mkdirSync(snapshot, { mode: 0o700 });
    const manifest = verifyPrivateMemoryExport(archivePath);
    const originalManifest = describeFile(archivePath, "manifest.json");
    const files = [...manifest.files, originalManifest].sort((a, b) => a.path.localeCompare(b.path, "en"));
    for (const file of files) {
      assertRegularFile(archivePath, file.path);
      copyPrivateFile(path.join(archivePath, file.path), path.join(snapshot, file.path));
      const copied = describeFile(snapshot, file.path);
      if (copied.bytes !== file.bytes || copied.sha256 !== file.sha256) throw new Error("Archive changed during preparation; preview again.");
    }
    verifyPrivateMemoryExport(snapshot);
    const { local, configHash, referenceHash } = await inspectConfiguration(configPath, branch, io);
    const repository = await privateRepository(io, local.name);
    const gitRoot = path.join(temporary, "git");
    fs.mkdirSync(gitRoot, { mode: 0o700 });
    io.git({ cwd: gitRoot, args: ["init", "--bare", "--template="], isolated: true });
    if (remoteHead(io, gitRoot, local.name, branch) !== local.head) throw new Error("Local and remote branch differ. Update or reconcile the clone explicitly before previewing; no merge or reset was attempted.");
    // Isolated object store + index: no filters, hooks, worktree edits or local
    // branch updates. The remote already owns all ancestors of this exact base.
    git(io, gitRoot, ["fetch", "--no-tags", "--no-write-fetch-head", local.path, local.head]);
    git(io, gitRoot, ["read-tree", local.head]);
    const entries = treeEntries(io, gitRoot, local.head);
    const previous = path.join(temporary, "previous");
    fs.mkdirSync(previous, { mode: 0o700 });
    const oldFiles = new Map<string, string>();
    for (const entry of entries) {
      if (entry.mode !== "100644" || entry.type !== "blob" || !entry.path.startsWith(`${PREFIX}/`)) throw new Error("Reserved oneagent-memory path is not a regular private archive.");
      const relative = entry.path.slice(PREFIX.length + 1);
      if (relative.split("/").some((part) => !part || part === "." || part === "..") || relative.includes("\\")) throw new Error("Unsafe path in previous private archive.");
      const bytes = io.git({ cwd: gitRoot, args: ["cat-file", "blob", entry.oid] });
      const target = path.join(previous, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      oldFiles.set(relative, createHash("sha256").update(bytes).digest("hex"));
      git(io, gitRoot, ["update-index", "-z", "--index-info"], `0 ${"0".repeat(40)}\t${entry.path}\0`);
    }
    if (entries.length) verifyPrivateMemoryExport(previous); // Never replace unowned content.
    const changes: PrivatePublicationReview["changes"] = [];
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(snapshot, file.path));
      const oid = git(io, gitRoot, ["hash-object", "-w", "--stdin", "--no-filters"], bytes);
      git(io, gitRoot, ["update-index", "--add", "--cacheinfo", "100644", oid, `${PREFIX}/${file.path}`]);
      const before = oldFiles.get(file.path) ?? null;
      if (before !== file.sha256) changes.push({ path: `${PREFIX}/${file.path}`, action: before === null ? "add" : "modify", before, after: file.sha256 });
      oldFiles.delete(file.path);
    }
    for (const [file, before] of oldFiles) changes.push({ path: `${PREFIX}/${file}`, action: "delete", before, after: null });
    changes.sort((a, b) => a.path.localeCompare(b.path, "en"));
    const body: Omit<PrivatePublicationReview, "review"> = {
      version: 1, repository: { id: repository.id, name: local.name, path: local.path, visibility: "private" },
      branch, baseRevision: local.head, tree: git(io, gitRoot, ["write-tree"]), configHash, referenceHash,
      archiveHash: sha256(JSON.stringify(files)), archivePath, destination: PREFIX, changes, files
    };
    const checked = await inspectConfiguration(configPath, branch, io);
    if (checked.configHash !== configHash || checked.referenceHash !== referenceHash || JSON.stringify(checked.local) !== JSON.stringify(local)) throw new Error("Local state changed during preview; preview again.");
    await actionGuard(io, gitRoot, local, repository.id); // Privacy and remote head must still match at end of preview.
    return await action({ review: { ...body, review: sha256(JSON.stringify(body)) }, gitRoot, transport: io, local });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

async function inspectConfiguration(configPath: string, branch: string, io: PrivatePublicationTransport) {
  const configHash = sha256(fs.readFileSync(configPath, "utf8"));
  const config = loadConfig(configPath);
  const inventory = inventoryMemory(config);
  const blockers = inventory.synchronization.blockers.filter((blocker) => !["private-publication-explicit", "visibility-unverified"].includes(blocker.code));
  if (blockers.length) throw new Error(`Private destination cannot be verified: ${blockers.map((blocker) => blocker.code).join(", ")}.`);
  if (!config.privateBackup) throw new Error("Select a privateBackup destination explicitly.");
  const root = resolvePhysicalPath(config.privateBackup.path);
  const local = inspectDestination(io, root, branch);
  const configuredRemotes = config.products.flatMap((product) => product.repositories.map((repo) => repo.gitRemote)).filter((remote): remote is string => Boolean(remote)).map(githubIdentity).sort();
  if (configuredRemotes.includes(local.name)) throw new Error("Private destination is a configured product remote.");
  const references: Array<{ path: string; commonDir: string; remotes: string[] }> = [];
  for (const reference of [...new Set(inventory.legacyWikiTargets.map((target) => resolvePhysicalPath(target.repositoryPath)))].sort()) {
    const commonDir = commonDirectory(io, reference);
    if (commonDir === local.commonDir) throw new Error("Private destination shares Git storage with a product reference or worktree.");
    const names = git(io, reference, ["remote"]).split("\n").filter(Boolean);
    if (!names.length) throw new Error("A product reference has no verifiable Git remote; audit its identity before publication.");
    const remotes = names.flatMap((name) => [...remoteUrls(io, reference, name, false), ...remoteUrls(io, reference, name, true)]).map(githubIdentity);
    if (remotes.includes(local.name)) throw new Error("Private destination is another clone of a product reference repository.");
    references.push({ path: reference, commonDir, remotes: [...new Set(remotes)].sort() });
  }
  const destination = await privateRepository(io, local.name);
  const identities: Array<{ name: string; id: number }> = [];
  for (const name of [...new Set([...configuredRemotes, ...references.flatMap((reference) => reference.remotes)])].sort()) {
    let metadata: { id?: number; full_name?: string } | null;
    try { metadata = await io.repository(name) as typeof metadata; }
    catch { throw new Error("A product remote identity could not be verified on GitHub; publication is blocked."); }
    if (!metadata || !Number.isSafeInteger(metadata.id) || metadata.id! <= 0 || typeof metadata.full_name !== "string" || metadata.full_name.toLowerCase() !== name) throw new Error("A product remote identity is ambiguous or redirected; update its binding before publication.");
    if (metadata.id === destination.id) throw new Error("Private destination shares the GitHub repository identity of a product reference.");
    identities.push({ name, id: metadata.id! });
  }
  if (sha256(fs.readFileSync(configPath, "utf8")) !== configHash) throw new Error("Configuration changed during inspection.");
  return { local, configHash, referenceHash: sha256(JSON.stringify({ configuredRemotes, references, identities })) };
}
function inspectDestination(io: PrivatePublicationTransport, root: string, branch: string): LocalDestination {
  if (!branch || branch.startsWith("-") || branch === "HEAD") throw new Error("Specify an existing backup branch explicitly.");
  git(io, root, ["check-ref-format", `refs/heads/${branch}`]);
  if (resolvePhysicalPath(git(io, root, ["rev-parse", "--show-toplevel"])) !== root) throw new Error("privateBackup.path must name the repository root.");
  const commonDir = commonDirectory(io, root);
  if (git(io, root, ["rev-parse", "--is-shallow-repository"]) !== "false" || git(io, root, ["replace", "-l"]) || fs.existsSync(path.join(commonDir, "info", "grafts"))) throw new Error("Shallow or rewritten local Git history is not supported for private publication.");
  if (git(io, root, ["symbolic-ref", "--quiet", "HEAD"]) !== `refs/heads/${branch}`) throw new Error("The requested branch must be checked out; detached HEAD is not supported.");
  if (git(io, root, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"])) throw new Error("Private destination has local or ignored files. Use a clean dedicated clone.");
  const names = git(io, root, ["remote"]).split("\n").filter(Boolean);
  if (names.length !== 1 || names[0] !== "origin") throw new Error("Private destination requires exactly one remote named origin.");
  const fetch = remoteUrls(io, root, "origin", false), push = remoteUrls(io, root, "origin", true);
  if (fetch.length !== 1 || push.length !== 1) throw new Error("Multiple fetch or push URLs are not supported for private publication.");
  const name = githubIdentity(fetch[0]);
  if (githubIdentity(push[0]) !== name) throw new Error("Fetch and push URLs identify different repositories.");
  const head = git(io, root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("An existing SHA-1 Git commit is required; initialize the private repo explicitly first.");
  return { path: root, commonDir, name, branch, head };
}
function commonDirectory(io: PrivatePublicationTransport, root: string): string {
  return fs.realpathSync(path.resolve(root, git(io, root, ["rev-parse", "--git-common-dir"])));
}
function remoteUrls(io: PrivatePublicationTransport, root: string, remote: string, push: boolean): string[] {
  return git(io, root, ["remote", "get-url", ...(push ? ["--push"] : []), "--all", remote]).split("\n").filter(Boolean);
}
/** Strict github.com identity. Reject credentials, aliases, other hosts and URL suffixes. */
export function githubIdentity(value: string): string {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(value);
  if (!match || [".", ".."].includes(match[2])) throw new Error("Git remote identity is unsupported or ambiguous; only canonical github.com HTTPS/SSH repositories are supported.");
  return `${match[1]}/${match[2]}`.toLowerCase();
}
function canonicalUrl(name: string): string { return `https://github.com/${name}.git`; }
function git(io: PrivatePublicationTransport, cwd: string, args: string[], input?: string | Buffer, network = false): string {
  return io.git({ cwd, args, input, network }).toString("utf8").trim();
}
function remoteHead(io: PrivatePublicationTransport, cwd: string, name: string, branch: string): string {
  const output = git(io, cwd, ["ls-remote", "--refs", canonicalUrl(name), `refs/heads/${branch}`], undefined, true);
  const lines = output.split("\n");
  if (lines.length !== 1 || !new RegExp(`^[a-f0-9]{40}\\t`).test(output) || output.split("\t")[1] !== `refs/heads/${branch}`) throw new Error("Backup branch is absent or ambiguous on the remote. Create it explicitly first.");
  return output.split("\t")[0];
}
async function privateRepository(io: PrivatePublicationTransport, name: string): Promise<{ id: number }> {
  let value: unknown;
  try { value = await io.repository(name); } catch { throw new Error("GitHub visibility is unknown. Authentication or repository lookup failed; publication is blocked."); }
  const metadata = value as { id?: number; full_name?: string; private?: boolean; visibility?: string; archived?: boolean; disabled?: boolean; fork?: boolean; permissions?: { push?: boolean } } | null;
  if (!metadata || !Number.isSafeInteger(metadata.id) || metadata.id! <= 0 || (typeof metadata.full_name !== "string" || metadata.full_name.toLowerCase() !== name) || metadata.private !== true || metadata.visibility !== "private" || metadata.archived !== false || metadata.disabled !== false || metadata.fork !== false || metadata.permissions?.push !== true) throw new Error("GitHub did not confirm this exact repository as private, writable, active and independent. Publication is blocked.");
  return { id: metadata.id! };
}
async function actionGuard(io: PrivatePublicationTransport, root: string, local: LocalDestination, id: number): Promise<void> {
  if ((await privateRepository(io, local.name)).id !== id) throw new Error("Remote identity changed during preview.");
  if (remoteHead(io, root, local.name, local.branch) !== local.head) throw new Error("Remote branch changed during preview; update the clone and preview again.");
}
function treeEntries(io: PrivatePublicationTransport, root: string, revision: string): Array<{ mode: string; type: string; oid: string; path: string }> {
  const output = io.git({ cwd: root, args: ["ls-tree", "-rz", revision, "--", PREFIX] }).toString("utf8");
  return output.split("\0").filter(Boolean).map((line) => {
    const split = line.indexOf("\t");
    const [mode, type, oid] = line.slice(0, split).split(" ");
    return { mode, type, oid, path: line.slice(split + 1) };
  });
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !["GCM_INTERACTIVE"].includes(key)));
}
function defaultTransport(): PrivatePublicationTransport {
  let token: string | undefined;
  const isolatedRoots = new Set<string>();
  const credentials = (): string => {
    if (token) return token;
    const auth = spawnSync("gh", ["auth", "token", "--hostname", "github.com"], { env: cleanEnvironment(), encoding: "utf8", timeout: 15_000 });
    if (auth.status !== 0 || !auth.stdout.trim() || /\s/.test(auth.stdout.trim())) throw new Error("GitHub authentication unavailable. Authenticate gh for github.com before private publication.");
    token = auth.stdout.trim();
    return token;
  };
  return {
    async repository(name) {
      const response = await fetch(`https://api.github.com/repos/${name}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${credentials()}`, "X-GitHub-Api-Version": "2022-11-28" }
      });
      if (!response.ok) throw new Error("GitHub repository lookup failed.");
      return response.json();
    },
    git({ cwd, args, input, network, isolated: requestedIsolation }) {
      if (requestedIsolation) isolatedRoots.add(cwd);
      const isolated = network || isolatedRoots.has(cwd);
      const env: NodeJS.ProcessEnv = { ...cleanEnvironment(), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1" };
      if (isolated) {
        env.GIT_CONFIG_NOSYSTEM = "1";
        env.GIT_CONFIG_GLOBAL = os.devNull;
        env.GIT_ATTR_NOSYSTEM = "1";
      }
      if (network) {
        // Auth stays in child environment, never argv, returned diagnostics or files.
        env.GIT_CONFIG_COUNT = "1";
        env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraHeader";
        env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${credentials()}`).toString("base64")}`;
      }
      const execution = spawnSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-c", "http.followRedirects=false", ...(network ? ["-c", "credential.helper=", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always"] : []), ...args], {
        env, input, timeout: 30_000, maxBuffer: 64 * 1024 * 1024
      });
      if (execution.status !== 0) throw new Error("Git verification or transport failed. Check repository state and authentication; no automatic reconciliation was attempted.");
      return execution.stdout;
    }
  };
}
