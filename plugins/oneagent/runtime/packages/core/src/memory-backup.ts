import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireMemoryLock, isPathInside, resolvePhysicalPath, type WorkMemoryConfig } from "../../shared/src/index.ts";
import { loadConfig } from "../../registry/src/index.ts";
import { copyStableDatabase } from "../../storage/src/snapshot.ts";

export interface BackupFile { path: string; bytes: number; sha256: string }
export interface MemoryBackupManifest {
  format: "oneagent-local-recovery";
  version: 1;
  createdAt: string;
  publishable: false;
  indexedContent: "retained";
  originalPaths: { captures: string; wiki: string };
  files: BackupFile[];
}

interface InputFile { source: string; target: string; signature: string }

/** Local recovery only. This format must never be sent to a private Git remote as-is. */
export function backupMemory(configPath: string, destination: string): MemoryBackupManifest {
  let config = loadConfig(configPath);
  if (!fs.existsSync(config.storage.databasePath)) throw new Error("Cannot back up a missing database. Initialize the memory first.");
  const release = acquireMemoryLock(config.storage.databasePath, { exclusive: true });
  let temporaryRoot: string | undefined;
  let output: string | undefined;
  let complete = false;
  try {
    // Reload under the operation lock, including any config change just finished
    // by a CLI command. A concurrent rebind must not bypass the database lock.
    const lockedDatabase = config.storage.databasePath;
    const configSignature = signature(configPath);
    config = loadConfig(configPath);
    if (config.storage.databasePath !== lockedDatabase) throw new Error("Memory configuration changed; retry backup.");
    const captures = path.resolve(config.workspaceRoot, config.workspace.memoryRoot, "captures");
    const wiki = path.join(config.workspaceRoot, "wiki");
    const originalPaths = { captures, wiki };
    const before = collectInputs(config, originalPaths);
    if (before.find((file) => file.target === "configuration-source")?.signature !== configSignature) throw new Error("Memory configuration changed; retry backup.");
    const beforeDatabase = databaseSignatures(config.storage.databasePath);
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oneagent-backup-"));
    const copy = copyStableDatabase(config.storage.databasePath, temporaryRoot);
    const db = new DatabaseSync(copy);
    try {
      db.exec("PRAGMA trusted_schema=OFF;");
      checkDatabase(db);
      assertCaptureCoverage(db, before, captures);
      assertPrivateSourceCoverage(db, before, originalPaths);
      // Entity-only repository bindings are as important as configured repos.
      const entityRepos = db.prepare("SELECT repo_path FROM entities WHERE repo_path IS NOT NULL AND repo_path <> ''").all() as Array<{ repo_path: string }>;
      const persistedRepos = db.prepare("SELECT path FROM repositories WHERE path <> ''").all() as Array<{ path: string }>;
      const repositoryPaths = config.products.flatMap((product) => product.repositories.map((repository) => repository.path));
      output = reserveDestination(destination, [config.workspaceRoot, config.storage.databasePath, ...(config.privateBackup ? [config.privateBackup.path] : []), ...repositoryPaths, ...persistedRepos.map((repository) => path.resolve(config.workspaceRoot, repository.path)), ...entityRepos.map((entity) => path.resolve(config.workspaceRoot, entity.repo_path))]);
      const databaseTarget = path.join(output, "database.sqlite");
      // VACUUM creates a standalone frozen database, never an active DB/WAL pair.
      db.prepare("VACUUM INTO ?").run(databaseTarget);
      fs.chmodSync(databaseTarget, 0o600);
    } finally { db.close(); }
    for (const file of before.filter((file) => file.target !== "configuration-source")) copyPrivateFile(file.source, path.join(output, file.target));
    const configContent = recoveryConfig(config);
    writePrivate(path.join(output, "config.json"), JSON.stringify(configContent, null, 2) + "\n");
    // File editors outside the runtime do not honor the lock. Fail the backup
    // if the file set, config, DB or WAL changed at any time while copying.
    const after = collectInputs(config, originalPaths);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(beforeDatabase) !== JSON.stringify(databaseSignatures(config.storage.databasePath))) {
      throw new Error("Memory changed during backup; retry after edits finish.");
    }
    const files = ["database.sqlite", "config.json", ...before.filter((file) => file.target !== "configuration-source").map((file) => file.target)]
      .sort().map((relative) => describeFile(output!, relative));
    const manifest: MemoryBackupManifest = {
      format: "oneagent-local-recovery", version: 1, createdAt: new Date().toISOString(),
      publishable: false, indexedContent: "retained", originalPaths, files
    };
    writePrivate(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    verifyMemoryBackup(output);
    complete = true;
    return manifest;
  } finally {
    try {
      if (output && !complete) fs.rmSync(output, { recursive: true, force: true });
      if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } finally { release(); }
  }
}

export function verifyMemoryBackup(directory: string): MemoryBackupManifest {
  const root = fs.realpathSync(directory);
  assertRegularFile(root, "manifest.json");
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const manifest = validateManifest(raw);
  for (const file of manifest.files) {
    assertRegularFile(root, file.path);
    const actual = describeFile(root, file.path);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error(`Backup integrity check failed: ${file.path}`);
  }
  // Reject WAL before SQLite opens the bundle: even readOnly WAL connections
  // can create sidecars, which a verifier must not add to its input.
  const header = Buffer.alloc(20);
  const handle = fs.openSync(path.join(root, "database.sqlite"), "r");
  try { fs.readSync(handle, header, 0, header.length, 0); } finally { fs.closeSync(handle); }
  if (header.toString("utf8", 0, 16) !== "SQLite format 3\0" || header[18] !== 1 || header[19] !== 1) {
    throw new Error("Backup database must be a standalone SQLite database, without WAL.");
  }
  const db = new DatabaseSync(path.join(root, "database.sqlite"), { readOnly: true });
  try {
    db.exec("PRAGMA trusted_schema=OFF;");
    const journalMode = String(Object.values(db.prepare("PRAGMA journal_mode").get() ?? {})[0]);
    if (journalMode === "wal") throw new Error("Backup database must be standalone, without WAL.");
    checkDatabase(db);
    const privateFiles = manifest.files.flatMap((file): InputFile[] => {
      const prefix = file.path.startsWith("captures/") ? "captures" : file.path.startsWith("wiki/") ? "wiki" : undefined;
      return prefix ? [{ source: path.join(manifest.originalPaths[prefix], file.path.slice(prefix.length + 1)), target: file.path, signature: "" }] : [];
    });
    assertCaptureCoverage(db, privateFiles, manifest.originalPaths.captures);
    assertPrivateSourceCoverage(db, privateFiles, manifest.originalPaths);
  } finally { db.close(); }
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")) as Record<string, unknown>;
  const workspace = config.workspace as Record<string, unknown> | undefined;
  const storage = config.storage as Record<string, unknown> | undefined;
  if (workspace?.memoryRoot !== ".work-memory" || storage?.databasePath !== ".work-memory/work-memory.db" || "embeddings" in config) {
    throw new Error("Invalid recovery configuration paths or credentials section.");
  }
  return manifest;
}

/** Restore only to a newly reserved directory. Never open/migrate the source memory. */
export function restoreMemoryBackup(directory: string, destination: string): { root: string; configPath: string } {
  const root = fs.realpathSync(directory);
  const manifest = verifyMemoryBackup(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")) as { products?: Array<{ repositories?: Array<{ path?: string }> }> };
  const repoPaths = (config.products ?? []).flatMap((product) => (product.repositories ?? []).flatMap((repository) => typeof repository.path === "string" ? [repository.path] : []));
  const output = reserveDestination(destination, [root, path.dirname(manifest.originalPaths.wiki), manifest.originalPaths.captures, ...repoPaths]);
  let complete = false;
  try {
    for (const file of manifest.files) {
      const target = restoredPath(output, file.path);
      assertRegularFile(root, file.path);
      copyPrivateFile(path.join(root, file.path), target);
      // Check the copied bytes too, so edits to a bundle during restore cannot
      // sneak past the initial verification.
      if (hashFile(target) !== file.sha256 || fs.statSync(target).size !== file.bytes) throw new Error(`Backup changed during restore: ${file.path}`);
    }
    const databasePath = path.join(output, ".work-memory", "work-memory.db");
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;");
      relocatePrivatePaths(db, manifest.originalPaths, output);
      // Indexes are derived; rebuilding verifies the restored content is usable.
      for (const table of ["source_chunks_fts", "entities_fts", "observations_fts"]) {
        db.exec(`INSERT INTO ${table}(${table}) VALUES ('rebuild');`);
      }
      checkDatabase(db);
      db.exec("COMMIT;");
    } finally { db.close(); }
    complete = true;
    return { root: output, configPath: path.join(output, ".work-memory", "config.json") };
  } finally {
    if (!complete) fs.rmSync(output, { recursive: true, force: true });
  }
}

function recoveryConfig(config: WorkMemoryConfig): Record<string, unknown> {
  return {
    workspace: { name: config.workspace.name, memoryRoot: ".work-memory", self: config.workspace.self },
    storage: { databasePath: ".work-memory/work-memory.db" },
    entities: config.entities, entityLinks: config.entityLinks,
    products: config.products.map((product) => ({ ...product, repositories: product.repositories.map((repository) => ({
      id: repository.id, role: repository.role, purpose: "product-reference", path: repository.path, wikiRoot: repository.wikiRoot, specsRoot: repository.specsRoot
    })) }))
  };
}

function collectInputs(config: WorkMemoryConfig, roots: { captures: string; wiki: string }): InputFile[] {
  const result: InputFile[] = [];
  const visit = (directory: string, prefix: string): void => {
    if (!fs.existsSync(directory)) return;
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Backup does not follow symbolic links: ${directory}`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = path.join(directory, entry.name);
      const target = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Backup does not follow symbolic links: ${source}`);
      if (entry.isDirectory()) visit(source, target);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push({ source, target, signature: signature(source)! });
    }
  };
  visit(roots.captures, "captures");
  visit(roots.wiki, "wiki");
  const taxonomy = path.join(config.workspaceRoot, ".work-memory", "taxonomy.json");
  for (const [source, target] of [[config.configPath, "configuration-source"], [taxonomy, "taxonomy.json"]]) {
    if (fs.existsSync(source)) {
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Backup does not follow symbolic links: ${source}`);
      result.push({ source, target, signature: signature(source)! });
    }
  }
  return result;
}

function assertCaptureCoverage(db: DatabaseSync, files: InputFile[], capturesRoot: string): void {
  const copied = new Set(files.map((file) => path.resolve(file.source)));
  const captures = db.prepare("SELECT id, path FROM captures").all() as Array<{ id: string; path: string | null }>;
  for (const capture of captures) {
    if (!capture.path || !isPathInside(capture.path, capturesRoot) || !copied.has(path.resolve(capture.path))) {
      throw new Error(`Capture ${capture.id} has no recoverable Markdown file inside the memory. Repair it before backup.`);
    }
  }
}

function assertPrivateSourceCoverage(db: DatabaseSync, files: InputFile[], roots: { captures: string; wiki: string }): void {
  const copied = new Set(files.map((file) => path.resolve(file.source)));
  const sources = db.prepare("SELECT id, raw_path FROM sources WHERE status='indexed' AND raw_path IS NOT NULL").all() as Array<{ id: string; raw_path: string }>;
  for (const source of sources) {
    if ([roots.captures, roots.wiki].some((root) => isPathInside(source.raw_path, root)) && !copied.has(path.resolve(source.raw_path))) {
      throw new Error(`Private source ${source.id} is missing from the backup's Markdown inventory.`);
    }
  }
}

function checkDatabase(db: DatabaseSync): void {
  const checks = db.prepare("PRAGMA quick_check").all();
  if (checks.length !== 1 || Object.values(checks[0])[0] !== "ok") throw new Error("Database integrity check failed.");
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database has broken foreign key references.");
}

function relocatePrivatePaths(db: DatabaseSync, old: { captures: string; wiki: string }, root: string): void {
  const map = (value: string | null): string | null => {
    if (!value) return value;
    const uri = value.startsWith("file:");
    let local: string;
    try { local = uri ? fileURLToPath(value) : value; } catch { return value; }
    if (!path.isAbsolute(local)) return value;
    for (const [before, after] of [[old.captures, path.join(root, ".work-memory", "captures")], [old.wiki, path.join(root, "wiki")]]) {
      if (isPathInside(local, before)) {
        const next = path.join(after, path.relative(before, local));
        return uri ? pathToFileURL(next).href : next;
      }
    }
    return value;
  };
  for (const row of db.prepare("SELECT id, path FROM captures").all() as Array<{ id: string; path: string | null }>) {
    db.prepare("UPDATE captures SET path=? WHERE id=?").run(map(row.path), row.id);
  }
  for (const row of db.prepare("SELECT id, raw_path, origin_uri, logical_key FROM sources").all() as Array<{ id: string; raw_path: string | null; origin_uri: string | null; logical_key: string | null }>) {
    db.prepare("UPDATE sources SET raw_path=?, origin_uri=?, logical_key=? WHERE id=?").run(map(row.raw_path), map(row.origin_uri), map(row.logical_key), row.id);
  }
}

function validateManifest(value: unknown): MemoryBackupManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid backup manifest.");
  const manifest = value as MemoryBackupManifest;
  if (manifest.format !== "oneagent-local-recovery" || manifest.version !== 1 || manifest.publishable !== false || manifest.indexedContent !== "retained" || !Array.isArray(manifest.files)) throw new Error("Unsupported backup format.");
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Invalid backup date.");
  if (!manifest.originalPaths || ![manifest.originalPaths.captures, manifest.originalPaths.wiki].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new Error("Invalid original memory paths.");
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !validBackupPath(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid or duplicate file in backup manifest.");
    seen.add(file.path);
  }
  if (!seen.has("database.sqlite") || !seen.has("config.json")) throw new Error("Backup is missing its database or configuration.");
  return manifest;
}

function validBackupPath(relative: string): boolean {
  if (relative.includes("\\") || relative.includes("\0") || relative.split("/").some((part) => part === ".." || part === "." || !part)) return false;
  return ["database.sqlite", "config.json", "taxonomy.json"].includes(relative) || /^(captures|wiki)\/.+\.md$/i.test(relative);
}

export function assertRegularFile(root: string, relative: string): void {
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error(`Unsafe backup file: ${relative}`);
  }
}

export function reserveDestination(destination: string, forbiddenRoots: string[]): string {
  const requested = path.resolve(destination);
  // Require an existing parent so canonicalization cannot overlook a symlink.
  const parent = fs.realpathSync(path.dirname(requested));
  const target = path.join(parent, path.basename(requested));
  for (const root of forbiddenRoots) {
    const canonical = resolvePhysicalPath(root);
    if (isPathInside(target, canonical) || isPathInside(canonical, target)) throw new Error("Choose a new destination outside the source memory, backup and configured repositories.");
  }
  fs.mkdirSync(target, { mode: 0o700 }); // EEXIST also protects empty directories.
  return target;
}

function restoredPath(root: string, relative: string): string {
  if (relative === "database.sqlite") return path.join(root, ".work-memory", "work-memory.db");
  if (relative === "config.json" || relative === "taxonomy.json" || relative.startsWith("captures/")) return path.join(root, ".work-memory", relative);
  return path.join(root, relative);
}

function signature(file: string): string | null {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function databaseSignatures(database: string): Array<string | null> {
  return ["", "-wal", "-journal"].map((suffix) => signature(database + suffix));
}

export function hashFile(file: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  const descriptor = fs.openSync(file, "r");
  try {
    let bytes: number;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

export function describeFile(root: string, relative: string): BackupFile {
  const file = path.join(root, relative);
  return { path: relative, bytes: fs.statSync(file).size, sha256: hashFile(file) };
}

export function copyPrivateFile(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, 0o600);
}

export function writePrivate(file: string, text: string): void {
  fs.writeFileSync(file, text, { flag: "wx", mode: 0o600 });
}
