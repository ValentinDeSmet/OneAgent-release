import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createId, createStableId, isPathInside, nowIso, resolvePhysicalPath, sha256, type EntityRecord, type EntityRef, type RepositorySourceProvenance, type SourceRecord, type SourceType } from "../../shared/src/index.ts";
import type { IngestServices } from "./ingest.ts";
import { chunkText } from "./chunk.ts";
import { markStaleSourceRevisions } from "./observations.ts";

type Scope = "wiki" | "bmad";
export interface ReindexFileResult { path: string; sourceType: SourceType; status: "indexed" | "skipped" | "failed"; sourceId?: string; documentId?: string; movedFrom?: string; error?: string }
export interface ReindexRepositoryInput {
  repository: EntityRecord;
  entityRefs?: EntityRef[];
  include?: Scope[];
  maxFileBytes?: number;
  /** Explicit first selection, then pinned by repository_index_state. */
  referenceBranch?: string;
}
export interface ReindexRepositoryResult {
  entity: EntityRef;
  indexed: number;
  skipped: number;
  failed: number;
  complete: boolean;
  missing: number;
  moved: number;
  branch?: string;
  commit?: string;
  lastSuccessfulAt?: string;
  error?: string;
  files: ReindexFileResult[];
}
interface Candidate { path: string; relative: string; scope: Scope; sourceType: SourceType; content: string; hash: string; signature: string }
interface Document { id: string; relative_path: string; scope: Scope; source_id: string | null; availability: string; content_hash: string | null }
interface GitState { branch?: string; commit?: string; tree: Map<string, string> }
interface IndexState { roots_json: string; reference_branch: string | null; last_successful_at: string | null }

/** Read external files in place; publish a complete coherent inventory atomically. */
export async function reindexRepository(services: IngestServices, input: ReindexRepositoryInput): Promise<ReindexRepositoryResult> {
  const repository = input.repository;
  if (repository.kind !== "repository" || !repository.repoPath) throw new Error("Reindexing requires a repository entity with a repoPath.");
  const db = services.db;
  const state = db.db.prepare("SELECT reference_branch,last_successful_at,roots_json FROM repository_index_state WHERE repository_id=?").get(repository.id) as IndexState | undefined;
  const attemptedAt = nowIso();
  const result: ReindexRepositoryResult = { entity: { kind: "repository", id: repository.id }, indexed: 0, skipped: 0, failed: 0, complete: false, missing: 0, moved: 0, lastSuccessfulAt: state?.last_successful_at ?? undefined, files: [] };
  try {
    const root = resolvePhysicalPath(repository.repoPath);
    if (path.resolve(repository.repoPath) !== root) throw new Error("Configure the physical repository path before indexing; symlink aliases require review.");
    if (!fs.statSync(root).isDirectory()) throw new Error("Repository directory is unavailable; previous index retained.");
    const include = [...new Set<Scope>(input.include ?? ["wiki", "bmad"])];
    if (!include.length || include.some((scope) => !["wiki", "bmad"].includes(scope))) throw new Error("Select wiki and/or bmad for indexing.");
    const roots = include.flatMap((scope) => {
      const configured = scope === "wiki" ? repository.wikiRoot : repository.metadata?.specsRoot;
      if (typeof configured !== "string" || !configured) return [];
      const folder = path.resolve(root, configured);
      if (!isPathInside(folder, root) || resolvePhysicalPath(folder) !== folder) throw new Error("Index roots must remain inside the repository without symlinks.");
      return [{ scope, path: folder }];
    });
    if (!roots.length) throw new Error("No selected document root is configured.");
    const pinnedRoots = JSON.parse(state?.roots_json ?? "{}") as Partial<Record<Scope, string>>;
    for (const folder of roots) {
      const relative = path.relative(root, folder.path).split(path.sep).join("/");
      if (pinnedRoots[folder.scope] !== undefined && pinnedRoots[folder.scope] !== relative) throw new Error("Document roots changed; audit the existing index before rebinding. Previous index retained.");
      pinnedRoots[folder.scope] = relative;
    }
    const selectedScopes = new Set(roots.map((item) => item.scope));
    const referenceBranch = input.referenceBranch ?? (typeof repository.metadata?.referenceBranch === "string" ? repository.metadata.referenceBranch : undefined) ?? state?.reference_branch ?? undefined;
    if (state?.reference_branch && referenceBranch !== state.reference_branch) throw new Error("Reference branch is already pinned. A different branch requires a separate repository entity; the existing index is retained.");
    const git = readGit(root, referenceBranch);
    result.branch = git.branch; result.commit = git.commit;
    if (state?.reference_branch && !git.branch) throw new Error("Previously versioned repository no longer has verifiable Git state.");
    const maxBytes = input.maxFileBytes ?? 2_000_000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxFileBytes must be a positive integer.");
    const files = scan(root, roots, maxBytes);
    const owners = services.config.products.filter((product) => product.repositories.some((repo) => repo.id === repository.id && resolvePhysicalPath(repo.path) === root)).map((product) => ({ kind: "product", id: product.id }));
    const refs = [...new Map([{ kind: "repository", id: repository.id }, ...owners, ...(input.entityRefs ?? [])].map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
    const documents = db.db.prepare(`SELECT d.*,s.content_hash FROM repository_documents d LEFT JOIN sources s ON s.id=d.source_id WHERE d.repository_id=?`).all(repository.id) as unknown as Document[];
    const byPath = new Map(documents.map((doc) => [doc.relative_path, doc]));
    const paths = new Set(files.map((file) => file.relative));
    // A renamed file is reconciled only when both sides of an exact-content
    // match are unique. Changed/ambiguous moves stay separate, preserving history.
    const missing = documents.filter((doc) => selectedScopes.has(doc.scope) && roots.some((folder) => folder.scope === doc.scope && isPathInside(path.join(root, doc.relative_path), folder.path)) && !paths.has(doc.relative_path));
    const moved = new Set<string>();
    const nextFiles: ReindexFileResult[] = [];
    db.runInTransaction(() => {
      for (const file of files) {
        let document = byPath.get(file.relative);
        let movedFrom: string | undefined;
        if (!document) {
          const matching = missing.filter((doc) => doc.availability === "available" && doc.content_hash === file.hash && !moved.has(doc.id));
          const candidates = files.filter((candidate) => !byPath.has(candidate.relative) && candidate.hash === file.hash);
          if (matching.length === 1 && candidates.length === 1) {
            document = matching[0]; movedFrom = document.relative_path; moved.add(document.id);
          }
        }
        const documentId = document?.id ?? createId("document");
        const logicalKey = `repository-document:${documentId}`;
        const contentState: RepositorySourceProvenance["contentState"] = !git.commit ? "unversioned" : !git.tree.has(file.relative) ? "untracked"
          : git.tree.get(file.relative) === gitBlob(file.content, git.commit.length) ? "committed" : "modified";
        const previous = document?.source_id ? db.getSource(document.source_id) : undefined;
        const provenance = previous?.repositoryProvenance as RepositorySourceProvenance | undefined;
        const samePlacement = previous && JSON.stringify(db.listEntityRefsForSource(String(previous.id)).map((ref) => `${ref.kind}:${ref.id}`).sort()) === JSON.stringify(refs.map((ref) => `${ref.kind}:${ref.id}`).sort());
        const unchanged = samePlacement && previous?.rawPath === file.path && previous.sourceType === file.sourceType && previous?.status === "indexed" && previous.contentHash === file.hash && provenance?.relativePath === file.relative && provenance.branch === git.branch && provenance.commit === git.commit && provenance.contentState === contentState;
        const sourceId = unchanged ? String(previous!.id) : createStableId("src", [logicalKey, file.hash, file.relative, git.branch ?? "", git.commit ?? "", contentState, document?.source_id ?? "first"]);
        // Save the identity before attaching its immutable source provenance.
        db.db.prepare(`INSERT INTO repository_documents(id,repository_id,relative_path,scope,source_id,availability,last_seen_at)
          VALUES(?,?,?,?,NULL,'available',?) ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path,scope=excluded.scope,availability='available',last_seen_at=excluded.last_seen_at`).run(documentId, repository.id, file.relative, file.scope, attemptedAt);
        const source: SourceRecord = { id: sourceId, logicalKey, title: file.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file.path), sourceType: file.sourceType,
          origin: "repository", originUri: file.path, rawPath: file.path, contentHash: file.hash, capturedAt: attemptedAt, language: "markdown", status: "indexing" };
        if (!unchanged) {
          db.insertSource(source, refs);
          db.insertChunks(source, chunkText(sourceId, file.content));
          db.db.prepare(`INSERT INTO repository_source_provenance(source_id,document_id,repository_id,relative_path,branch,commit_hash,content_state,indexed_at) VALUES(?,?,?,?,?,?,?,?)`).run(sourceId, documentId, repository.id, file.relative, git.branch ?? null, git.commit ?? null, contentState, attemptedAt);
          db.activateSourceRevision(sourceId);
        } else {
          // Refill deliberately omitted private-export chunks without rewriting
          // cited text or the original revision provenance.
          db.insertChunks(source, chunkText(sourceId, file.content));
        }
        db.db.prepare("UPDATE repository_documents SET source_id=? WHERE id=?").run(sourceId, documentId);
        // Retire legacy path-only index projections only for files actually read.
        // Their identities, evidence and links remain accessible in history.
        db.db.prepare("UPDATE sources SET status='superseded',superseded_by=?,updated_at=? WHERE logical_key=? AND id<>? AND status='indexed'").run(sourceId, attemptedAt, file.path, sourceId);
        nextFiles.push({ path: file.path, sourceType: file.sourceType, status: unchanged ? "skipped" : "indexed", sourceId, documentId, movedFrom });
      }
      for (const document of missing.filter((doc) => !moved.has(doc.id))) {
        db.db.prepare("UPDATE repository_documents SET availability='missing' WHERE id=?").run(document.id);
        if (document.source_id) db.db.prepare("UPDATE sources SET status='missing',updated_at=? WHERE id=? AND status='indexed'").run(attemptedAt, document.source_id);
      }
      markStaleSourceRevisions(db);
      // No partial index survives a read, Git, SQL or coherence failure.
      const after = scan(root, roots, maxBytes);
      if (fingerprint(files) !== fingerprint(after) || gitFingerprint(git) !== gitFingerprint(readGit(root, referenceBranch))) throw new Error("Repository changed during indexing; retry after edits finish. Previous index retained.");
      db.db.prepare(`INSERT INTO repository_index_state(repository_id,reference_branch,roots_json,last_successful_at,successful_commit,last_attempt_at,last_attempt_status,error)
        VALUES(?,?,?,?,?,?,'complete',NULL) ON CONFLICT(repository_id) DO UPDATE SET reference_branch=excluded.reference_branch,roots_json=excluded.roots_json,last_successful_at=excluded.last_successful_at,
        successful_commit=excluded.successful_commit,last_attempt_at=excluded.last_attempt_at,last_attempt_status='complete',error=NULL`).run(repository.id, git.branch ?? null, JSON.stringify(pinnedRoots), attemptedAt, git.commit ?? null, attemptedAt);
    });
    result.files = nextFiles;
    result.indexed = nextFiles.filter((file) => file.status === "indexed").length;
    result.skipped = nextFiles.filter((file) => file.status === "skipped").length;
    result.missing = missing.filter((doc) => !moved.has(doc.id)).length;
    result.moved = moved.size; result.complete = true; result.lastSuccessfulAt = attemptedAt;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Repository indexing failed.";
    result.failed = 1;
    db.db.prepare(`INSERT INTO repository_index_state(repository_id,last_attempt_at,last_attempt_status,error) VALUES(?,?,'failed',?)
      ON CONFLICT(repository_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_attempt_status='failed',error=excluded.error`).run(repository.id, attemptedAt, result.error);
  }
  return result;
}

function scan(root: string, roots: Array<{ path: string; scope: Scope }>, maxBytes: number): Candidate[] {
  const found = new Map<string, Candidate>();
  const visit = (folder: string, scope: Scope): void => {
    if (fs.lstatSync(folder).isSymbolicLink() || !fs.statSync(folder).isDirectory()) throw new Error("Document root is unavailable or redirected; previous index retained.");
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symbolic link inside an index root requires review; previous index retained.");
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) visit(file, scope);
        continue;
      }
      if (!entry.isFile()) throw new Error("Non-regular file inside an index root; previous index retained.");
      const extension = path.extname(file).toLowerCase();
      if (![".md", ".markdown", ".txt", ".json", ".yaml", ".yml"].includes(extension) || found.has(file)) continue;
      const before = signature(file);
      if (fs.statSync(file).size > maxBytes) throw new Error(`Document ${path.relative(root, file)} exceeds the indexing size limit; previous index retained.`);
      const bytes = fs.readFileSync(file), content = bytes.toString("utf8");
      if (!Buffer.from(content).equals(bytes)) throw new Error(`Document ${path.relative(root, file)} is not valid UTF-8; previous index retained.`);
      if (before !== signature(file)) throw new Error("A document changed while being read; previous index retained.");
      found.set(file, { path: file, relative: path.relative(root, file).split(path.sep).join("/"), scope, sourceType: extension === ".json" ? "api_contract" : scope === "wiki" ? "wiki_page" : "bmad_artifact", content, hash: sha256(content), signature: before });
    }
  };
  for (const folder of roots) visit(folder.path, folder.scope);
  return [...found.values()].sort((a, b) => a.relative.localeCompare(b.relative));
}
function signature(file: string): string {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Document changed type during indexing.");
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}
function fingerprint(files: Candidate[]): string { return sha256(JSON.stringify(files.map((file) => [file.relative, file.hash, file.signature, file.scope]))); }
function gitFingerprint(git: GitState): string { return JSON.stringify([git.branch, git.commit]); }
function gitBlob(content: string, oidLength: number): string {
  const bytes = Buffer.from(content);
  return createHash(oidLength === 64 ? "sha256" : "sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
function gitCommand(root: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const child = spawnSync("git", ["-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" }, encoding: "utf8", timeout: 15_000, maxBuffer: 32 * 1024 * 1024 });
  if (child.status !== 0) throw new Error("Git state is unavailable or HEAD is detached/uninitialized; previous index retained.");
  return child.stdout;
}
function readGit(root: string, referenceBranch?: string): GitState {
  let ancestor = root;
  while (!hasGitMarker(ancestor)) {
    if (path.dirname(ancestor) === ancestor) {
      if (referenceBranch) throw new Error("A reference branch was selected but no Git repository is available.");
      return { tree: new Map() };
    }
    ancestor = path.dirname(ancestor);
  }
  if (ancestor !== root || resolvePhysicalPath(gitCommand(root, ["rev-parse", "--show-toplevel"]).trim()) !== root) throw new Error("repoPath must identify the Git worktree root.");
  if (!referenceBranch) throw new Error("Select a reference branch explicitly with --branch or repository metadata.referenceBranch before indexing Git documents.");
  const branch = gitCommand(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
  if (branch !== referenceBranch) throw new Error("Checked-out branch differs from the selected reference branch; previous index retained.");
  const commit = gitCommand(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error("Invalid Git commit identity.");
  const tree = new Map<string, string>();
  for (const line of gitCommand(root, ["ls-tree", "-rz", "--full-tree", commit]).split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t"), [mode, type, oid] = line.slice(0, tab).split(" ");
    if (type === "blob" && ["100644", "100755"].includes(mode)) tree.set(line.slice(tab + 1), oid);
  }
  return { branch, commit, tree };
}

function hasGitMarker(root: string): boolean {
  try { fs.lstatSync(path.join(root, ".git")); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
