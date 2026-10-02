import { createDefaultGraphProvider, type GraphProvider } from "../../graph/src/index.ts";
import { detectActiveContext, loadConfig, resolveConfigPath } from "../../registry/src/index.ts";
import { acquireMemoryLock } from "../../shared/src/index.ts";
import type { ActiveContext, WorkMemoryConfig } from "../../shared/src/index.ts";
import { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { migrateKnowledge, persistEntityPage, syncEntityPages, type KnowledgeMigrationReport } from "../../wiki/src/index.ts";
import fs from "node:fs";
import path from "node:path";

export interface RuntimeOptions {
  cwd: string;
  configPath?: string;
  syncPages?: boolean;
  autoMigrate?: boolean;
  syncConfig?: boolean;
}

export interface WorkMemoryRuntime {
  config: WorkMemoryConfig;
  context: ActiveContext;
  db: WorkMemoryDatabase;
  graphProvider: GraphProvider;
  knowledgeMigration?: KnowledgeMigrationReport;
  close(): void;
}

export function createRuntime(options: RuntimeOptions): WorkMemoryRuntime {
  const config = loadConfig(resolveConfigPath(options.cwd, options.configPath));
  const context = detectActiveContext(config, options.cwd);
  const existingDatabase = fs.existsSync(config.storage.databasePath);
  const release = acquireMemoryLock(config.storage.databasePath);
  let db: WorkMemoryDatabase;
  try { db = new WorkMemoryDatabase(config.storage.databasePath); } catch (error) { release(); throw error; }
  let knowledgeMigration: KnowledgeMigrationReport | undefined;
  try {
    db.migrate();
    if (options.autoMigrate !== false) knowledgeMigration = ensureMarkdownMigration(config, db, existingDatabase);
    db.setEntityPageWriter((entity, content) => persistEntityPage(config, db, entity, content));
    if (options.syncConfig !== false) db.syncConfig(config);
    if (options.syncPages !== false) syncEntityPages(config, db);
  } catch (error) {
    try { db.close(); } finally { release(); }
    throw error;
  }
  const graphProvider = createDefaultGraphProvider();

  return {
    config,
    context,
    db,
    graphProvider,
    knowledgeMigration,
    close() {
      try { db.close(); } finally { release(); }
    }
  };
}

function ensureMarkdownMigration(config: WorkMemoryConfig, db: WorkMemoryDatabase, existingDatabase: boolean): KnowledgeMigrationReport | undefined {
  const hasMigrated = (): boolean => Boolean(db.db.prepare("SELECT id FROM schema_migrations WHERE id = '014_markdown_knowledge'").get());
  if (hasMigrated()) return;
  const lockPath = path.join(path.dirname(config.storage.databasePath), "knowledge-migration.lock");
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (hasMigrated()) return;
    let lock: number;
    try {
      lock = fs.openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = Number(fs.readFileSync(lockPath, "utf8"));
        if (owner && owner !== process.pid) {
          try { process.kill(owner, 0); } catch (probe) {
            if ((probe as NodeJS.ErrnoException).code === "ESRCH") fs.unlinkSync(lockPath);
          }
        }
      } catch { /* Another process may be writing or removing the lock. */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      continue;
    }
    try {
      fs.writeSync(lock, String(process.pid));
      if (!hasMigrated()) {
        if (existingDatabase) return migrateKnowledge(config, db, true);
        else db.db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))").run("014_markdown_knowledge");
      }
      return;
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
  throw new Error(`Timed out waiting for OneAgent knowledge migration: ${lockPath}`);
}
