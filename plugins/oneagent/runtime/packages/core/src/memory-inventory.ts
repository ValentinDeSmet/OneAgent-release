import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { copyStableDatabase } from "../../storage/src/snapshot.ts";
import type { WorkMemoryConfig } from "../../shared/src/index.ts";

import { describeMemoryDestinations, type MemoryDestinations } from "./memory-destinations.ts";

type Row = Record<string, string | number | null>;
type Availability = "available" | "missing" | "inaccessible" | "not_directory";

export interface InventoryIssue {
  code: string;
  subject: string;
  detail: string;
}

export interface MemoryFileInventory {
  root: string;
  status: Availability;
  complete: boolean;
  files: Array<{ path: string; bytes: number; modifiedAt: string }>;
  skipped: string[];
}

export interface MemoryInventory {
  version: 1;
  readOnly: true;
  generatedAt: string;
  consistency: "stable-sqlite-copy; filesystem-observed-separately";
  workspace: { configPath: string; root: string; memoryRoot: string; databasePath: string };
  configuration: { productIds: string[]; entityRefs: string[]; relationIds: string[]; customEntityKinds: string[]; customRelationTypes: string[] };
  database: {
    status: "available" | "missing" | "unavailable";
    tables: Array<{ name: string; rows: number; exportV3: "included" | "not-included" | "derived" | "audit-required" }>;
    missingTables: string[];
    sources: Row[];
    entities: Row[];
    relations: Row[];
    repositories: Row[];
    context: { viewCount: number | null; packCount: number | null; stateKeys: string[] };
  };
  files: { captures: MemoryFileInventory; wiki: MemoryFileInventory };
  repositories: Array<{
    id: string;
    productId: string;
    legacyRole: string;
    path: string;
    availability: Availability;
    referenceRole: "product-reference";
    visibility: "unknown";
  }>;
  legacyWikiTargets: Array<{ origin: string; repositoryPath: string; wikiPath: string }>;
  backup: { restoreVerified: false; privateDestination: "not-configured" | "reserved-not-enabled" };
  synchronization: MemoryDestinations;
  issues: InventoryIssue[];
}

// This describes the current export assembler, not a promise of restorability.
// Auxiliary/unknown state remains an explicit audit item instead of being lost.
const EXPORT_V3 = new Set([
  "entities", "entity_relations", "captures", "sources", "source_chunks", "curation_packages",
  "observations", "observation_evidence", "observation_relations", "observation_events",
  "tasks", "task_links", "kpi_measurements"
]);
const NOT_EXPORTED = new Set(["memory_inbox", "context_views", "context_packs", "ui_state", "repository_documents", "repository_source_provenance", "repository_index_state"]);
const DERIVED = new Set(["inbox_context_refs", "source_chunk_embeddings"]);
const EXPECTED_TABLES = [...EXPORT_V3, ...NOT_EXPORTED].sort();
const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Administrative inventory only: never construct the runtime, migrate, or sync pages/config. */
export function inventoryMemory(config: WorkMemoryConfig): MemoryInventory {
  const issues: InventoryIssue[] = [];
  const memoryRoot = path.resolve(config.workspaceRoot, config.workspace.memoryRoot);
  const database = readDatabase(config.storage.databasePath, issues);
  const files = {
    captures: inventoryMarkdown(path.join(memoryRoot, "captures"), issues),
    wiki: inventoryMarkdown(path.join(config.workspaceRoot, "wiki"), issues)
  };
  const repositories = config.products.flatMap((product) => product.repositories.map((repository) => ({
    id: repository.id,
    productId: product.id,
    legacyRole: repository.role,
    path: repository.path,
    availability: directoryAvailability(repository.path),
    referenceRole: "product-reference" as const,
    visibility: "unknown" as const
  })));
  // Inventory both legacy config and persisted entity destinations. None of
  // these bindings authorizes a private backup or establishes remote visibility.
  const legacyWikiTargets: MemoryInventory["legacyWikiTargets"] = [];
  const addTarget = (origin: string, repositoryPath: string, wikiRoot: string | null): void => {
    const resolved = path.resolve(config.workspaceRoot, repositoryPath);
    legacyWikiTargets.push({ origin, repositoryPath: resolved, wikiPath: path.resolve(resolved, wikiRoot || "docs/wiki") });
  };
  for (const product of config.products) {
    for (const repository of product.repositories) addTarget(`config:${product.id}:${repository.id}`, repository.path, repository.wikiRoot ?? null);
  }
  for (const repository of database.repositories) {
    if (typeof repository.path === "string") addTarget(`database:repository:${repository.id}`, repository.path, stringOrNull(repository.wiki_root));
  }
  for (const entity of database.entities) {
    if (typeof entity.repo_path === "string" && entity.repo_path) {
      addTarget(`entity:${entity.kind}:${entity.id}`, entity.repo_path, stringOrNull(entity.wiki_root));
    }
  }
  if (legacyWikiTargets.length) issues.push({
    code: "legacy-sync-destinations", subject: "wiki",
    detail: "Review each legacy destination explicitly before private synchronization; a product binding does not establish a private backup destination."
  });
  for (const repository of repositories) {
    if (repository.availability !== "available") issues.push({
      code: "repository-unavailable", subject: repository.id,
      detail: `Local clone is ${repository.availability}; preserve its existing references and index.`
    });
  }
  const excluded = database.tables.filter((table) => table.exportV3 === "not-included" && table.rows > 0);
  if (excluded.length) issues.push({
    code: "export-v3-gaps", subject: "backup",
    detail: `Export v3 omits populated durable tables: ${excluded.map((table) => table.name).join(", ")}.`
  });
  issues.push({
    code: "backup-not-verified", subject: "backup",
    detail: "This inventory is not a backup. Snapshot consistency, file coverage, configuration, taxonomy, auxiliary tables and restoration still require validation."
  });
  return {
    version: 1, readOnly: true, generatedAt: new Date().toISOString(),
    consistency: "stable-sqlite-copy; filesystem-observed-separately",
    workspace: { configPath: config.configPath, root: config.workspaceRoot, memoryRoot, databasePath: config.storage.databasePath },
    configuration: {
      productIds: config.products.map((product) => product.id),
      entityRefs: config.entities.map((entity) => `${entity.kind}:${entity.id}`),
      relationIds: config.entityLinks.map((relation) => relation.id),
      customEntityKinds: config.taxonomy.customEntityKinds.map((kind) => kind.id),
      customRelationTypes: config.taxonomy.customRelationTypes.map((relation) => relation.type)
    },
    database, files, repositories, legacyWikiTargets,
    backup: { restoreVerified: false, privateDestination: config.privateBackup ? "reserved-not-enabled" : "not-configured" },
    synchronization: describeMemoryDestinations(config, legacyWikiTargets, database.status === "available"
      && database.tables.some((table) => table.name === "repositories")
      && database.tables.some((table) => table.name === "entities")
      && !issues.some((issue) => ["legacy-table-shape", "unsupported-table-shape"].includes(issue.code) && ["repositories", "entities"].includes(issue.subject))),
    issues
  };
}

function readDatabase(databasePath: string, issues: InventoryIssue[]): MemoryInventory["database"] {
  const empty: MemoryInventory["database"] = {
    status: "missing", tables: [], missingTables: [...EXPECTED_TABLES], sources: [], entities: [], relations: [], repositories: [],
    context: { viewCount: null, packCount: null, stateKeys: [] }
  };
  try {
    fs.statSync(databasePath);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    issues.push({ code: missing ? "database-missing" : "database-unavailable", subject: databasePath, detail: missing ? "No database exists; none was created." : "Database could not be inspected." });
    return { ...empty, status: missing ? "missing" : "unavailable" };
  }
  let db: DatabaseSync | undefined;
  let temporaryRoot: string | undefined;
  try {
    // Even SQLite readOnly connections may create WAL/SHM sidecars beside the
    // original database. Read a stable temporary copy, including committed WAL
    // data, so inventory never creates or changes files inside the memory.
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oneagent-inventory-snapshot-"));
    const snapshotPath = copyStableDatabase(databasePath, temporaryRoot);
    db = new DatabaseSync(snapshotPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000; BEGIN;");
    const schema = db.prepare("PRAGMA table_list").all() as Array<{ name: string; type: string; schema: string }>;
    const names = schema.filter((table) => table.schema === "main" && table.type !== "shadow" && !table.name.startsWith("sqlite_")).map((table) => table.name).sort();
    const tables = names.map((name) => ({
      name,
      rows: Number((db!.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as { count: number }).count),
      exportV3: exportCoverage(name, schema.find((table) => table.name === name)?.type)
    }));
    const columns = (table: string): Set<string> => new Set((db!.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map((column) => column.name));
    const select = (table: string, requested: string[], required: string[]): Row[] => {
      if (!names.includes(table)) return [];
      const available = columns(table);
      if (required.some((column) => !available.has(column))) {
        issues.push({ code: "unsupported-table-shape", subject: table, detail: "Required identity columns are absent; no migration was attempted." });
        return [];
      }
      const selected = requested.filter((column) => available.has(column));
      if (selected.length < requested.length) issues.push({ code: "legacy-table-shape", subject: table, detail: "Some inventory metadata columns are absent; no migration was attempted." });
      return db!.prepare(`SELECT ${selected.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)} ORDER BY ${required.map(quoteIdentifier).join(", ")}`).all().map((row) => ({ ...row })) as Row[];
    };
    const sources = select("sources", ["id", "source_type", "origin", "raw_path", "content_hash", "revision", "status"], ["id"]);
    const entities = select("entities", ["id", "kind", "status", "repo_path", "wiki_root"], ["kind", "id"]);
    const relations = select("entity_relations", ["id", "source_kind", "source_id", "target_kind", "target_id", "relation_type"], ["id"]);
    const repositories = select("repositories", ["id", "product_id", "role", "path", "wiki_root", "specs_root"], ["id"]);
    const stateKeys = select("ui_state", ["key"], ["key"]).map((row) => String(row.key));
    const count = (name: string): number | null => tables.find((table) => table.name === name)?.rows ?? null;
    db.exec("ROLLBACK;");
    const missingTables = EXPECTED_TABLES.filter((name) => !names.includes(name));
    if (missingTables.length) issues.push({ code: "legacy-schema", subject: "database", detail: `Tables absent (not equivalent to empty): ${missingTables.join(", ")}.` });
    return { status: "available", tables, missingTables, sources, entities, relations, repositories, context: { viewCount: count("context_views"), packCount: count("context_packs"), stateKeys } };
  } catch {
    issues.push({ code: "database-unavailable", subject: databasePath, detail: "Database could not be read completely; no repair or migration was attempted." });
    return { ...empty, status: "unavailable" };
  } finally {
    try { db?.close(); } finally {
      if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}


function exportCoverage(name: string, type?: string): MemoryInventory["database"]["tables"][number]["exportV3"] {
  if (EXPORT_V3.has(name)) return "included";
  if (NOT_EXPORTED.has(name)) return "not-included";
  if (DERIVED.has(name) || (type === "virtual" && /_fts$/.test(name))) return "derived";
  return "audit-required";
}

function directoryAvailability(directory: string): Availability {
  try {
    return fs.statSync(directory).isDirectory() ? "available" : "not_directory";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "inaccessible";
  }
}

function inventoryMarkdown(root: string, issues: InventoryIssue[]): MemoryFileInventory {
  const result: MemoryFileInventory = { root, status: directoryAvailability(root), complete: true, files: [], skipped: [] };
  if (result.status !== "available") {
    result.complete = false;
    issues.push({ code: "files-unavailable", subject: root, detail: `Directory is ${result.status}; no files were created or inferred to be deleted.` });
    return result;
  }
  const visit = (directory: string): void => {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          result.skipped.push(path.relative(root, fullPath));
          result.complete = false;
        } else if (entry.isDirectory()) {
          visit(fullPath);
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          const stat = fs.statSync(fullPath);
          result.files.push({ path: path.relative(root, fullPath), bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
        }
      }
    } catch {
      result.complete = false;
      issues.push({ code: "files-scan-incomplete", subject: directory, detail: "Directory could not be read completely; retain all existing references." });
    }
  };
  // Do not silently traverse a redirected root either.
  try {
    if (fs.lstatSync(root).isSymbolicLink()) {
      result.complete = false;
      result.skipped.push(".");
    } else visit(root);
  } catch {
    result.complete = false;
    issues.push({ code: "files-scan-incomplete", subject: root, detail: "Directory became unavailable during inspection." });
  }
  if (result.skipped.length) issues.push({ code: "symlinks-skipped", subject: root, detail: "Symbolic links were not followed; the file inventory is incomplete." });
  return result;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
