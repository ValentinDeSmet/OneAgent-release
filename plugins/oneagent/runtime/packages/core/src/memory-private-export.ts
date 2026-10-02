import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isPathInside, resolvePhysicalPath } from "../../shared/src/index.ts";
import { loadConfig } from "../../registry/src/index.ts";
import { INITIAL_SCHEMA_SQL } from "../../storage/src/schema.ts";
import {
  backupMemory, verifyMemoryBackup, restoreMemoryBackup, assertRegularFile,
  copyPrivateFile, describeFile, hashFile, reserveDestination, writePrivate,
  type BackupFile, type MemoryBackupManifest
} from "./memory-backup.ts";

type Cell = string | number | null;
type Row = Record<string, Cell>;
interface TableData { columns: string[]; rows: Cell[][] }
export interface PrivateExportPolicy {
  externalEvidence: "retain-cited";
  contextPacks: "retain" | "omit";
}
interface ExportData {
  version: 1 | 2 | 3;
  tables: Record<string, TableData>;
  privateSourceIds: string[];
  externalSourceIds: string[];
  omittedExternalChunks: Array<{ id: string; sourceId: string; contentHash: string; chunkIndex: number }>;
}
export interface PrivateExportManifest {
  format: "oneagent-private-export";
  version: 1 | 2 | 3;
  createdAt: string;
  publicationReady: false;
  policy: PrivateExportPolicy;
  originalPaths: MemoryBackupManifest["originalPaths"];
  coverage: {
    tables: Array<{ name: string; originalRows: number; exportedRows: number }>;
    excludedDerivedTables: string[];
    externalSources: number;
    retainedExternalChunks: number;
    omittedExternalChunks: number;
  };
  files: BackupFile[];
}

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const KNOWN_UI_STATE = new Set(["agentContextScope", "activeContextView", "graphViewPresets", "graphFilters", "cockpitTheme", "privateExportCoverage"]);
const DERIVED = new Set(["source_chunks_fts", "entities_fts", "observations_fts", "source_chunk_embeddings"]);

/** Prepare a reviewable, structured archive from the coherent local recovery snapshot. */
export function exportPrivateMemory(configPath: string, destination: string, policy: PrivateExportPolicy): PrivateExportManifest {
  validatePolicy(policy);
  const config = loadConfig(configPath);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oneagent-private-export-"));
  let output: string | undefined;
  let complete = false;
  try {
    const snapshot = path.join(temporary, "snapshot");
    const recovery = backupMemory(configPath, snapshot);
    const snapshotConfig = JSON.parse(fs.readFileSync(path.join(snapshot, "config.json"), "utf8")) as { products: Array<{ repositories: Array<{ path: string }> }> };
    const configuredRepositories = snapshotConfig.products.flatMap((product) => product.repositories.map((repository) => repository.path));
    const db = new DatabaseSync(path.join(snapshot, "database.sqlite"), { readOnly: true });
    let data: ExportData;
    let coverage: PrivateExportManifest["coverage"];
    let repositoryPaths: string[];
    try {
      db.exec("PRAGMA trusted_schema=OFF;");
      const tables = exportTables(db);
      validateUiState(tables);
      repositoryPaths = referencePaths(tables);
      const classified = classifySources(tables, recovery.originalPaths, repositoryPaths);
      const external = new Set(classified.externalSourceIds);
      // Preserve complete cited chunks: replacing their text would break immutable
      // provenance and make a later reindex of the same revision invalid.
      const cited = citedChunkIds(tables, policy.contextPacks === "retain");
      const omittedExternalChunks: ExportData["omittedExternalChunks"] = [];
      const before = Object.entries(tables).map(([name, table]) => ({ name, originalRows: table.rows.length }));
      filterRows(tables.source_chunks, (chunk) => {
        if (!external.has(String(chunk.source_id)) || cited.has(String(chunk.id))) return true;
        omittedExternalChunks.push({ id: String(chunk.id), sourceId: String(chunk.source_id), contentHash: String(chunk.content_hash), chunkIndex: Number(chunk.chunk_index) });
        return false;
      });
      if (policy.contextPacks === "omit") tables.context_packs.rows = [];
      data = { version: 3, tables, ...classified, omittedExternalChunks };
      coverage = {
        tables: before.map((table) => ({ ...table, exportedRows: tables[table.name].rows.length })),
        excludedDerivedTables: tableNames(db).filter((table) => DERIVED.has(table.name)).map((table) => table.name).sort(),
        externalSources: external.size,
        retainedExternalChunks: rows(tables.source_chunks).filter((chunk) => external.has(String(chunk.source_id))).length,
        omittedExternalChunks: omittedExternalChunks.length
      };
    } finally { db.close(); }
    const staged = path.join(temporary, "archive");
    fs.mkdirSync(staged, { mode: 0o700 });
    for (const file of recovery.files.filter((entry) => entry.path !== "database.sqlite")) {
      copyPrivateFile(path.join(snapshot, file.path), path.join(staged, file.path));
    }
    writePrivate(path.join(staged, "memory.json"), JSON.stringify(data, null, 2) + "\n");
    const files = [...recovery.files.filter((file) => file.path !== "database.sqlite").map((file) => file.path), "memory.json"].sort().map((file) => describeFile(staged, file));
    // Do not claim an exhaustive secret detector. Known configured values and
    // recognizable credentials fail closed; free text still requires review.
    for (const file of files) assertNoCredentials(fs.readFileSync(path.join(staged, file.path), "utf8"), config.embeddings.apiKey);
    const manifest: PrivateExportManifest = {
      format: "oneagent-private-export", version: 3, createdAt: recovery.createdAt,
      publicationReady: false, policy, originalPaths: recovery.originalPaths, coverage, files
    };
    writePrivate(path.join(staged, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    verifyPrivateMemoryExport(staged);
    output = reserveDestination(destination, [config.workspaceRoot, config.storage.databasePath, recovery.originalPaths.captures, path.dirname(recovery.originalPaths.wiki), ...configuredRepositories,
      ...(config.privateBackup ? [config.privateBackup.path] : []), ...repositoryPaths]);
    assertOutsideGit(output);
    for (const file of [...files.map((entry) => entry.path), "manifest.json"]) copyPrivateFile(path.join(staged, file), path.join(output, file));
    verifyPrivateMemoryExport(output);
    complete = true;
    return manifest;
  } finally {
    if (output && !complete) fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Verify hashes and restore the structured rows into a disposable trusted schema. */
export function verifyPrivateMemoryExport(directory: string): PrivateExportManifest {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oneagent-private-verify-"));
  try { return materializeRecovery(directory, path.join(temporary, "recovery")); }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export function restorePrivateMemoryExport(directory: string, destination: string): { root: string; configPath: string; externalIndexNeedsRebuild: boolean } {
  const archive = fs.realpathSync(directory);
  const target = resolvePhysicalPath(destination);
  if (isPathInside(target, archive) || isPathInside(archive, target)) throw new Error("Restore outside the export archive.");
  assertOutsideGit(target);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oneagent-private-restore-"));
  try {
    const recovery = path.join(temporary, "recovery");
    const manifest = materializeRecovery(archive, recovery);
    const db = new DatabaseSync(path.join(recovery, "database.sqlite"), { readOnly: true });
    let externalIndexNeedsRebuild = false;
    try {
      const coverageRow = db.prepare("SELECT value_json FROM ui_state WHERE key='privateExportCoverage'").get();
      externalIndexNeedsRebuild = coverageRow ? JSON.parse(String(coverageRow.value_json)).omittedExternalChunks.length > 0 : false;
      const bindings = [...db.prepare("SELECT path AS value FROM repositories").all(), ...db.prepare("SELECT repo_path AS value FROM entities WHERE repo_path IS NOT NULL").all()];
      for (const binding of bindings) {
        if (typeof binding.value !== "string" || !binding.value) continue;
        const reference = resolvePhysicalPath(path.resolve(path.dirname(manifest.originalPaths.wiki), binding.value));
        if (isPathInside(target, reference) || isPathInside(reference, target)) throw new Error("Restore outside all reference repository bindings.");
      }
    } finally { db.close(); }
    const result = restoreMemoryBackup(recovery, destination);
    return { ...result, externalIndexNeedsRebuild };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function exportTables(db: DatabaseSync): Record<string, TableData> {
  const expected = schemaColumns();
  for (const table of tableNames(db)) {
    if (DERIVED.has(table.name)) continue;
    if (!Object.hasOwn(expected, table.name)) throw new Error(`Private export requires an audit of unknown table ${table.name}; use local recovery meanwhile.`);
  }
  const tables: Record<string, TableData> = {};
  for (const [name, columns] of Object.entries(expected)) {
    const actual = columnsOf(db, name);
    if (JSON.stringify(actual) !== JSON.stringify(columns)) throw new Error(`Private export requires a schema audit for ${name}. No source migration was performed.`);
    const records = db.prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(name)}`).all();
    const values = records.map((row) => columns.map((column) => checkedCell(row[column])));
    // Stable ordering across SQLite row layouts; all serialized data is explicit.
    values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
    tables[name] = { columns, rows: values };
  }
  return tables;
}

function schemaColumns(): Record<string, string[]> {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(INITIAL_SCHEMA_SQL);
    return Object.fromEntries(tableNames(db).filter((table) => !DERIVED.has(table.name)).map((table) => [table.name, columnsOf(db, table.name)]));
  } finally { db.close(); }
}
function tableNames(db: DatabaseSync): Array<{ name: string }> {
  return (db.prepare("PRAGMA table_list").all() as Array<{ name: string; schema: string; type: string }>).filter((table) => table.schema === "main" && table.type !== "shadow" && !table.name.startsWith("sqlite_")).sort((a, b) => a.name.localeCompare(b.name));
}
function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>).map((column) => column.name).sort();
}
function checkedCell(value: unknown): Cell {
  if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  throw new Error("Unsupported structured value in private export.");
}
function rows(table: TableData): Row[] { return table.rows.map((values) => Object.fromEntries(table.columns.map((name, i) => [name, values[i]]))); }
function filterRows(table: TableData, keep: (row: Row) => boolean): void { table.rows = table.rows.filter((values) => keep(Object.fromEntries(table.columns.map((name, i) => [name, values[i]])))); }
function referencePaths(tables: Record<string, TableData>): string[] {
  return [...rows(tables.repositories).map((repo) => repo.path), ...rows(tables.entities).map((entity) => entity.repo_path)].filter((value): value is string => typeof value === "string" && value.length > 0);
}
function classifySources(tables: Record<string, TableData>, original: PrivateExportManifest["originalPaths"], repositories: string[]): Pick<ExportData, "privateSourceIds" | "externalSourceIds"> {
  const privateSourceIds: string[] = [], externalSourceIds: string[] = [];
  // Stable repository identities survive clone relocation. Historic raw paths
  // need not match the current machine's bindings after an explicit reassociation.
  const repositoryIds = new Set([...rows(tables.repositories).map((repo) => repo.id), ...rows(tables.entities).filter((entity) => entity.kind === "repository").map((entity) => entity.id)]);
  const externalRevisions = new Set(tables.repository_source_provenance ? rows(tables.repository_source_provenance).filter((item) => repositoryIds.has(item.repository_id)).map((item) => item.source_id) : []);

  for (const source of rows(tables.sources)) {
    const raw = typeof source.raw_path === "string" ? source.raw_path : "";
    if (path.isAbsolute(raw) && [original.captures, original.wiki].some((root) => isPathInside(raw, root))) privateSourceIds.push(String(source.id));
    else if (path.isAbsolute(raw) && (externalRevisions.has(source.id) || repositories.some((root) => path.isAbsolute(root) && isPathInside(raw, root)))) externalSourceIds.push(String(source.id));
    else throw new Error(`Source ${source.id} has an unclassified origin. Private export requires explicit source classification; local recovery remains available.`);
  }
  return { privateSourceIds: privateSourceIds.sort(), externalSourceIds: externalSourceIds.sort() };
}
function validateUiState(tables: Record<string, TableData>): void {
  for (const state of rows(tables.ui_state)) {
    if (!KNOWN_UI_STATE.has(String(state.key))) throw new Error(`Private export requires an audit of unknown UI state ${state.key}; local recovery remains available.`);
    if (state.key === "privateExportCoverage") {
      const coverage = JSON.parse(String(state.value_json));
      onlyKeys(coverage, ["version", "omittedExternalChunks"], "restored index coverage");
      if (coverage.version !== 1 || !Array.isArray(coverage.omittedExternalChunks)) throw new Error("Invalid restored index coverage.");
      for (const chunk of coverage.omittedExternalChunks) {
        onlyKeys(chunk, ["id", "sourceId", "contentHash", "chunkIndex"], "restored index passage");
        if (typeof chunk.id !== "string" || typeof chunk.sourceId !== "string" || typeof chunk.contentHash !== "string" || !Number.isSafeInteger(chunk.chunkIndex)) throw new Error("Invalid restored index passage.");
      }
    }
  }
}
function citedChunkIds(tables: Record<string, TableData>, includePacks: boolean): Set<string> {
  const cited = new Set<string>();
  for (const name of ["observations", "observation_evidence", "concept_mentions"]) {
    for (const row of rows(tables[name])) {
      const id = row.source_chunk_id ?? row.chunk_id;
      if (typeof id === "string" && id) cited.add(id);
    }
  }
  // History and proposals may retain chunk references in JSON, even after a
  // current observation was edited. Preserve that provenance closure too.
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      if (["sourceChunkId", "source_chunk_id", "chunkId", "chunk_id"].includes(key) && typeof child === "string") cited.add(child);
      visit(child);
    }
  };
  for (const [name, table] of Object.entries(tables)) {
    if (name === "context_packs" && !includePacks) continue;
    for (const row of rows(table)) for (const column of table.columns.filter((name) => name.endsWith("_json"))) {
      if (row[column] !== null) visit(JSON.parse(String(row[column])));
    }
  }
  return cited;
}

function assertNoCredentials(value: string, configuredKey?: string): void {
  if ((configuredKey && value.includes(configuredKey))
    || /https?:\/\/[^\s/"<>]+:[^\s/"<>]+@/i.test(value)
    || /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-[a-zA-Z0-9_-]{20,})\b/.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)[\\"'\s]*[:=][\\"'\s]*(?!null\b|undefined\b|[\\"'\s]*[,}\n])[^\s,}\\"']{4}/i.test(value)) {
    throw new Error("Possible credentials found in private export content. Review the source data; no export was delivered.");
  }
}
function validatePolicy(policy: PrivateExportPolicy): void {
  if (!policy || policy.externalEvidence !== "retain-cited" || !["retain", "omit"].includes(policy.contextPacks)) throw new Error("Private export requires --external-evidence retain-cited and --context-packs retain|omit. References-only evidence is not supported by this format.");
}
function assertOutsideGit(destination: string): void {
  let current = resolvePhysicalPath(destination);
  while (true) {
    try { fs.lstatSync(path.join(current, ".git")); throw new Error("Prepare the private export outside Git repositories; publication requires a separate destination review."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function materializeRecovery(directory: string, destination: string): PrivateExportManifest {
  const root = fs.realpathSync(directory);
  assertRegularFile(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as PrivateExportManifest;
  validatePrivateManifest(manifest);
  const expectedFiles = new Set(["manifest.json", ...manifest.files.map((file) => file.path)]);
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    const relative = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    if (entry.isSymbolicLink() || (!entry.isDirectory() && (!entry.isFile() || !expectedFiles.has(relative)))) throw new Error("Unexpected or unsafe file in private export.");
  }
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const file of manifest.files) {
    assertRegularFile(root, file.path);
    const target = path.join(destination, file.path);
    copyPrivateFile(path.join(root, file.path), target);
    if (fs.statSync(target).size !== file.bytes || hashFile(target) !== file.sha256) throw new Error(`Private export integrity check failed: ${file.path}`);
    assertNoCredentials(fs.readFileSync(target, "utf8"));
  }
  const data = JSON.parse(fs.readFileSync(path.join(destination, "memory.json"), "utf8")) as ExportData;
  validateData(data, manifest);
  const databasePath = path.join(destination, "database.sqlite");
  const db = new DatabaseSync(databasePath);
  try {
    // Only this application's schema is executed. The archive contains data,
    // never SQL, triggers, table definitions or extension-loading instructions.
    db.exec(INITIAL_SCHEMA_SQL);
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
    for (const [name, table] of Object.entries(data.tables)) {
      const insert = db.prepare(`INSERT INTO ${quote(name)} (${table.columns.map(quote).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`);
      for (const row of table.rows) insert.run(...row);
    }
    // Keep the metadata for deliberately omitted index passages across another
    // export/restore cycle. It is cleared only when that exact chunk is present.
    const previousCoverage = db.prepare("SELECT value_json FROM ui_state WHERE key='privateExportCoverage'").get();
    const previous = previousCoverage ? JSON.parse(String(previousCoverage.value_json)).omittedExternalChunks as ExportData["omittedExternalChunks"] : [];
    const retained = new Map(rows(data.tables.source_chunks).map((chunk) => [String(chunk.id), String(chunk.content_hash)]));
    const pending = [...new Map([...previous, ...data.omittedExternalChunks].map((chunk) => [chunk.id, chunk])).values()]
      .filter((chunk) => retained.get(chunk.id) !== chunk.contentHash).sort((a, b) => a.id.localeCompare(b.id));
    db.prepare("INSERT INTO ui_state (key,value_json,updated_at) VALUES ('privateExportCoverage',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at")
      .run(JSON.stringify({ version: 1, omittedExternalChunks: pending }), manifest.createdAt);
    db.exec(`INSERT INTO source_chunks_fts (chunk_id, source_id, product_id, title, content)
      SELECT chunk.id, chunk.source_id, NULL, source.title, chunk.content FROM source_chunks chunk JOIN sources source ON source.id = chunk.source_id;`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Private export has broken references.");
    db.exec("COMMIT; PRAGMA journal_mode=DELETE;");
  } finally { db.close(); }
  fs.chmodSync(databasePath, 0o600);
  fs.rmSync(path.join(destination, "memory.json"));
  const files = [...manifest.files.filter((file) => file.path !== "memory.json"), describeFile(destination, "database.sqlite")].sort((a, b) => a.path.localeCompare(b.path));
  const recovery: MemoryBackupManifest = { format: "oneagent-local-recovery", version: 1, createdAt: manifest.createdAt, publishable: false, indexedContent: "retained", originalPaths: manifest.originalPaths, files };
  writePrivate(path.join(destination, "manifest.json"), JSON.stringify(recovery, null, 2) + "\n");
  verifyMemoryBackup(destination);
  return manifest;
}

function onlyKeys(value: unknown, keys: string[], label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`Unexpected fields in private export ${label}.`);
  }
}
function validatePrivateManifest(manifest: PrivateExportManifest): void {
  onlyKeys(manifest, ["format", "version", "createdAt", "publicationReady", "policy", "originalPaths", "coverage", "files"], "manifest");
  onlyKeys(manifest.policy, ["externalEvidence", "contextPacks"], "policy");
  onlyKeys(manifest.originalPaths, ["captures", "wiki"], "origin");
  if (!manifest || manifest.format !== "oneagent-private-export" || ![1, 2, 3].includes(manifest.version) || manifest.publicationReady !== false || !Array.isArray(manifest.files)) throw new Error("Unsupported private export format.");
  validatePolicy(manifest.policy);
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt)) || !manifest.originalPaths
    || ![manifest.originalPaths.captures, manifest.originalPaths.wiki].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new Error("Invalid private export origin.");
  const seen = new Set<string>();
  for (const file of manifest.files) {
    onlyKeys(file, ["path", "bytes", "sha256"], "file");
    if (!file || typeof file.path !== "string" || file.path.includes("\\") || file.path.includes("\0")
      || file.path.split("/").some((part) => !part || part === "." || part === "..")
      || !(["memory.json", "config.json", "taxonomy.json"].includes(file.path) || /^(captures|wiki)\/.+\.md$/i.test(file.path))
      || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Unsafe or duplicate private export file.");
    seen.add(file.path);
  }
  if (!seen.has("memory.json") || !seen.has("config.json")) throw new Error("Private export is missing structured data or configuration.");
}
function validateData(data: ExportData, manifest: PrivateExportManifest): void {
  onlyKeys(data, ["version", "tables", "privateSourceIds", "externalSourceIds", "omittedExternalChunks"], "data");
  const expected = schemaColumns();
  // Version 1 predates repository tracking. Its original table set and coverage
  // remain mandatory; the trusted restoration schema supplies empty new tables.
  if (manifest.version === 1) for (const name of ["repository_documents", "repository_source_provenance", "repository_index_state"]) delete expected[name];
  // Formats 1 and 2 predate request tracking; restore their original task shape.
  if (manifest.version < 3) expected.tasks = expected.tasks.filter((name) => name !== "tracking_json");
  if (!data || data.version !== manifest.version || !data.tables || JSON.stringify(Object.keys(data.tables).sort()) !== JSON.stringify(Object.keys(expected).sort())) throw new Error("Private export table coverage does not match this format.");
  for (const [name, columns] of Object.entries(expected)) {
    const table = data.tables[name];
    onlyKeys(table, ["columns", "rows"], "table");
    if (!table || JSON.stringify(table.columns) !== JSON.stringify(columns) || !Array.isArray(table.rows)) throw new Error(`Invalid private export table ${name}.`);
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`Invalid private export row in ${name}.`);
      row.forEach(checkedCell);
    }
  }
  validateUiState(data.tables);
  const classified = classifySources(data.tables, manifest.originalPaths, referencePaths(data.tables));
  if (JSON.stringify(classified.privateSourceIds) !== JSON.stringify(data.privateSourceIds) || JSON.stringify(classified.externalSourceIds) !== JSON.stringify(data.externalSourceIds)) throw new Error("Invalid source classification in private export.");
  const external = new Set(data.externalSourceIds);
  const cited = citedChunkIds(data.tables, manifest.policy.contextPacks === "retain");
  const chunks = rows(data.tables.source_chunks);
  const retained = chunks.filter((chunk) => external.has(String(chunk.source_id)));
  if (retained.some((chunk) => !cited.has(String(chunk.id)))) throw new Error("Uncited external index content found in private export.");
  if (!Array.isArray(data.omittedExternalChunks)) throw new Error("Missing external index coverage.");
  const chunkIds = new Set(chunks.map((chunk) => chunk.id));
  const omittedIds = new Set<string>();
  for (const chunk of data.omittedExternalChunks) {
    onlyKeys(chunk, ["id", "sourceId", "contentHash", "chunkIndex"], "omitted chunk");
    if (!chunk || typeof chunk.id !== "string" || typeof chunk.contentHash !== "string" || !external.has(chunk.sourceId) || !Number.isSafeInteger(chunk.chunkIndex)
      || chunkIds.has(chunk.id) || omittedIds.has(chunk.id) || cited.has(chunk.id)) throw new Error("Invalid omitted external chunk metadata.");
    omittedIds.add(chunk.id);
  }
  const coverage = manifest.coverage;
  onlyKeys(coverage, ["tables", "excludedDerivedTables", "externalSources", "retainedExternalChunks", "omittedExternalChunks"], "coverage");
  if (!Array.isArray(coverage.excludedDerivedTables) || coverage.excludedDerivedTables.some((name) => !DERIVED.has(name)) || new Set(coverage.excludedDerivedTables).size !== coverage.excludedDerivedTables.length) throw new Error("Invalid derived table coverage.");
  if (!coverage || !Array.isArray(coverage.tables) || coverage.tables.length !== Object.keys(expected).length
    || coverage.externalSources !== external.size || coverage.retainedExternalChunks !== retained.length || coverage.omittedExternalChunks !== omittedIds.size) throw new Error("Invalid private export coverage.");
  const names = new Set<string>();
  for (const table of coverage.tables) {
    onlyKeys(table, ["name", "originalRows", "exportedRows"], "table coverage");
    if (!table || !Object.hasOwn(expected, table.name) || names.has(table.name) || table.exportedRows !== data.tables[table.name].rows.length
      || !Number.isSafeInteger(table.originalRows) || table.originalRows < table.exportedRows) throw new Error("Invalid table counts in private export.");
    const removed = table.originalRows - table.exportedRows;
    if (table.name === "source_chunks" ? removed !== omittedIds.size : table.name === "context_packs" && manifest.policy.contextPacks === "omit" ? table.exportedRows !== 0 : removed !== 0) throw new Error("Unexpected durable row omission in private export.");
    names.add(table.name);
  }
}
