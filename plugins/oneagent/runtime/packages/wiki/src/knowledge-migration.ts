import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, nowIso, type WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { entityPagePath, persistEntityPage } from "./entity-page.ts";
import { globalWikiRoot } from "./wiki-store.ts";

interface LegacySource {
  id: string;
  title: string;
  rawPath: string | null;
  originUri: string | null;
  status: string;
}

export interface KnowledgeMigrationReport {
  dryRun: boolean;
  backupPath?: string;
  entities: number;
  existingPages: number;
  newPages: number;
  sources: number;
  recoveredSources: number;
  vectors: number;
  tasks: number;
  relations: number;
  warnings: string[];
}

/**
 * Preview or execute the one-time transition from the vector-era database.
 * Existing source/chunk IDs and their evidence links remain untouched. Missing
 * source files are reconstructed as clearly marked archives from stored chunks.
 */
export function migrateKnowledge(config: WorkMemoryConfig, db: WorkMemoryDatabase, apply = false): KnowledgeMigrationReport {
  const sources = db.db.prepare(
    "SELECT id, title, raw_path AS rawPath, origin_uri AS originUri, status FROM sources ORDER BY id"
  ).all() as unknown as LegacySource[];
  const entities = db.listEntities();
  const missing = sources.filter((source) => {
    const candidate = source.rawPath ?? source.originUri;
    return !candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile();
  });
  const vectorTable = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_chunk_embeddings'").get();
  const count = (sql: string): number => Number((db.db.prepare(sql).get() as { count: number }).count);
  const report: KnowledgeMigrationReport = {
    dryRun: !apply,
    entities: entities.length,
    existingPages: entities.filter((entity) => fs.existsSync(entityPagePath(config, db, entity))).length,
    newPages: entities.filter((entity) => !fs.existsSync(entityPagePath(config, db, entity))).length,
    sources: sources.length,
    recoveredSources: missing.length,
    vectors: vectorTable ? count("SELECT COUNT(*) AS count FROM source_chunk_embeddings") : 0,
    tasks: count("SELECT COUNT(*) AS count FROM tasks"),
    relations: count("SELECT COUNT(*) AS count FROM entity_relations"),
    warnings: []
  };
  if (!apply) return report;

  const backupPath = path.join(path.dirname(config.storage.databasePath), "backups", `knowledge-${nowIso().replace(/[:.]/g, "-")}-${process.pid}`);
  fs.mkdirSync(backupPath, { recursive: true });
  const dbBackup = path.join(backupPath, "work-memory.db");
  // VACUUM INTO takes a consistent SQLite snapshot including WAL contents.
  db.db.exec(`VACUUM INTO '${dbBackup.replace(/'/g, "''")}'`);
  const wikiRoot = globalWikiRoot(config);
  if (fs.existsSync(wikiRoot)) fs.cpSync(wikiRoot, path.join(backupPath, "wiki"), { recursive: true });
  const capturesDir = path.join(config.workspaceRoot, config.workspace.memoryRoot, "captures");
  if (fs.existsSync(capturesDir)) fs.cpSync(capturesDir, path.join(backupPath, "captures"), { recursive: true });
  if (fs.existsSync(config.configPath)) fs.copyFileSync(config.configPath, path.join(backupPath, path.basename(config.configPath)));
  const taxonomyPath = path.join(config.workspaceRoot, config.workspace.memoryRoot, "taxonomy.json");
  if (fs.existsSync(taxonomyPath)) fs.copyFileSync(taxonomyPath, path.join(backupPath, "taxonomy.json"));
  report.backupPath = backupPath;

  db.runInTransaction(() => {
    for (const entity of entities) {
      const page = persistEntityPage(config, db, entity);
      if (page.changed) db.onRollback(page.undo);
    }
    for (const source of missing) {
      const chunks = db.db.prepare(
        "SELECT content FROM source_chunks WHERE source_id = ? ORDER BY chunk_index"
      ).all(source.id) as Array<{ content: string }>;
      const linked = db.listEntityRefsForSource(source.id);
      const archivePath = path.join(wikiRoot, "imported-sources", `${source.id}.md`);
      if (fs.existsSync(archivePath)) continue;
      const content = [
        `# ${source.title}`,
        "",
        "> Recovered from the SQLite source chunks. Original formatting may differ.",
        "",
        `Source ID: \`${source.id}\`  `,
        `Original path: \`${source.rawPath ?? source.originUri ?? "unknown"}\`  `,
        `Status: \`${source.status}\``,
        `Linked entities: ${linked.map((ref) => `\`${ref.kind}:${ref.id}\``).join(", ") || "none"}`,
        "",
        ...chunks.flatMap((chunk, index) => [`## Stored chunk ${index + 1}`, "", chunk.content, ""])
      ].join("\n");
      atomicWriteFile(archivePath, content);
      db.onRollback(() => fs.rmSync(archivePath, { force: true }));
      if (chunks.length === 0) report.warnings.push(`Source ${source.id} has no stored chunks.`);
    }
    if (vectorTable) db.db.exec("DROP TABLE source_chunk_embeddings");
    db.db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("014_markdown_knowledge", nowIso());
  });
  return report;
}
