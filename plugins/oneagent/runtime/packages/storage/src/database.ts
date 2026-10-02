import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createId,
  createStableId,
  DEFAULT_CONTEXT_PACK_RETENTION_POLICY,
  DEFAULT_ENTITY_ID,
  DEFAULT_ENTITY_LABEL,
  normalizeDiscoveryEntityMetadata,
  nowIso,
  resolveEntityKind,
  resolveRelationType
} from "../../shared/src/index.ts";
import type {
  CaptureEntityRef,
  CaptureRecord,
  CaptureUpdate,
  ConceptMentionRecord,
  ConceptRecord,
  CurationPackageRecord,
  CurationPackageStatus,
  ContextPack,
  ContextPackPruneResult,
  ContextPackRetentionPolicy,
  ContextPackSummary,
  ContextViewRecord,
  CountByKey,
  EntityRef,
  EntityKind,
  EntityRecord,
  EntityRelationRecord,
  GraphRelationRecord,
  InboxItem,
  InboxStatus,
  ObservationEvidenceRecord,
  ObservationEventRecord,
  ObservationRecord,
  ObservationRelationRecord,
  ProductConfig,
  RepositoryConfig,
  SearchResult,
  SourceChunk,
  SourceRecord,
  WorkMemoryConfig
} from "../../shared/src/index.ts";
import { INITIAL_SCHEMA_SQL } from "./schema.ts";
import { inboxContextReferenceRows } from "./inbox-context-refs.ts";

export interface TaskMetadataRecord {
  taskId: string;
  title?: string;
  body?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  deadline?: string;
  notes?: string;
  updatedAt: string;
}

export interface TaskMetadataInput {
  taskId: string;
  title?: string | null;
  body?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  deadline?: string | null;
  notes?: string | null;
}

export interface TaskTracking {
  requester?: string;
  deadlineKind?: "exact" | "approximate" | "unknown";
  deadlineLabel?: string;
  targetDate?: string;
  nextAction?: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  body?: string;
  status: string;
  priority: string;
  assignee: string;
  deadline?: string;
  notes?: string;
  productId?: string;
  sourceId?: string;
  origin: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  tracking?: TaskTracking | null;
}

export interface TaskInput {
  id?: string;
  title: string;
  body?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  deadline?: string | null;
  notes?: string | null;
  productId?: string | null;
  sourceId?: string | null;
  origin?: string | null;
  tracking?: TaskTracking | null;
}

export interface TaskUpdateInput {
  taskId: string;
  title?: string | null;
  body?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  deadline?: string | null;
  notes?: string | null;
  productId?: string | null;
  sourceId?: string | null;
  origin?: string | null;
  tracking?: TaskTracking | null;
}

export interface TaskLinkRecord {
  id: string;
  taskId: string;
  relationType: string;
  targetKind: string;
  targetId: string;
  label?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskLinkInput {
  taskId: string;
  relationType: string;
  targetKind: string;
  targetId: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface KpiMeasurementRecord {
  id: string;
  kpiId: string;
  value: number;
  measuredAt: string;
  sourceId?: string;
  observationId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KpiMeasurementInput {
  id?: string;
  kpiId: string;
  value: number;
  measuredAt: string;
  sourceId?: string | null;
  observationId?: string | null;
  note?: string | null;
}

/** Complete source row plus its generic entity placement for portable backups. */
export interface SourceProvenanceRecord extends SourceRecord {
  entityLinks: Array<EntityRef & { relationType: string; confidence: number }>;
  /** @deprecated Accepted only when restoring backups produced before generic source links. */
  productLinks?: Array<{ productId: string; confidence: number }>;
}

export interface ObservationSearchResult {
  observation: ObservationRecord;
  /** FTS5 highlighted excerpt, bounded by SQLite's snippet token limit. */
  snippet: string;
  /** FTS5 bm25 score; lower is more relevant. */
  score: number;
}

export interface ObservationSearchFilter {
  validationStatuses?: ObservationRecord["validationStatus"][];
  evidenceStatuses?: ObservationRecord["evidenceStatus"][];
  /** Explicit allowlist. Passing an empty array deliberately returns no rows. */
  observationIds?: string[];
  sourceIds?: string[];
  productIds?: string[];
  limit?: number;
}

/**
 * Lightweight source-chunk metadata used to rank and budget Context Pack
 * retrieval before any source body is hydrated from SQLite.
 */
export interface SourceChunkCandidate {
  chunkId: string;
  sourceId: string;
  chunkIndex: number;
  tokenCount: number;
  characterCount: number;
  /** FTS5 bm25 score (lower is more relevant). Missing on bounded fallbacks. */
  lexicalScore?: number;
}

export interface EntityCandidateMetrics {
  ref: string;
  relationCount: number;
  captureCount: number;
  anchorLinkCount: number;
}

/**
 * Minimal capture projection shared by context resolution and Context Pack
 * provenance. Keeping the entity ref on each row lets callers group the
 * result without re-hydrating captures one entity at a time.
 */
export interface EntityCaptureContextRecord {
  entityKind: string;
  entityId: string;
  captureId: string;
  sourceId?: string;
  createdAt: string;
}

export interface ContextPackPruneOptions {
  policy?: Partial<ContextPackRetentionPolicy>;
  /** `undefined` scans every scope; `null` targets only unscoped packs. */
  viewId?: string | null;
  dryRun?: boolean;
  /** Deterministic clock override for maintenance jobs and tests. */
  now?: string;
}

export class WorkMemoryDatabase {
  databasePath: string;
  db: DatabaseSync;
  private transactionDepth = 0;
  private rollbackActions: Array<Array<() => void>> = [];
  private entityPageWriter?: (entity: EntityRecord, content?: string) => { undo: () => void };

  setEntityPageWriter(writer: (entity: EntityRecord, content?: string) => { undo: () => void }): void {
    this.entityPageWriter = writer;
  }

  onRollback(action: () => void): void {
    const actions = this.rollbackActions.at(-1);
    if (!actions) throw new Error("A file change must be registered inside a database transaction.");
    actions.push(action);
  }

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA busy_timeout = 30000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
    this.installChangeSignal();
  }

  // Touches last-write.json next to the database whenever a statement actually
  // changes data, so watchers (VS Code cockpit) can react to real writes without
  // watching the SQLite files themselves — those are also touched by pure reads
  // (WAL checkpoints on connection close), which is what forced the old
  // mute-based debouncing.
  private installChangeSignal(): void {
    const sentinelPath = path.join(path.dirname(this.databasePath), "last-write.json");
    const mutatingSql = /^\s*(insert|update|delete|replace)\b/i;
    let lastTouch = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastTouch < 200) {
        return;
      }
      lastTouch = now;
      try {
        fs.writeFileSync(sentinelPath, `{"at":"${nowIso()}"}\n`);
      } catch {
        // The sentinel is a best-effort signal; writes must never fail because of it.
      }
    };
    const originalPrepare = this.db.prepare.bind(this.db);
    this.db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!mutatingSql.test(sql)) {
        return statement;
      }
      return new Proxy(statement, {
        get(target, property) {
          if (property === "run") {
            return (...args: Parameters<typeof target.run>) => {
              const result = target.run(...args);
              if (Number(result.changes) > 0) {
                touch();
              }
              return result;
            };
          }
          const value = target[property as keyof typeof target];
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        }
      });
    }) as typeof this.db.prepare;
  }

  migrate(): void {
    const apply = (): void => {
      // Column back-fills run BEFORE the schema: INITIAL_SCHEMA_SQL creates indexes on
      // columns (e.g. captures.curation_status) that older databases don't have yet.
      // The ensure* helpers no-op when the table doesn't exist (fresh database).
      this.ensureCaptureColumns();
      this.ensureEntityColumns();
      this.ensureSourceColumns();
      this.ensureObservationIntegrityColumns();
      this.ensureWikiSynthesisColumns();
      this.ensureContextPackColumns();
      this.db.exec(INITIAL_SCHEMA_SQL);
      this.ensureEntitySearchIndex();
      this.ensureObservationSearchIndex();
      this.ensureInboxContextReferenceIndex();
      this.ensureGenericSourceEntityLinks();
      this.ensureTaskTable();
      this.ensureTaskTrackingColumn();
      this.ensureTaskMetadataColumns();
      this.ensureTaskLinkTable();
      this.ensureImpactTables();
      this.ensureUiStateTable();
      this.seedDefaultEntity();
      const recordMigration = this.db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)"
      );
      recordMigration.run("001_initial", nowIso());
      recordMigration.run("002_entities", nowIso());
      recordMigration.run("003_source_revisions", nowIso());
      recordMigration.run("004_context_control_plane", nowIso());
      recordMigration.run("005_observations_and_curation_packages", nowIso());
      recordMigration.run("006_observation_integrity", nowIso());
      recordMigration.run("007_context_pack_retention", nowIso());
      recordMigration.run("008_wiki_synthesis_targets", nowIso());
      recordMigration.run("009_inbox_context_refs", nowIso());
      recordMigration.run("010_entity_search_fts", nowIso());
      recordMigration.run("011_professional_outcomes", nowIso());
      recordMigration.run("012_observation_search_fts", nowIso());
      recordMigration.run("013_generic_source_entities", nowIso());
      recordMigration.run("015_repository_index", nowIso());
      recordMigration.run("016_task_tracking", nowIso());
    };

    // Schema inspection followed by ALTER TABLE is otherwise racy across the CLI
    // daemon, Cockpit and concurrent agent tools. Serialize every legacy/fresh
    // upgrade, and read the table shape only after acquiring SQLite's writer lock.
    // Once every data backfill is recorded, preserve the existing lock-free
    // startup path.
    if (this.requiresSerializedMigration()) {
      this.runInImmediateTransaction(apply);
    } else {
      apply();
    }
  }

  private requiresSerializedMigration(): boolean {
    const migrationsTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (!migrationsTable) return true;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations
      WHERE id IN ('006_observation_integrity', '007_context_pack_retention', '008_wiki_synthesis_targets', '009_inbox_context_refs', '010_entity_search_fts', '011_professional_outcomes', '012_observation_search_fts', '013_generic_source_entities', '015_repository_index', '016_task_tracking')
    `).get() as { count: number };
    return Number(row.count) < 10;
  }

  private seedDefaultEntity(): void {
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO entities (id, kind, label, description, status, created_at, updated_at)
        VALUES (?, 'oneagent', ?, ?, 'active', ?, ?)
        ON CONFLICT(kind, id) DO NOTHING
      `)
      .run(
        DEFAULT_ENTITY_ID,
        DEFAULT_ENTITY_LABEL,
        "Global fallback entity for uncategorized or workspace-wide memory.",
        now,
        now
      );
  }

  syncConfig(config: WorkMemoryConfig): void {
    this.transaction(() => {
      for (const entity of config.entities) {
        this.upsertEntity({
          id: entity.id,
          kind: entity.kind,
          label: entity.label,
          description: entity.description,
          parentId: entity.parentId
        });
      }
      for (const product of config.products) {
        this.upsertProduct(product);
        this.upsertEntity({
          id: product.id,
          kind: "product",
          label: product.label,
          description: product.description,
          parentId: product.parentEntityId
        });
        for (const repository of product.repositories) {
          this.upsertRepository(repository);
          this.upsertEntity({
            id: repository.id,
            kind: "repository",
            label: repository.id,
            parentId: product.id,
            repoPath: repository.path,
            wikiRoot: repository.wikiRoot,
            metadata: {
              role: repository.role,
              purpose: "product-reference",
              specsRoot: repository.specsRoot,
              gitRemote: repository.gitRemote
            }
          });
        }
      }
    });
  }

  upsertProduct(product: ProductConfig): void {
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO products (id, label, description, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          description = excluded.description,
          updated_at = excluded.updated_at
        WHERE products.label IS NOT excluded.label
          OR products.description IS NOT excluded.description
      `)
      .run(product.id, product.label, product.description ?? null, now, now);
  }

  upsertRepository(repository: RepositoryConfig): void {
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO repositories (id, product_id, role, path, git_remote, wiki_root, specs_root, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id,
          role = excluded.role,
          path = excluded.path,
          git_remote = excluded.git_remote,
          wiki_root = excluded.wiki_root,
          specs_root = excluded.specs_root,
          updated_at = excluded.updated_at
        WHERE repositories.product_id IS NOT excluded.product_id
          OR repositories.role IS NOT excluded.role
          OR repositories.path IS NOT excluded.path
          OR repositories.git_remote IS NOT excluded.git_remote
          OR repositories.wiki_root IS NOT excluded.wiki_root
          OR repositories.specs_root IS NOT excluded.specs_root
      `)
      .run(
        repository.id,
        repository.productId,
        repository.role,
        repository.path,
        repository.gitRemote ?? null,
        repository.wikiRoot ?? null,
        repository.specsRoot ?? null,
        now,
        now
      );
  }

  upsertEntity(input: {
    id: string;
    kind: EntityKind;
    label?: string | null;
    description?: string | null;
    aliases?: string[] | null;
    status?: string | null;
    parentId?: string | null;
    ownerIds?: string[] | null;
    contributorIds?: string[] | null;
    tags?: string[] | null;
    focusLevel?: EntityRecord["focusLevel"] | null;
    metadata?: Record<string, unknown> | null;
    repoPath?: string | null;
    wikiRoot?: string | null;
  }, pageContent?: string): EntityRecord {
    if (this.entityPageWriter && this.transactionDepth === 0) {
      return this.runInTransaction(() => this.upsertEntity(input, pageContent));
    }
    const now = nowIso();
    // Merged-away kinds keep working transparently: writes land on the target kind.
    const kind = resolveEntityKind(input.kind);
    const existing = this.getEntity(kind, input.id);
    const next: EntityRecord = {
      id: input.id,
      kind,
      label: pick(input.label, existing?.label) ?? input.id,
      description: pick(input.description, existing?.description),
      aliases: pick(input.aliases, existing?.aliases),
      status: (pick(input.status, existing?.status) ?? "active") as EntityRecord["status"],
      parentId: pick(input.parentId, existing?.parentId),
      ownerIds: pick(input.ownerIds, existing?.ownerIds),
      contributorIds: pick(input.contributorIds, existing?.contributorIds),
      tags: pick(input.tags, existing?.tags),
      focusLevel: pick(input.focusLevel, existing?.focusLevel),
      metadata: kind === "discovery"
        ? normalizeDiscoveryEntityMetadata(pick(input.metadata, existing?.metadata))
        : pick(input.metadata, existing?.metadata),
      repoPath: pick(input.repoPath, existing?.repoPath),
      wikiRoot: pick(input.wikiRoot, existing?.wikiRoot),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO entities (
          id, kind, label, description, aliases_json, status, parent_id,
          owner_ids_json, contributor_ids_json, tags_json, focus_level, metadata_json, repo_path, wiki_root, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET
          label = excluded.label,
          description = excluded.description,
          aliases_json = excluded.aliases_json,
          status = excluded.status,
          parent_id = excluded.parent_id,
          owner_ids_json = excluded.owner_ids_json,
          contributor_ids_json = excluded.contributor_ids_json,
          tags_json = excluded.tags_json,
          focus_level = excluded.focus_level,
          metadata_json = excluded.metadata_json,
          repo_path = excluded.repo_path,
          wiki_root = excluded.wiki_root,
          updated_at = excluded.updated_at
        WHERE entities.label IS NOT excluded.label
          OR entities.description IS NOT excluded.description
          OR entities.aliases_json IS NOT excluded.aliases_json
          OR entities.status IS NOT excluded.status
          OR entities.parent_id IS NOT excluded.parent_id
          OR entities.owner_ids_json IS NOT excluded.owner_ids_json
          OR entities.contributor_ids_json IS NOT excluded.contributor_ids_json
          OR entities.tags_json IS NOT excluded.tags_json
          OR entities.focus_level IS NOT excluded.focus_level
          OR entities.metadata_json IS NOT excluded.metadata_json
          OR entities.repo_path IS NOT excluded.repo_path
          OR entities.wiki_root IS NOT excluded.wiki_root
      `)
      .run(
        next.id,
        next.kind,
        next.label,
        next.description ?? null,
        toJson(next.aliases),
        next.status,
        next.parentId ?? null,
        toJson(next.ownerIds),
        toJson(next.contributorIds),
        toJson(next.tags),
        next.focusLevel ?? null,
        toJson(next.metadata),
        next.repoPath ?? null,
        next.wikiRoot ?? null,
        next.createdAt,
        next.updatedAt
      );

    if (this.entityPageWriter) {
      const page = this.entityPageWriter(next, pageContent);
      this.onRollback(page.undo);
    }
    return next;
  }

  getEntity(kind: string, id: string): EntityRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM entities WHERE kind = ? AND id = ?")
      .get(kind, id) as EntityRow | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  listEntities(kind?: string): EntityRecord[] {
    const rows = kind
      ? (this.db.prepare("SELECT * FROM entities WHERE kind = ? ORDER BY kind, label").all(kind) as unknown as EntityRow[])
      : (this.db.prepare("SELECT * FROM entities ORDER BY kind, label").all() as unknown as EntityRow[]);
    return rows.map(rowToEntity);
  }

  /** Hydrate an explicit entity allowlist with one bounded query. */
  listEntitiesByRefs(entityRefs: Array<{ kind: string; id: string }>): EntityRecord[] {
    if (entityRefs.length === 0) return [];
    const refs = [...new Map(
      entityRefs.map((ref) => [`${ref.kind}\u0000${ref.id}`, { kind: ref.kind, id: ref.id }])
    ).values()];
    const rows = this.db.prepare(`
      WITH requested(kind, id) AS (
        SELECT json_extract(value, '$.kind'), json_extract(value, '$.id')
        FROM json_each(?)
      )
      SELECT entities.*
      FROM requested
      JOIN entities ON entities.kind = requested.kind AND entities.id = requested.id
      ORDER BY entities.kind, entities.label
    `).all(JSON.stringify(refs)) as unknown as EntityRow[];
    return rows.map(rowToEntity);
  }

  /** Bounded lexical entity discovery used by Context suggestions. */
  searchEntityCandidates(
    query: string,
    options: { allowedRefs?: string[]; excludeRefs?: string[]; limit?: number } = {}
  ): EntityRecord[] {
    const terms = uniqueStrings(query
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? [])
      .filter((term) => term.length > 1)
      .slice(0, 12);
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    if (terms.length === 0) return [];
    const filters: string[] = [];
    const filterParams: string[] = [];
    if (options.allowedRefs) {
      if (options.allowedRefs.length === 0) return [];
      filters.push("(e.kind || ':' || e.id) IN (SELECT value FROM json_each(?))");
      filterParams.push(JSON.stringify(uniqueStrings(options.allowedRefs)));
    }
    if ((options.excludeRefs?.length ?? 0) > 0) {
      filters.push("(e.kind || ':' || e.id) NOT IN (SELECT value FROM json_each(?))");
      filterParams.push(JSON.stringify(uniqueStrings(options.excludeRefs ?? [])));
    }
    const scopeFilter = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
    try {
      const rows = this.db
        .prepare(`
          SELECT e.*, bm25(entities_fts, 0.0, 2.0, 5.0, 2.0, 1.0, 1.0) AS lexicalScore
          FROM entities_fts
          JOIN entities e ON e.rowid = entities_fts.rowid
          WHERE entities_fts MATCH ?
          ${scopeFilter}
          ORDER BY lexicalScore ASC, e.kind ASC, e.label COLLATE NOCASE ASC, e.id ASC
          LIMIT ?
        `)
        .all(toFtsQuery(query, 12), ...filterParams, limit) as unknown as EntityRow[];
      return rows.map(rowToEntity);
    } catch (error) {
      if (!isFtsUnavailable(error)) throw error;
      // Minimal safe fallback for installations where SQLite was built without
      // FTS5. Prefix-only matching can use idx_entities_label_nocase and avoids
      // the unbounded contains scan this API replaced.
      const fallbackTerms = terms.slice(0, 4);
      const fallbackMatch = fallbackTerms
        .map(() => "(e.id = ? COLLATE NOCASE OR e.label LIKE ? ESCAPE '\\' COLLATE NOCASE)")
        .join(" OR ");
      const fallbackParams = fallbackTerms.flatMap((term) => [term, `${escapeLikePattern(term)}%`]);
      const rows = this.db
        .prepare(`
          SELECT e.*
          FROM entities e
          WHERE (${fallbackMatch})
          ${scopeFilter}
          ORDER BY e.kind ASC, e.label COLLATE NOCASE ASC, e.id ASC
          LIMIT ?
        `)
        .all(...fallbackParams, ...filterParams, limit) as unknown as EntityRow[];
      return rows.map(rowToEntity);
    }
  }

  /** Bounded one-hop expansion from lexical anchors, with no entity-table scan. */
  listEntityNeighborCandidates(
    anchorRefs: string[],
    options: { allowedRefs?: string[]; excludeRefs?: string[]; limit?: number } = {}
  ): EntityRecord[] {
    const anchors = uniqueStrings(anchorRefs);
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    if (anchors.length === 0) return [];
    const filters: string[] = [];
    const params: string[] = [JSON.stringify(anchors)];
    if (options.allowedRefs) {
      if (options.allowedRefs.length === 0) return [];
      filters.push("(e.kind || ':' || e.id) IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(uniqueStrings(options.allowedRefs)));
    }
    if ((options.excludeRefs?.length ?? 0) > 0) {
      filters.push("(e.kind || ':' || e.id) NOT IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(uniqueStrings(options.excludeRefs ?? [])));
    }
    const rows = this.db
      .prepare(`
        WITH anchors(ref) AS (
          SELECT value FROM json_each(?)
        ), neighbors(kind, id) AS (
          SELECT er.target_kind, er.target_id
          FROM entity_relations er
          JOIN anchors a ON a.ref = er.source_kind || ':' || er.source_id
          UNION ALL
          SELECT er.source_kind, er.source_id
          FROM entity_relations er
          JOIN anchors a ON a.ref = er.target_kind || ':' || er.target_id
        )
        SELECT e.*, COUNT(*) AS anchorLinks
        FROM neighbors n
        JOIN entities e ON e.kind = n.kind AND e.id = n.id
        ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
        GROUP BY e.kind, e.id
        ORDER BY anchorLinks DESC, e.kind ASC, e.label COLLATE NOCASE ASC, e.id ASC
        LIMIT ?
      `)
      .all(...params, limit) as unknown as EntityRow[];
    return rows.map(rowToEntity);
  }

  /** Batch topology/evidence counters for an already bounded candidate set. */
  getEntityCandidateMetrics(entityRefs: string[], anchorRefs: string[]): Map<string, EntityCandidateMetrics> {
    const refs = uniqueStrings(entityRefs);
    if (refs.length === 0) return new Map();
    const rows = this.db
      .prepare(`
        WITH requested(ref) AS (
          SELECT value FROM json_each(?)
        ), anchors(ref) AS (
          SELECT value FROM json_each(?)
        ), relation_refs(ref, relation_id) AS (
          SELECT er.source_kind || ':' || er.source_id, er.id FROM entity_relations er
          UNION ALL
          SELECT er.target_kind || ':' || er.target_id, er.id FROM entity_relations er
        ), capture_refs(ref, capture_id) AS (
          SELECT c.primary_entity_kind || ':' || c.primary_entity_id, c.id FROM captures c
          UNION
          SELECT ce.entity_kind || ':' || ce.entity_id, ce.capture_id FROM capture_entities ce
        ), anchor_edges(ref, relation_id) AS (
          SELECT er.source_kind || ':' || er.source_id, er.id
          FROM entity_relations er
          JOIN anchors a ON a.ref = er.target_kind || ':' || er.target_id
          UNION ALL
          SELECT er.target_kind || ':' || er.target_id, er.id
          FROM entity_relations er
          JOIN anchors a ON a.ref = er.source_kind || ':' || er.source_id
        ), relation_counts(ref, count) AS (
          SELECT rr.ref, COUNT(DISTINCT rr.relation_id)
          FROM relation_refs rr
          JOIN requested r ON r.ref = rr.ref
          GROUP BY rr.ref
        ), capture_counts(ref, count) AS (
          SELECT cr.ref, COUNT(DISTINCT cr.capture_id)
          FROM capture_refs cr
          JOIN requested r ON r.ref = cr.ref
          GROUP BY cr.ref
        ), anchor_counts(ref, count) AS (
          SELECT ae.ref, COUNT(DISTINCT ae.relation_id)
          FROM anchor_edges ae
          JOIN requested r ON r.ref = ae.ref
          GROUP BY ae.ref
        )
        SELECT
          r.ref,
          COALESCE(rc.count, 0) AS relationCount,
          COALESCE(cc.count, 0) AS captureCount,
          COALESCE(ac.count, 0) AS anchorLinkCount
        FROM requested r
        LEFT JOIN relation_counts rc ON rc.ref = r.ref
        LEFT JOIN capture_counts cc ON cc.ref = r.ref
        LEFT JOIN anchor_counts ac ON ac.ref = r.ref
        ORDER BY r.ref ASC
      `)
      .all(JSON.stringify(refs), JSON.stringify(uniqueStrings(anchorRefs))) as unknown as EntityCandidateMetrics[];
    return new Map(rows.map((row) => [row.ref, row]));
  }

  countCaptureReferences(kind: string, id: string): number {
    const primary = this.db
      .prepare("SELECT COUNT(*) AS count FROM captures WHERE primary_entity_kind = ? AND primary_entity_id = ?")
      .get(kind, id) as { count: number };
    const related = this.db
      .prepare("SELECT COUNT(*) AS count FROM capture_entities WHERE entity_kind = ? AND entity_id = ?")
      .get(kind, id) as { count: number };
    return primary.count + related.count;
  }

  private hasKpiMeasurementHistory(kpiId: string): boolean {
    return Boolean(this.db.prepare(
      "SELECT 1 FROM kpi_measurements WHERE kpi_id = ? LIMIT 1"
    ).get(kpiId));
  }

  private keyResultsReferencingKpi(kpiId: string): Array<{ okrId: string; keyResultId: string }> {
    const references: Array<{ okrId: string; keyResultId: string }> = [];
    for (const entity of this.listEntities("okr")) {
      const outcome = entity.metadata?.outcome;
      if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) continue;
      const keyResults = (outcome as Record<string, unknown>).keyResults;
      if (!Array.isArray(keyResults)) continue;
      for (const keyResult of keyResults) {
        if (!keyResult || typeof keyResult !== "object" || Array.isArray(keyResult)) continue;
        const record = keyResult as Record<string, unknown>;
        if (record.kpiId === kpiId) {
          references.push({ okrId: entity.id, keyResultId: String(record.id || "unknown") });
        }
      }
    }
    return references;
  }

  deleteEntity(kind: string, id: string, options: { reassignToDefault?: boolean } = {}): void {
    if (kind === "oneagent" && id === DEFAULT_ENTITY_ID) {
      throw new Error("The default oneagent entity cannot be deleted.");
    }

    this.transaction(() => {
      if (kind === "kpi" && this.hasKpiMeasurementHistory(id)) {
        throw new Error(
          `KPI ${id} has measurement history and cannot be deleted; archive it instead.`
        );
      }
      if (kind === "kpi") {
        const keyResultReferences = this.keyResultsReferencingKpi(id);
        if (keyResultReferences.length > 0) {
          const first = keyResultReferences[0];
          throw new Error(
            `KPI ${id} is referenced by key result ${first.keyResultId} on OKR ${first.okrId}; update the OKR key results before deleting the KPI.`
          );
        }
      }
      const references = this.countCaptureReferences(kind, id);
      if (references > 0 && !options.reassignToDefault) {
        throw new Error(
          `Entity ${kind}:${id} is referenced by ${references} capture(s). Re-run with reassignment to oneagent.`
        );
      }
      if (options.reassignToDefault) {
        this.db
          .prepare(`
            UPDATE captures
            SET primary_entity_kind = 'oneagent', primary_entity_id = ?, updated_at = ?
            WHERE primary_entity_kind = ? AND primary_entity_id = ?
          `)
          .run(DEFAULT_ENTITY_ID, nowIso(), kind, id);
        this.db
          .prepare("DELETE FROM capture_entities WHERE entity_kind = ? AND entity_id = ?")
          .run(kind, id);
      }
      this.db
        .prepare("DELETE FROM entity_relations WHERE (source_kind = ? AND source_id = ?) OR (target_kind = ? AND target_id = ?)")
        .run(kind, id, kind, id);
      this.db.prepare("DELETE FROM task_links WHERE target_kind = ? AND target_id = ?").run(kind, id);
      const result = this.db.prepare("DELETE FROM entities WHERE kind = ? AND id = ?").run(kind, id);
      if (result.changes === 0) {
        throw new Error(`Entity not found: ${kind}:${id}`);
      }
    }, "immediate");
  }

  /**
   * Merge `from` into `into`: captures and typed relations are re-pointed (deduped,
   * self-loops dropped), the source's id/label/aliases become aliases of the target
   * (so entity resolution keeps matching the old names), then the source is deleted.
   */
  mergeEntities(
    fromKind: EntityKind,
    fromId: string,
    intoKind: EntityKind,
    intoId: string
  ): { capturesReassigned: number; relationsRewritten: number; relationsDropped: number } {
    if (fromKind === intoKind && fromId === intoId) {
      throw new Error("Cannot merge an entity into itself.");
    }
    if (fromKind === "oneagent" && fromId === DEFAULT_ENTITY_ID) {
      throw new Error("The default oneagent entity cannot be merged away.");
    }
    if ([fromKind, intoKind].some((kind) => kind === "okr" || kind === "kpi")) {
      throw new Error(
        "Generic entity merge cannot merge an OKR or KPI because their structured definitions and measurement identities require a dedicated outcome migration."
      );
    }
    const from = this.getEntity(fromKind, fromId);
    if (!from) {
      throw new Error(`Entity not found: ${fromKind}:${fromId}`);
    }
    const into = this.getEntity(intoKind, intoId);
    if (!into) {
      throw new Error(`Entity not found: ${intoKind}:${intoId}`);
    }
    let capturesReassigned = 0;
    let relationsRewritten = 0;
    let relationsDropped = 0;

    this.transaction(() => {
      const primary = this.db
        .prepare(`
          UPDATE captures
          SET primary_entity_kind = ?, primary_entity_id = ?, updated_at = ?
          WHERE primary_entity_kind = ? AND primary_entity_id = ?
        `)
        .run(intoKind, intoId, nowIso(), fromKind, fromId);
      capturesReassigned += Number(primary.changes);

      // Re-point capture references; the PK dedupes rows that already exist on the target.
      const related = this.db
        .prepare("SELECT capture_id AS captureId, relation_type AS relationType FROM capture_entities WHERE entity_kind = ? AND entity_id = ?")
        .all(fromKind, fromId) as unknown as Array<{ captureId: string; relationType: string }>;
      for (const row of related) {
        this.db
          .prepare(`
            INSERT INTO capture_entities (capture_id, entity_kind, entity_id, relation_type)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(capture_id, entity_kind, entity_id, relation_type) DO NOTHING
          `)
          .run(row.captureId, intoKind, intoId, row.relationType);
        capturesReassigned += 1;
      }
      this.db.prepare("DELETE FROM capture_entities WHERE entity_kind = ? AND entity_id = ?").run(fromKind, fromId);

      // Rewrite typed relations through upsert (stable ids + dedupe); drop self-loops.
      const relations = this.listEntityRelations({ kind: fromKind, id: fromId });
      this.db
        .prepare("DELETE FROM entity_relations WHERE (source_kind = ? AND source_id = ?) OR (target_kind = ? AND target_id = ?)")
        .run(fromKind, fromId, fromKind, fromId);
      for (const relation of relations) {
        const sourceIsFrom = relation.sourceKind === fromKind && relation.sourceId === fromId;
        const targetIsFrom = relation.targetKind === fromKind && relation.targetId === fromId;
        const sourceKind = sourceIsFrom ? intoKind : relation.sourceKind;
        const sourceId = sourceIsFrom ? intoId : relation.sourceId;
        const targetKind = targetIsFrom ? intoKind : relation.targetKind;
        const targetId = targetIsFrom ? intoId : relation.targetId;
        if (sourceKind === targetKind && sourceId === targetId) {
          relationsDropped += 1;
          continue;
        }
        this.upsertEntityRelation({
          sourceKind,
          sourceId,
          targetKind,
          targetId,
          relationType: relation.relationType,
          description: relation.description ?? null,
          metadata: relation.metadata ?? null
        });
        relationsRewritten += 1;
      }

      const taskLinks = this.db.prepare(`
        SELECT task_id AS taskId, relation_type AS relationType, label,
               metadata_json AS metadataJson
        FROM task_links WHERE target_kind = ? AND target_id = ?
      `).all(fromKind, fromId) as unknown as Array<{
        taskId: string;
        relationType: string;
        label?: string;
        metadataJson?: string;
      }>;
      this.db.prepare("DELETE FROM task_links WHERE target_kind = ? AND target_id = ?").run(fromKind, fromId);
      for (const link of taskLinks) {
        this.upsertTaskLink({
          taskId: link.taskId,
          relationType: link.relationType,
          targetKind: intoKind,
          targetId: intoId,
          label: link.label,
          metadata: parseJsonObject(link.metadataJson ?? null)
        });
      }
      // The old names keep resolving: from's id, label and aliases become target aliases.
      const aliasPool = new Set(into.aliases ?? []);
      for (const alias of [from.id, from.label, ...(from.aliases ?? [])]) {
        const trimmed = alias.trim();
        if (trimmed && trimmed !== into.id && trimmed !== into.label) {
          aliasPool.add(trimmed);
        }
      }
      this.upsertEntity({
        id: intoId,
        kind: intoKind,
        aliases: [...aliasPool],
        tags: [...new Set([...(into.tags ?? []), ...(from.tags ?? [])])],
        description: into.description ?? from.description ?? null
      });

      this.db.prepare("DELETE FROM entities WHERE kind = ? AND id = ?").run(fromKind, fromId);
    }, "immediate");

    return { capturesReassigned, relationsRewritten, relationsDropped };
  }

  upsertEntityRelation(input: {
    sourceKind: EntityKind;
    sourceId: string;
    targetKind: EntityKind;
    targetId: string;
    relationType: string;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
  }): EntityRelationRecord {
    // Apply taxonomy aliases: merged-away relation types land on their target type,
    // swapping source and target when the alias is the semantic inverse.
    const resolved = resolveRelationType(input.relationType);
    if (resolved.type !== input.relationType || resolved.swapDirection) {
      input = {
        ...input,
        sourceKind: resolved.swapDirection ? input.targetKind : input.sourceKind,
        sourceId: resolved.swapDirection ? input.targetId : input.sourceId,
        targetKind: resolved.swapDirection ? input.sourceKind : input.targetKind,
        targetId: resolved.swapDirection ? input.sourceId : input.targetId,
        relationType: resolved.type
      };
    }
    input = {
      ...input,
      sourceKind: resolveEntityKind(input.sourceKind),
      targetKind: resolveEntityKind(input.targetKind)
    };
    if (
      this.transactionDepth === 0
      && (this.entityPageWriter || ["has_okr", "measured_by", "contributes_to"].includes(input.relationType))
    ) {
      return this.runInImmediateTransaction(() => this.upsertEntityRelation(input));
    }
    this.assertOutcomeEntityRelation(input);
    const id = createStableId("erel", [
      input.sourceKind,
      input.sourceId,
      input.targetKind,
      input.targetId,
      input.relationType
    ]);
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO entity_relations (
          id, source_kind, source_id, target_kind, target_id, relation_type,
          description, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_kind, source_id, target_kind, target_id, relation_type) DO UPDATE SET
          description = excluded.description,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        input.sourceKind,
        input.sourceId,
        input.targetKind,
        input.targetId,
        input.relationType,
        input.description ?? null,
        toJson(input.metadata),
        now,
        now
      );

    if (this.entityPageWriter) {
      for (const ref of [
        { kind: input.sourceKind, id: input.sourceId },
        { kind: input.targetKind, id: input.targetId }
      ]) {
        const entity = this.getEntity(ref.kind, ref.id);
        if (entity) this.onRollback(this.entityPageWriter(entity).undo);
      }
    }

    return {
      id,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      relationType: input.relationType,
      description: input.description ?? undefined,
      metadata: input.metadata ?? undefined,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Outcome links carry structural meaning used by the pilotage views. Keep
   * their shape valid at the lowest shared write boundary while leaving legacy
   * and workspace-defined relation types untouched.
   */
  private assertOutcomeEntityRelation(input: {
    sourceKind: string;
    sourceId: string;
    targetKind: string;
    targetId: string;
    relationType: string;
  }): void {
    const expectedEndpoints: Record<string, { sourceKinds: string[]; targetKind: string }> = {
      has_okr: { sourceKinds: ["mission"], targetKind: "okr" },
      measured_by: { sourceKinds: ["okr"], targetKind: "kpi" },
      contributes_to: { sourceKinds: ["project", "feature"], targetKind: "okr" }
    };
    const expected = expectedEndpoints[input.relationType];
    if (!expected) return;

    const source = this.getEntity(input.sourceKind, input.sourceId);
    if (!source) {
      throw new Error(
        `Cannot create ${input.relationType}: source entity not found: ${input.sourceKind}:${input.sourceId}.`
      );
    }
    const target = this.getEntity(input.targetKind, input.targetId);
    if (!target) {
      throw new Error(
        `Cannot create ${input.relationType}: target entity not found: ${input.targetKind}:${input.targetId}.`
      );
    }
    if (!expected.sourceKinds.includes(input.sourceKind) || input.targetKind !== expected.targetKind) {
      throw new Error(
        `Invalid ${input.relationType} relation: expected ${expected.sourceKinds.join(" or ")} -> ${expected.targetKind}, received ${input.sourceKind} -> ${input.targetKind}.`
      );
    }

    if (input.relationType === "has_okr") {
      const existingMission = this.db.prepare(`
        SELECT source_id AS sourceId
        FROM entity_relations
        WHERE relation_type = 'has_okr'
          AND source_kind = 'mission'
          AND target_kind = 'okr'
          AND target_id = ?
          AND source_id <> ?
        LIMIT 1
      `).get(input.targetId, input.sourceId) as { sourceId: string } | undefined;
      if (existingMission) {
        throw new Error(
          `OKR ${input.targetId} is already linked to mission ${existingMission.sourceId}; has_okr allows at most one mission per OKR.`
        );
      }
    }
  }

  listEntityRelations(filter: { kind?: string; id?: string } = {}): EntityRelationRecord[] {
    let sql = "SELECT * FROM entity_relations";
    const params: string[] = [];
    if (filter.kind && filter.id) {
      sql += " WHERE (source_kind = ? AND source_id = ?) OR (target_kind = ? AND target_id = ?)";
      params.push(filter.kind, filter.id, filter.kind, filter.id);
    }
    sql += " ORDER BY updated_at DESC";
    const rows = this.db.prepare(sql).all(...params) as unknown as EntityRelationRow[];
    return rows.map(rowToEntityRelation);
  }

  /** Return every relation incident to an explicit entity set in one query. */
  listEntityRelationsForEntities(entityRefs: Array<{ kind: string; id: string }>): EntityRelationRecord[] {
    if (entityRefs.length === 0) return [];
    const refs = [...new Map(
      entityRefs.map((ref) => [`${ref.kind}\u0000${ref.id}`, { kind: ref.kind, id: ref.id }])
    ).values()];
    const rows = this.db.prepare(`
      WITH requested(kind, id) AS (
        SELECT json_extract(value, '$.kind'), json_extract(value, '$.id')
        FROM json_each(?)
      )
      SELECT DISTINCT entity_relations.*
      FROM requested
      JOIN entity_relations
        ON (entity_relations.source_kind = requested.kind AND entity_relations.source_id = requested.id)
        OR (entity_relations.target_kind = requested.kind AND entity_relations.target_id = requested.id)
      ORDER BY entity_relations.updated_at DESC, entity_relations.id
    `).all(JSON.stringify(refs)) as unknown as EntityRelationRow[];
    return rows.map(rowToEntityRelation);
  }

  deleteEntityRelation(id: string): void {
    if (this.transactionDepth === 0) {
      this.runInImmediateTransaction(() => this.deleteEntityRelation(id));
      return;
    }
    const relation = this.db.prepare("SELECT * FROM entity_relations WHERE id = ?").get(id) as EntityRelationRow | undefined;
    if (!relation) throw new Error(`Entity relation not found: ${id}`);
    const normalized = rowToEntityRelation(relation);
    if (
      normalized.relationType === "measured_by"
      && normalized.sourceKind === "okr"
      && normalized.targetKind === "kpi"
    ) {
      const keyResult = this.keyResultsReferencingKpi(normalized.targetId)
        .find((reference) => reference.okrId === normalized.sourceId);
      if (keyResult) {
        throw new Error(
          `Cannot delete measured_by ${normalized.sourceId} -> ${normalized.targetId}: key result ${keyResult.keyResultId} still references the KPI. Update the OKR key results first.`
        );
      }
    }
    const result = this.db.prepare("DELETE FROM entity_relations WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`Entity relation not found: ${id}`);
    if (this.entityPageWriter) {
      for (const ref of [
        { kind: normalized.sourceKind, id: normalized.sourceId },
        { kind: normalized.targetKind, id: normalized.targetId }
      ]) {
        const entity = this.getEntity(ref.kind, ref.id);
        if (entity) this.onRollback(this.entityPageWriter(entity).undo);
      }
    }
  }

  createCapture(input: {
    id?: string;
    path?: string | null;
    title: string;
    contentType: CaptureRecord["contentType"];
    status?: CaptureRecord["status"];
    primaryEntityKind?: EntityKind;
    primaryEntityId?: string;
    relatedEntities?: CaptureEntityRef[];
    sourceKind: CaptureRecord["sourceKind"];
    sourceOrigin: CaptureRecord["sourceOrigin"];
    ingestionStatus?: CaptureRecord["ingestionStatus"];
    tags?: string[];
    contentHash?: string | null;
  }): CaptureRecord {
    const id = input.id ?? createId("cap");
    const now = nowIso();
    const primaryEntityKind = input.primaryEntityKind ?? "oneagent";
    const primaryEntityId = input.primaryEntityId ?? DEFAULT_ENTITY_ID;

    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO captures (
            id, path, title, content_type, status, primary_entity_kind, primary_entity_id,
            source_kind, source_origin, ingestion_status, tags_json, content_hash, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.path ?? null,
          input.title,
          input.contentType,
          input.status ?? "captured",
          primaryEntityKind,
          primaryEntityId,
          input.sourceKind,
          input.sourceOrigin,
          input.ingestionStatus ?? "not_ingested",
          toJson(input.tags),
          input.contentHash ?? null,
          now,
          now
        );

      for (const ref of input.relatedEntities ?? []) {
        this.insertCaptureEntity(id, ref);
      }
    });

    return this.getCapture(id) as CaptureRecord;
  }

  updateCapture(id: string, update: CaptureUpdate): CaptureRecord {
    const current = this.getCapture(id);
    if (!current) {
      throw new Error(`Capture not found: ${id}`);
    }
    const title = update.title === undefined ? current.title : update.title.trim();
    if (!title) {
      throw new Error("Capture title cannot be empty.");
    }
    const primaryEntity = update.primaryEntity ?? {
      kind: current.primaryEntityKind,
      id: current.primaryEntityId
    };
    if (update.primaryEntity && !this.getEntity(primaryEntity.kind, primaryEntity.id)) {
      throw new Error(`Capture primary entity does not exist: ${primaryEntity.kind}:${primaryEntity.id}`);
    }
    const tags = update.tags === undefined
      ? current.tags
      : [...new Set(update.tags.map((tag) => tag.trim()).filter(Boolean))];
    this.db.prepare(`
      UPDATE captures
      SET title = ?,
          content_type = ?,
          primary_entity_kind = ?,
          primary_entity_id = ?,
          tags_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      title,
      update.contentType ?? current.contentType,
      resolveEntityKind(primaryEntity.kind),
      primaryEntity.id,
      toJson(tags),
      nowIso(),
      id
    );
    return this.getCapture(id) as CaptureRecord;
  }

  getCapture(id: string): CaptureRecord | undefined {
    const row = this.db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as CaptureRow | undefined;
    if (!row) {
      return undefined;
    }
    return rowToCapture(row, this.listCaptureEntities(id));
  }

  /** Hydrate captures and their related entity refs in two bounded queries. */
  listCapturesByIds(captureIds: string[]): CaptureRecord[] {
    if (captureIds.length === 0) return [];
    const ids = [...new Set(captureIds)];
    const rows = this.db.prepare(`
      SELECT * FROM captures
      WHERE id IN (SELECT value FROM json_each(?))
      ORDER BY created_at DESC
    `).all(JSON.stringify(ids)) as unknown as CaptureRow[];
    const refs = this.db.prepare(`
      SELECT capture_id AS captureId, entity_kind AS entityKind,
             entity_id AS entityId, relation_type AS relationType
      FROM capture_entities
      WHERE capture_id IN (SELECT value FROM json_each(?))
      ORDER BY capture_id, entity_kind, entity_id, relation_type
    `).all(JSON.stringify(ids)) as unknown as Array<CaptureEntityRef & { captureId: string }>;
    const refsByCapture = new Map<string, CaptureEntityRef[]>();
    for (const { captureId, ...ref } of refs) {
      const current = refsByCapture.get(captureId) ?? [];
      current.push(ref);
      refsByCapture.set(captureId, current);
    }
    return rows.map((row) => rowToCapture(row, refsByCapture.get(row.id) ?? []));
  }

  listCaptures(
    filter: {
      primaryEntityKind?: string;
      primaryEntityId?: string;
      contentType?: string;
      status?: string;
      ingestionStatus?: string;
      curationStatus?: string;
    } = {}
  ): CaptureRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.primaryEntityKind) {
      clauses.push("primary_entity_kind = ?");
      params.push(filter.primaryEntityKind);
    }
    if (filter.primaryEntityId) {
      clauses.push("primary_entity_id = ?");
      params.push(filter.primaryEntityId);
    }
    if (filter.contentType) {
      clauses.push("content_type = ?");
      params.push(filter.contentType);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.ingestionStatus) {
      clauses.push("ingestion_status = ?");
      params.push(filter.ingestionStatus);
    }
    if (filter.curationStatus) {
      clauses.push("COALESCE(curation_status, 'pending') = ?");
      params.push(filter.curationStatus);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM captures ${where} ORDER BY created_at DESC`)
      .all(...params) as unknown as CaptureRow[];
    return rows.map((row) => rowToCapture(row, this.listCaptureEntities(row.id)));
  }

  /** All captures where the entity is the primary OR a related entity (deduped). */
  listCapturesForEntity(kind: string, id: string): CaptureRecord[] {
    const ids = new Set<string>();
    for (const row of this.db
      .prepare("SELECT id FROM captures WHERE primary_entity_kind = ? AND primary_entity_id = ?")
      .all(kind, id) as Array<{ id: string }>) {
      ids.add(row.id);
    }
    for (const row of this.db
      .prepare("SELECT DISTINCT capture_id AS id FROM capture_entities WHERE entity_kind = ? AND entity_id = ?")
      .all(kind, id) as Array<{ id: string }>) {
      ids.add(row.id);
    }
    return [...ids]
      .map((captureId) => this.getCapture(captureId))
      .filter((capture): capture is CaptureRecord => Boolean(capture))
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  }

  /**
   * Resolve capture/source provenance for an explicit entity set in one query.
   * A capture linked both as primary and related is returned once per entity.
   */
  listEntityCaptureContextRecords(
    entityRefs: Array<{ kind: string; id: string }>
  ): EntityCaptureContextRecord[] {
    if (entityRefs.length === 0) return [];
    const refs = [...new Map(
      entityRefs.map((ref) => [`${ref.kind}\u0000${ref.id}`, { kind: ref.kind, id: ref.id }])
    ).values()];
    return this.db.prepare(`
      WITH requested(kind, id) AS (
        SELECT json_extract(value, '$.kind'), json_extract(value, '$.id')
        FROM json_each(?)
      ), matched(entityKind, entityId, captureId) AS (
        SELECT requested.kind, requested.id, captures.id
        FROM requested
        JOIN captures
          ON captures.primary_entity_kind = requested.kind
         AND captures.primary_entity_id = requested.id
        UNION
        SELECT requested.kind, requested.id, capture_entities.capture_id
        FROM requested
        JOIN capture_entities
          ON capture_entities.entity_kind = requested.kind
         AND capture_entities.entity_id = requested.id
      )
      SELECT
        matched.entityKind,
        matched.entityId,
        captures.id AS captureId,
        captures.source_id AS sourceId,
        captures.created_at AS createdAt
      FROM matched
      JOIN captures ON captures.id = matched.captureId
      ORDER BY captures.created_at DESC, matched.entityKind, matched.entityId, captures.id
    `).all(JSON.stringify(refs)) as unknown as EntityCaptureContextRecord[];
  }

  classifyCapture(id: string, primaryEntityKind: EntityKind, primaryEntityId: string): CaptureRecord {
    const result = this.db
      .prepare("UPDATE captures SET primary_entity_kind = ?, primary_entity_id = ?, updated_at = ? WHERE id = ?")
      .run(primaryEntityKind, primaryEntityId, nowIso(), id);
    if (result.changes === 0) {
      throw new Error(`Capture not found: ${id}`);
    }
    return this.getCapture(id) as CaptureRecord;
  }

  relateCapture(id: string, ref: CaptureEntityRef): CaptureRecord {
    if (!this.getCapture(id)) {
      throw new Error(`Capture not found: ${id}`);
    }
    this.insertCaptureEntity(id, ref);
    this.touchCapture(id);
    return this.getCapture(id) as CaptureRecord;
  }

  unrelateCapture(id: string, entityKind: string, entityId: string): CaptureRecord {
    if (!this.getCapture(id)) {
      throw new Error(`Capture not found: ${id}`);
    }
    this.db
      .prepare("DELETE FROM capture_entities WHERE capture_id = ? AND entity_kind = ? AND entity_id = ?")
      .run(id, entityKind, entityId);
    this.touchCapture(id);
    return this.getCapture(id) as CaptureRecord;
  }

  updateCaptureIngestion(
    id: string,
    update: {
      ingestionStatus: CaptureRecord["ingestionStatus"];
      lastIngestedAt?: string;
      contentHash?: string;
      sourceId?: string;
      error?: string | null;
    }
  ): CaptureRecord {
    const result = this.db
      .prepare(`
        UPDATE captures
        SET ingestion_status = ?,
            last_ingested_at = COALESCE(?, last_ingested_at),
            content_hash = COALESCE(?, content_hash),
            source_id = COALESCE(?, source_id),
            error = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        update.ingestionStatus,
        update.lastIngestedAt ?? null,
        update.contentHash ?? null,
        update.sourceId ?? null,
        update.error ?? null,
        nowIso(),
        id
      );
    if (result.changes === 0) {
      throw new Error(`Capture not found: ${id}`);
    }
    return this.getCapture(id) as CaptureRecord;
  }

  updateCaptureCuration(
    id: string,
    update: {
      curationStatus: CaptureRecord["curationStatus"];
      curatedAt?: string | null;
      curationSummary?: string | null;
    }
  ): CaptureRecord {
    const result = this.db
      .prepare(`
        UPDATE captures
        SET curation_status = ?,
            curated_at = ?,
            curation_summary = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        update.curationStatus,
        update.curatedAt !== undefined
          ? update.curatedAt
          : update.curationStatus === "curated"
            ? nowIso()
            : null,
        update.curationSummary === undefined ? null : update.curationSummary,
        nowIso(),
        id
      );
    if (result.changes === 0) {
      throw new Error(`Capture not found: ${id}`);
    }
    return this.getCapture(id) as CaptureRecord;
  }

  setCaptureStatus(id: string, status: CaptureRecord["status"]): CaptureRecord {
    const result = this.db
      .prepare("UPDATE captures SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), id);
    if (result.changes === 0) {
      throw new Error(`Capture not found: ${id}`);
    }
    return this.getCapture(id) as CaptureRecord;
  }

  private insertCaptureEntity(captureId: string, ref: CaptureEntityRef): void {
    this.db
      .prepare(`
        INSERT INTO capture_entities (capture_id, entity_kind, entity_id, relation_type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(capture_id, entity_kind, entity_id, relation_type) DO NOTHING
      `)
      .run(captureId, ref.entityKind, ref.entityId, ref.relationType);
  }

  private listCaptureEntities(captureId: string): CaptureEntityRef[] {
    const rows = this.db
      .prepare("SELECT entity_kind AS entityKind, entity_id AS entityId, relation_type AS relationType FROM capture_entities WHERE capture_id = ?")
      .all(captureId) as unknown as CaptureEntityRef[];
    return rows;
  }

  private touchCapture(id: string): void {
    this.db.prepare("UPDATE captures SET updated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  insertSource(source: SourceRecord, entityRefs: EntityRef[] | string[]): void {
    const now = nowIso();
    const legacyProductIds = entityRefs.filter((ref): ref is string => typeof ref === "string");
    const normalizedEntityRefs = normalizeSourceEntityRefs(entityRefs);
    this.transaction(() => {
      const logicalKey = source.logicalKey ?? source.rawPath ?? source.originUri ?? source.id;
      const existing = this.db
        .prepare("SELECT revision FROM sources WHERE id = ?")
        .get(source.id) as { revision: number } | undefined;
      const latest = this.db
        .prepare("SELECT MAX(revision) AS revision FROM sources WHERE logical_key = ?")
        .get(logicalKey) as { revision: number | null };
      const revision = source.revision ?? existing?.revision ?? Number(latest.revision ?? 0) + 1;
      this.db
        .prepare(`
          INSERT INTO sources (
            id, logical_key, revision, superseded_by, title, source_type, origin,
            origin_uri, raw_path, content_hash, captured_at, source_date, language,
            status, created_at, updated_at
          )
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            logical_key = excluded.logical_key,
            revision = excluded.revision,
            superseded_by = NULL,
            title = excluded.title,
            status = CASE
              WHEN sources.status = 'indexed' AND excluded.status = 'indexing' THEN sources.status
              ELSE excluded.status
            END,
            updated_at = excluded.updated_at
        `)
        .run(
          source.id,
          logicalKey,
          revision,
          source.title,
          source.sourceType,
          source.origin,
          source.originUri ?? null,
          source.rawPath ?? null,
          source.contentHash,
          source.capturedAt,
          source.sourceDate ?? null,
          source.language ?? null,
          source.status,
          now,
          now
        );

      const link = this.db.prepare(`
        INSERT INTO source_entities (source_id, entity_kind, entity_id, relation_type, confidence)
        VALUES (?, ?, ?, 'about', 1.0)
        ON CONFLICT(source_id, entity_kind, entity_id, relation_type)
        DO UPDATE SET confidence = excluded.confidence
      `);
      // `entityRefs` is the complete current classification of the source. A
      // forced reingest after editing a capture must remove stale entity scope,
      // not accumulate the old and new primary entities forever.
      this.db.prepare("DELETE FROM source_entities WHERE source_id = ?").run(source.id);
      // Migration-only adapter for old callers that supplied bare product ids.
      // They are materialized immediately as ordinary typed graph entities.
      for (const productId of legacyProductIds) {
        if (!this.getEntity("product", productId)) {
          const legacy = this.db.prepare("SELECT label, description FROM products WHERE id = ?")
            .get(productId) as { label?: string; description?: string } | undefined;
          this.upsertEntity({
            kind: "product",
            id: productId,
            label: legacy?.label ?? productId,
            description: legacy?.description
          });
        }
      }
      for (const entity of normalizedEntityRefs) {
        if (!this.getEntity(entity.kind, entity.id)) {
          throw new Error(`Source entity does not exist: ${entity.kind}:${entity.id}`);
        }
        link.run(source.id, entity.kind, entity.id);
      }
    });
  }

  /**
   * Hydrate the complete source plane for a self-contained export. The regular
   * source readers intentionally omit immutable body identity fields; backups
   * must retain them so observations and KPI measurements can be restored
   * without detaching their provenance.
   */
  listSourceProvenance(): SourceProvenanceRecord[] {
    const sources = this.db.prepare(`
      SELECT id, logical_key AS logicalKey, revision, superseded_by AS supersededBy,
             title, source_type AS sourceType, origin, origin_uri AS originUri,
             raw_path AS rawPath, content_hash AS contentHash, captured_at AS capturedAt,
             source_date AS sourceDate, language, status
      FROM sources
      ORDER BY id
    `).all() as unknown as SourceRecord[];
    const links = this.db.prepare(`
      SELECT source_id AS sourceId, entity_kind AS kind, entity_id AS id,
             relation_type AS relationType, confidence
      FROM source_entities
      ORDER BY source_id, entity_kind, entity_id, relation_type
    `).all() as unknown as Array<{ sourceId: string; kind: EntityKind; id: string; relationType: string; confidence: number }>;
    const linksBySource = new Map<string, Array<EntityRef & { relationType: string; confidence: number }>>();
    for (const { sourceId, ...link } of links) {
      const current = linksBySource.get(sourceId) ?? [];
      current.push(link);
      linksBySource.set(sourceId, current);
    }
    return sources.map((source) => ({ ...source, entityLinks: linksBySource.get(source.id) ?? [] }));
  }

  /** Restore one exported source exactly enough to preserve revision identity and lifecycle. */
  restoreSourceProvenance(record: SourceProvenanceRecord): void {
    const {
      entityLinks = [],
      productLinks = [],
      ...source
    } = record;
    const restoredEntityLinks = uniqueEntityRefs([
      ...entityLinks,
      ...productLinks.map((link) => ({ kind: "product" as const, id: link.productId }))
    ]);
    const existing = this.db.prepare(`
      SELECT content_hash AS contentHash
      FROM sources
      WHERE id = ?
    `).get(source.id) as { contentHash: string } | undefined;
    if (existing && existing.contentHash !== source.contentHash) {
      throw new Error(`Cannot restore source ${source.id}: its content hash conflicts with the existing immutable source.`);
    }
    const now = nowIso();
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO sources (
          id, logical_key, revision, superseded_by, title, source_type, origin,
          origin_uri, raw_path, content_hash, captured_at, source_date, language,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          logical_key = excluded.logical_key,
          revision = excluded.revision,
          superseded_by = excluded.superseded_by,
          title = excluded.title,
          source_type = excluded.source_type,
          origin = excluded.origin,
          origin_uri = excluded.origin_uri,
          raw_path = excluded.raw_path,
          captured_at = excluded.captured_at,
          source_date = excluded.source_date,
          language = excluded.language,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        source.id,
        source.logicalKey ?? source.rawPath ?? source.originUri ?? source.id,
        source.revision ?? 1,
        source.supersededBy ?? null,
        source.title,
        source.sourceType,
        source.origin,
        source.originUri ?? null,
        source.rawPath ?? null,
        source.contentHash,
        source.capturedAt,
        source.sourceDate ?? null,
        source.language ?? null,
        source.status,
        now,
        now
      );
      const upsertLink = this.db.prepare(`
        INSERT INTO source_entities (source_id, entity_kind, entity_id, relation_type, confidence)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_id, entity_kind, entity_id, relation_type)
        DO UPDATE SET confidence = excluded.confidence
      `);
      for (const link of restoredEntityLinks) {
        if (!this.getEntity(link.kind, link.id)) continue;
        const original = entityLinks.find((candidate) => candidate.kind === link.kind && candidate.id === link.id);
        const legacy = productLinks.find((candidate) => link.kind === "product" && candidate.productId === link.id);
        upsertLink.run(
          source.id,
          link.kind,
          link.id,
          original?.relationType ?? "about",
          original?.confidence ?? legacy?.confidence ?? 1
        );
      }
    });
  }

  /** Full chunk bodies are part of the portable provenance closure. */
  listAllSourceChunks(): SourceChunk[] {
    return this.db.prepare(`
      SELECT id, source_id AS sourceId, chunk_index AS chunkIndex, content,
             token_count AS tokenCount, content_hash AS contentHash
      FROM source_chunks
      ORDER BY source_id, chunk_index, id
    `).all() as unknown as SourceChunk[];
  }

  /** Make one fully indexed revision current and supersede every older revision atomically. */
  activateSourceRevision(sourceId: string): void {
    const source = this.db
      .prepare("SELECT logical_key AS logicalKey FROM sources WHERE id = ?")
      .get(sourceId) as { logicalKey: string | null } | undefined;
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const logicalKey = source.logicalKey ?? sourceId;
    this.transaction(() => {
      this.db
        .prepare(`
          UPDATE sources
          SET status = 'superseded', superseded_by = ?, updated_at = ?
          WHERE logical_key = ? AND id <> ? AND status <> 'superseded'
        `)
        .run(sourceId, nowIso(), logicalKey, sourceId);
      this.db
        .prepare("UPDATE sources SET status = 'indexed', superseded_by = NULL, updated_at = ? WHERE id = ?")
        .run(nowIso(), sourceId);
    });
  }

  markSourceRevisionFailed(sourceId: string): void {
    this.db
      .prepare("UPDATE sources SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'indexing'")
      .run(nowIso(), sourceId);
  }

  insertChunks(source: SourceRecord, chunks: SourceChunk[]): void;
  /** @deprecated Compatibility for callers that still pass a discarded product-id list. */
  insertChunks(source: SourceRecord, legacyProductIds: string[], chunks: SourceChunk[]): void;
  insertChunks(
    source: SourceRecord,
    chunksOrLegacyProductIds: SourceChunk[] | string[],
    legacyChunks?: SourceChunk[]
  ): void {
    const chunks = legacyChunks ?? chunksOrLegacyProductIds as SourceChunk[];
    const insertChunk = this.db.prepare(`
      INSERT INTO source_chunks (id, source_id, chunk_index, content, token_count, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id,
        chunk_index = excluded.chunk_index,
        content = excluded.content,
        token_count = excluded.token_count,
        content_hash = excluded.content_hash
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO source_chunks_fts (chunk_id, source_id, product_id, title, content)
      VALUES (?, ?, ?, ?, ?)
    `);

    const incoming = new Map<string, SourceChunk>();
    for (const chunk of chunks) {
      if (chunk.sourceId !== source.id) {
        throw new Error(`Chunk ${chunk.id} belongs to ${chunk.sourceId}, not ${source.id}.`);
      }
      if (incoming.has(chunk.id)) {
        throw new Error(`Duplicate chunk id in source ${source.id}: ${chunk.id}.`);
      }
      incoming.set(chunk.id, chunk);
    }

    this.transaction(() => {
      const existing = this.db
        .prepare("SELECT id, source_id AS sourceId, content, content_hash AS contentHash FROM source_chunks WHERE source_id = ?")
        .all(source.id) as unknown as Array<{ id: string; sourceId: string; content: string; contentHash: string }>;
      const getChunkById = this.db.prepare(
        "SELECT id, source_id AS sourceId, content, content_hash AS contentHash FROM source_chunks WHERE id = ?"
      );
      const referenceCount = this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM observations WHERE source_chunk_id = ?) +
          (SELECT COUNT(*) FROM observation_evidence WHERE source_chunk_id = ?) AS count
      `);

      for (const row of existing) {
        const replacement = incoming.get(row.id);
        const references = Number((referenceCount.get(row.id, row.id) as { count: number }).count);
        if (!replacement) {
          if (references > 0) {
            throw new Error(`Cannot remove source chunk ${row.id}: ${references} observation provenance reference(s) depend on it.`);
          }
          this.db.prepare("DELETE FROM source_chunks WHERE id = ?").run(row.id);
          continue;
        }
        if (references > 0 && (replacement.contentHash !== row.contentHash || replacement.content !== row.content)) {
          throw new Error(`Cannot rewrite cited source chunk ${row.id}; create a new source revision instead.`);
        }
      }

      for (const chunk of chunks) {
        const row = getChunkById.get(chunk.id) as { id: string; sourceId: string; content: string; contentHash: string } | undefined;
        if (row && row.sourceId !== source.id) {
          throw new Error(`Chunk id ${chunk.id} already belongs to source ${row.sourceId}.`);
        }
      }

      this.db.prepare("DELETE FROM source_chunks_fts WHERE source_id = ?").run(source.id);

      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.sourceId,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount,
          chunk.contentHash,
          nowIso()
        );

        insertFts.run(chunk.id, source.id, null, source.title, chunk.content);
      }
    });
  }

  /**
   * Fully remove a capture and everything derived from it: its source with
   * chunks/FTS/mentions, its entity links and its pending inbox
   * items. Entity relations are NOT touched — they may be evidenced by other
   * captures; callers decide what to do with orphaned provenance.
   */
  deleteCapture(captureId: string): { sourceId?: string; inboxCleared: number } {
    const capture = this.getCapture(captureId);
    if (!capture) {
      throw new Error(`Capture not found: ${captureId}`);
    }
    const sourceId = capture.sourceId ?? undefined;
    let revisions: Array<{ id: string }> = sourceId ? [{ id: sourceId }] : [];
    if (sourceId) {
      const current = this.db
        .prepare("SELECT logical_key AS logicalKey, raw_path AS rawPath FROM sources WHERE id = ?")
        .get(sourceId) as { logicalKey: string | null; rawPath: string | null } | undefined;
      revisions = current
        ? this.db
            .prepare("SELECT id FROM sources WHERE logical_key = ? OR (? IS NOT NULL AND raw_path = ?)")
            .all(current.logicalKey ?? sourceId, current.rawPath, current.rawPath) as Array<{ id: string }>
        : [{ id: sourceId }];
    }
    if (revisions.length > 0) {
      const placeholders = revisions.map(() => "?").join(", ");
      const ids = revisions.map((revision) => revision.id);
      const packages = this.db
        .prepare(`SELECT COUNT(*) AS count FROM curation_packages WHERE capture_id = ? OR source_id IN (${placeholders})`)
        .get(captureId, ...ids) as { count: number };
      const evidence = this.db
        .prepare(`SELECT COUNT(*) AS count FROM observation_evidence WHERE capture_id = ? OR source_id IN (${placeholders})`)
        .get(captureId, ...ids) as { count: number };
      if (packages.count > 0 || evidence.count > 0) {
        throw new Error(
          `Capture ${captureId} has curated provenance (${packages.count} package(s), ${evidence.count} evidence item(s)); archive it instead of deleting it.`
        );
      }
    }
    let inboxCleared = 0;
    this.transaction(() => {
      if (sourceId) {
        for (const revision of revisions) {
          this.db.prepare("DELETE FROM source_chunks_fts WHERE source_id = ?").run(revision.id);
          this.db.prepare("DELETE FROM source_chunks WHERE source_id = ?").run(revision.id);
          this.db.prepare("DELETE FROM source_entities WHERE source_id = ?").run(revision.id);
          this.db.prepare("DELETE FROM source_products WHERE source_id = ?").run(revision.id);
          this.db.prepare("DELETE FROM concept_mentions WHERE source_id = ?").run(revision.id);
          this.db.prepare("DELETE FROM graph_relations WHERE source_id = ?").run(revision.id);
          this.db.prepare("DELETE FROM sources WHERE id = ?").run(revision.id);
        }
      }
      this.db.prepare("DELETE FROM capture_entities WHERE capture_id = ?").run(captureId);
      const pending = this.db.prepare("DELETE FROM memory_inbox WHERE status = 'pending' AND payload_json LIKE ?").run(`%${captureId}%`);
      inboxCleared = Number(pending.changes);
      this.db.prepare("DELETE FROM captures WHERE id = ?").run(captureId);
    });
    return { sourceId, inboxCleared };
  }

  repositoryProvenance(sourceIds: string[]): Map<string, import("../../shared/src/types.ts").RepositorySourceProvenance> {
    if (!sourceIds.length) return new Map();
    const rows = this.db.prepare(`
      SELECT p.source_id AS sourceId, p.document_id AS documentId,
             p.repository_id AS repositoryId, p.relative_path AS relativePath,
             p.branch, p.commit_hash AS commitHash, p.content_state AS contentState,
             p.indexed_at AS indexedAt, s.content_hash AS contentHash,
             d.availability, CASE WHEN d.source_id=p.source_id THEN d.last_seen_at ELSE p.indexed_at END AS lastVerifiedAt, i.last_attempt_at AS lastAttemptAt,
             i.last_attempt_status AS lastAttemptStatus, i.last_successful_at AS lastSuccessfulAt
      FROM repository_source_provenance p
      JOIN sources s ON s.id=p.source_id
      JOIN repository_documents d ON d.id=p.document_id
      JOIN repository_index_state i ON i.repository_id=p.repository_id
      WHERE p.source_id IN (SELECT value FROM json_each(?))
    `).all(JSON.stringify(sourceIds)) as Array<Record<string, string | null>>;
    return new Map(rows.map((row) => [String(row.sourceId), {
      documentId: String(row.documentId), repositoryId: String(row.repositoryId),
      relativePath: String(row.relativePath), branch: row.branch ?? undefined,
      commit: row.commitHash ?? undefined, contentHash: String(row.contentHash),
      contentState: row.contentState as import("../../shared/src/types.ts").RepositorySourceProvenance["contentState"],
      indexedAt: String(row.indexedAt), authority: "external-reference" as const,
      availability: row.availability as "available" | "missing",
      lastVerifiedAt: String(row.lastVerifiedAt), lastAttemptAt: String(row.lastAttemptAt), lastAttemptStatus: row.lastAttemptStatus as "complete" | "failed",
      lastSuccessfulAt: row.lastSuccessfulAt ?? undefined
    }]));
  }

  getSource(sourceId: string): Record<string, unknown> | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id,
          logical_key AS logicalKey,
          revision,
          superseded_by AS supersededBy,
          title,
          source_type AS sourceType,
          origin,
          origin_uri AS originUri,
          raw_path AS rawPath,
          status,
          language,
          content_hash AS contentHash,
          captured_at AS capturedAt,
          updated_at AS updatedAt
        FROM sources
        WHERE id = ?
      `)
      .get(sourceId) as Record<string, unknown> | undefined;
    if (row) row.repositoryProvenance = this.repositoryProvenance([sourceId]).get(sourceId);
    return row;
  }

  /** Hydrate an explicit source allowlist with one bounded query. */
  listSourcesByIds(sourceIds: string[]): Array<Record<string, unknown>> {
    if (sourceIds.length === 0) return [];
    const rows = this.db
      .prepare(`
        SELECT
          id,
          logical_key AS logicalKey,
          revision,
          superseded_by AS supersededBy,
          title,
          source_type AS sourceType,
          origin,
          origin_uri AS originUri,
          raw_path AS rawPath,
          status,
          language,
          content_hash AS contentHash,
          captured_at AS capturedAt,
          updated_at AS updatedAt
        FROM sources
        WHERE id IN (SELECT value FROM json_each(?))
        ORDER BY id
      `)
      .all(JSON.stringify([...new Set(sourceIds)])) as Array<Record<string, unknown>>;
    const provenance = this.repositoryProvenance(sourceIds);
    return rows.map((row) => ({ ...row, repositoryProvenance: provenance.get(String(row.id)) }));
  }

  listChunksForSource(sourceId: string): Array<Record<string, unknown>> {
    return this.db
      .prepare(`
        SELECT id, chunk_index AS chunkIndex, content, token_count AS tokenCount
        FROM source_chunks
        WHERE source_id = ?
        ORDER BY chunk_index ASC
      `)
      .all(sourceId) as Array<Record<string, unknown>>;
  }

  /**
   * Return request-matching chunk metadata without loading chunk bodies. The
   * source allowlist is mandatory so a strict Context scope cannot be widened
   * accidentally by the retrieval query.
   */
  searchChunkCandidates(query: string, sourceIds: string[], limit: number): SourceChunkCandidate[] {
    const ftsQuery = toFtsQuery(query, 24);
    const boundedLimit = Math.max(0, Math.min(512, Math.floor(limit)));
    if (!ftsQuery || sourceIds.length === 0 || boundedLimit === 0) return [];

    // A chunk has one FTS row per linked product. Read a bounded oversample and
    // deduplicate below so product fan-out cannot crowd out other chunks.
    const rows = this.db
      .prepare(`
        SELECT
          source_chunks_fts.chunk_id AS chunkId,
          source_chunks_fts.source_id AS sourceId,
          sc.chunk_index AS chunkIndex,
          sc.token_count AS tokenCount,
          LENGTH(sc.content) AS characterCount,
          bm25(source_chunks_fts) AS lexicalScore
        FROM source_chunks_fts
        JOIN source_chunks sc ON sc.id = source_chunks_fts.chunk_id
        WHERE source_chunks_fts MATCH ?
          AND source_chunks_fts.source_id IN (SELECT value FROM json_each(?))
        ORDER BY lexicalScore ASC, source_chunks_fts.source_id ASC, sc.chunk_index ASC, source_chunks_fts.chunk_id ASC
        LIMIT ?
      `)
      .all(ftsQuery, JSON.stringify(uniqueStrings(sourceIds)), Math.min(2_048, boundedLimit * 4)) as unknown as SourceChunkCandidate[];

    const unique = new Map<string, SourceChunkCandidate>();
    for (const row of rows) {
      if (!unique.has(row.chunkId)) unique.set(row.chunkId, row);
      if (unique.size >= boundedLimit) break;
    }
    return [...unique.values()];
  }

  /**
   * Deterministic, bounded metadata fallback for sources with no lexical hit.
   * It deliberately returns no content and never scans more than `limit` rows
   * out of SQLite.
   */
  listChunkCandidatesForSources(
    sourceIds: string[],
    options: { perSourceLimit?: number; limit?: number } = {}
  ): SourceChunkCandidate[] {
    const perSourceLimit = Math.max(1, Math.min(8, Math.floor(options.perSourceLimit ?? 1)));
    const limit = Math.max(0, Math.min(512, Math.floor(options.limit ?? sourceIds.length * perSourceLimit)));
    if (sourceIds.length === 0 || limit === 0) return [];
    const rows = this.db
      .prepare(`
        WITH requested(source_id) AS (
          SELECT value FROM json_each(?)
        ), ranked AS (
          SELECT
            sc.id AS chunkId,
            sc.source_id AS sourceId,
            sc.chunk_index AS chunkIndex,
            sc.token_count AS tokenCount,
            LENGTH(sc.content) AS characterCount,
            ROW_NUMBER() OVER (
              PARTITION BY sc.source_id
              ORDER BY sc.chunk_index ASC, sc.id ASC
            ) AS sourceRank
          FROM source_chunks sc
          JOIN requested r ON r.source_id = sc.source_id
        )
        SELECT chunkId, sourceId, chunkIndex, tokenCount, characterCount
        FROM ranked
        WHERE sourceRank <= ?
        ORDER BY sourceId ASC, chunkIndex ASC, chunkId ASC
        LIMIT ?
      `)
      .all(JSON.stringify(uniqueStrings(sourceIds)), perSourceLimit, limit) as unknown as SourceChunkCandidate[];
    return rows;
  }

  /** Hydrate only an already ranked and budgeted set of chunks, in input order. */
  getChunksByIds(chunkIds: string[]): SourceChunk[] {
    const ids = uniqueStrings(chunkIds);
    if (ids.length === 0) return [];
    return this.db
      .prepare(`
        WITH requested(id, ordinal) AS (
          SELECT value, CAST(key AS INTEGER) FROM json_each(?)
        )
        SELECT
          sc.id,
          sc.source_id AS sourceId,
          sc.chunk_index AS chunkIndex,
          sc.content,
          sc.token_count AS tokenCount,
          sc.content_hash AS contentHash
        FROM requested r
        JOIN source_chunks sc ON sc.id = r.id
        ORDER BY r.ordinal ASC
      `)
      .all(JSON.stringify(ids)) as unknown as SourceChunk[];
  }

  getChunk(chunkId: string): Record<string, unknown> | undefined {
    return this.db
      .prepare(`
        SELECT
          sc.id,
          sc.source_id AS sourceId,
          sc.chunk_index AS chunkIndex,
          sc.content,
          sc.token_count AS tokenCount,
          s.title AS sourceTitle,
          s.source_type AS sourceType
        FROM source_chunks sc
        JOIN sources s ON s.id = sc.source_id
        WHERE sc.id = ?
      `)
      .get(chunkId) as Record<string, unknown> | undefined;
  }

  listSourceIdsForEntities(entityRefs: EntityRef[], statuses: string[] = ["indexed"]): string[] {
    const requestedStatuses = uniqueStrings(statuses);
    const requestedEntities = uniqueEntityRefs(entityRefs);
    if (requestedEntities.length === 0 || requestedStatuses.length === 0) {
      return [];
    }
    const statusPlaceholders = requestedStatuses.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`
        SELECT DISTINCT se.source_id AS sourceId
        FROM source_entities se
        JOIN sources s ON s.id = se.source_id
        JOIN json_each(?) requested
          ON se.entity_kind = json_extract(requested.value, '$.kind')
         AND se.entity_id = json_extract(requested.value, '$.id')
        WHERE s.status IN (${statusPlaceholders})
      `)
      .all(JSON.stringify(requestedEntities), ...requestedStatuses) as Array<{ sourceId: string }>;
    return rows.map((row) => row.sourceId);
  }

  listEntityRefsForSource(sourceId: string): EntityRef[] {
    const rows = this.db
      .prepare(`
        SELECT entity_kind AS kind, entity_id AS id
        FROM source_entities
        WHERE source_id = ?
        ORDER BY entity_kind, entity_id
      `)
      .all(sourceId) as unknown as EntityRef[];
    return uniqueEntityRefs(rows);
  }

  /** @deprecated Read-only bridge for legacy product-filtered surfaces. */
  listSourceIdsForProducts(productIds: string[], statuses: string[] = ["indexed"]): string[] {
    return this.listSourceIdsForEntities(productIds.map((id) => ({ kind: "product", id })), statuses);
  }

  /** @deprecated Read-only bridge for legacy exports and reports. */
  listProductIdsForSource(sourceId: string): string[] {
    return this.listEntityRefsForSource(sourceId)
      .filter((entity) => entity.kind === "product")
      .map((entity) => entity.id);
  }

  deleteStructuredMemoryForSource(sourceId: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM graph_relations WHERE source_id = ?").run(sourceId);
      this.db.prepare("DELETE FROM concept_mentions WHERE source_id = ?").run(sourceId);
    });
  }

  upsertConcept(input: Omit<ConceptRecord, "id" | "status"> & { id?: string; status?: string }): string {
    const id = input.id ?? createStableId("concept", [input.conceptType, input.canonicalName.toLowerCase()]);
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO concepts (id, canonical_name, concept_type, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_name, concept_type) DO UPDATE SET
          description = COALESCE(excluded.description, concepts.description),
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        input.canonicalName,
        input.conceptType,
        input.description ?? null,
        input.status ?? "candidate",
        now,
        now
      );

    const row = this.db
      .prepare("SELECT id FROM concepts WHERE canonical_name = ? AND concept_type = ?")
      .get(input.canonicalName, input.conceptType) as { id: string };
    return row.id;
  }

  insertConceptMention(input: ConceptMentionRecord): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO concept_mentions
          (id, concept_id, source_id, chunk_id, quote, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.conceptId,
        input.sourceId,
        input.chunkId ?? null,
        input.quote ?? null,
        input.confidence,
        nowIso()
      );
  }

  insertGraphRelation(input: Omit<GraphRelationRecord, "id" | "status"> & { id?: string; status?: string }): string {
    const id = input.id ?? createStableId("rel", [
      input.sourceId ?? "",
      input.subject.toLowerCase(),
      input.predicate,
      input.object.toLowerCase()
    ]);
    const now = nowIso();
    this.db
      .prepare(`
        INSERT OR IGNORE INTO graph_relations
          (id, subject, predicate, object, source_id, confidence, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.subject,
        input.predicate,
        input.object,
        input.sourceId ?? null,
        input.confidence,
        input.status ?? "candidate",
        now,
        now
      );
    return id;
  }

  listConcepts(productIds: string[] = [], limit = 50): ConceptRecord[] {
    const productFilter = productIds.length > 0
      ? `AND EXISTS (
          SELECT 1 FROM source_entities se
          WHERE se.source_id = cm.source_id
            AND se.entity_kind = 'product'
            AND se.entity_id IN (${productIds.map(() => "?").join(", ")})
        )`
      : "";
    const rows = this.db
      .prepare(`
        SELECT
          c.id,
          c.canonical_name AS canonicalName,
          c.concept_type AS conceptType,
          c.description,
          c.status,
          COUNT(DISTINCT cm.id) AS mentionCount
        FROM concepts c
        LEFT JOIN concept_mentions cm ON cm.concept_id = c.id
        WHERE (cm.source_id IS NULL OR EXISTS (SELECT 1 FROM sources s WHERE s.id = cm.source_id AND s.status = 'indexed'))
        ${productFilter}
        GROUP BY c.id
        ORDER BY mentionCount DESC, c.updated_at DESC
        LIMIT ?
      `)
      .all(...productIds, limit) as unknown as ConceptRecord[];

    return rows;
  }

  listGraphRelations(productIds: string[] = [], limit = 50): GraphRelationRecord[] {
    const productFilter = productIds.length > 0
      ? `AND EXISTS (
          SELECT 1 FROM source_entities se
          WHERE se.source_id = gr.source_id
            AND se.entity_kind = 'product'
            AND se.entity_id IN (${productIds.map(() => "?").join(", ")})
        )`
      : "";
    const rows = this.db
      .prepare(`
        SELECT DISTINCT
          gr.id,
          gr.subject,
          gr.predicate,
          gr.object,
          gr.source_id AS sourceId,
          gr.confidence,
          gr.status
        FROM graph_relations gr
        WHERE (gr.source_id IS NULL OR EXISTS (SELECT 1 FROM sources s WHERE s.id = gr.source_id AND s.status = 'indexed'))
        ${productFilter}
        ORDER BY gr.updated_at DESC
        LIMIT ?
      `)
      .all(...productIds, limit) as unknown as GraphRelationRecord[];

    return rows;
  }

  countPendingInboxByType(productIds: string[] = []): CountByKey[] {
    const productFilter = productIds.length > 0 ? `AND product_id IN (${productIds.map(() => "?").join(", ")})` : "";
    return this.db
      .prepare(`
        SELECT type AS key, COUNT(*) AS count
        FROM memory_inbox
        WHERE status = 'pending'
        ${productFilter}
        GROUP BY type
      `)
      .all(...productIds) as unknown as CountByKey[];
  }

  countCandidateConceptsByType(productIds: string[] = []): CountByKey[] {
    const productFilter = productIds.length > 0
      ? `AND EXISTS (
          SELECT 1 FROM source_entities se
          WHERE se.source_id = cm.source_id
            AND se.entity_kind = 'product'
            AND se.entity_id IN (${productIds.map(() => "?").join(", ")})
        )`
      : "";
    return this.db
      .prepare(`
        SELECT c.concept_type AS key, COUNT(DISTINCT c.id) AS count
        FROM concepts c
        JOIN concept_mentions cm ON cm.concept_id = c.id
        WHERE c.status = 'candidate'
        ${productFilter}
        GROUP BY c.concept_type
      `)
      .all(...productIds) as unknown as CountByKey[];
  }

  countUnreviewedSources(productIds: string[] = []): number {
    const productFilter = productIds.length > 0
      ? `AND EXISTS (
          SELECT 1 FROM source_entities se
          WHERE se.source_id = s.id
            AND se.entity_kind = 'product'
            AND se.entity_id IN (${productIds.map(() => "?").join(", ")})
        )`
      : "";
    const row = this.db
      .prepare(`
        SELECT COUNT(DISTINCT c.id) AS count
        FROM captures c
        JOIN sources s ON s.id = c.source_id
        WHERE s.status = 'indexed'
          AND c.status = 'captured'
          AND c.ingestion_status = 'indexed'
          AND s.source_type NOT IN ('wiki_page', 'bmad_artifact')
        ${productFilter}
      `)
      .get(...productIds) as { count: number };
    return row.count;
  }

  insertInboxItem(input: Omit<InboxItem, "id" | "createdAt" | "updatedAt"> & { id?: string }): string {
    const id = input.id ?? createId("inbox");
    const now = nowIso();
    this.transaction(() => {
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO memory_inbox
          (id, type, title, body, status, source_id, product_id, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.type,
        input.title,
        input.body,
        input.status,
        input.sourceId ?? null,
        input.productId ?? null,
        JSON.stringify(input.payload),
        now,
        now
      );
      if (result.changes > 0) this.replaceInboxContextReferences(id, input.payload);
    });
    return id;
  }

  search(
    query: string,
    productIds: string[],
    limit: number,
    sourceIds?: string[],
    statuses: string[] = ["indexed"]
  ): SearchResult[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }
    if (sourceIds && sourceIds.length === 0) {
      return [];
    }
    const requestedStatuses = uniqueStrings(statuses);
    if (requestedStatuses.length === 0) return [];

    // A resolved source allowlist is the canonical generic-entity boundary.
    // Legacy product filters are translated through source_entities only when
    // no generic allowlist was supplied.
    const applyProductFilter = productIds.length > 0 && !sourceIds;
    const productFilter = applyProductFilter
      ? `AND EXISTS (
          SELECT 1 FROM source_entities scoped
          WHERE scoped.source_id = source_chunks_fts.source_id
            AND scoped.entity_kind = 'product'
            AND scoped.entity_id IN (${productIds.map(() => "?").join(", ")})
        )`
      : "";
    const sourceFilter = sourceIds && sourceIds.length > 0 ? `AND source_chunks_fts.source_id IN (${sourceIds.map(() => "?").join(", ")})` : "";
    const statusFilter = `AND s.status IN (${requestedStatuses.map(() => "?").join(", ")})`;
    const rows = this.db
      .prepare(`
        SELECT
          source_chunks_fts.chunk_id AS chunkId,
          source_chunks_fts.source_id AS sourceId,
          (
            SELECT linked.entity_kind
            FROM source_entities linked
            WHERE linked.source_id = source_chunks_fts.source_id
            ORDER BY linked.entity_kind, linked.entity_id
            LIMIT 1
          ) AS entityKind,
          (
            SELECT linked.entity_id
            FROM source_entities linked
            WHERE linked.source_id = source_chunks_fts.source_id
            ORDER BY linked.entity_kind, linked.entity_id
            LIMIT 1
          ) AS entityId,
          source_chunks_fts.title AS title,
          snippet(source_chunks_fts, 4, '[', ']', '...', 24) AS snippet,
          bm25(source_chunks_fts) AS score,
          s.updated_at AS updatedAt,
          s.status AS status
        FROM source_chunks_fts
        JOIN sources s ON s.id = source_chunks_fts.source_id
        WHERE source_chunks_fts MATCH ?
        ${statusFilter}
        ${productFilter}
        ${sourceFilter}
        ORDER BY score
        LIMIT ?
      `)
      .all(
        ftsQuery,
        ...requestedStatuses,
        ...(applyProductFilter ? productIds : []),
        ...(sourceIds ?? []),
        limit
      ) as unknown as Array<SearchResult & { entityKind?: string; entityId?: string }>;

    const provenance = this.repositoryProvenance(rows.map((row) => row.sourceId));
    return rows.map(({ entityKind, entityId, ...row }) => ({
      ...row,
      ...(entityKind && entityId ? { entity: { kind: entityKind, id: entityId } } : {}),
      repositoryProvenance: provenance.get(row.sourceId)
    }));
  }

  getInboxItem(id: string): InboxItem | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id,
          type,
          title,
          body,
          status,
          source_id AS sourceId,
          product_id AS productId,
          payload_json AS payloadJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM memory_inbox
        WHERE id = ?
      `)
      .get(id) as (InboxItem & { payloadJson: string }) | undefined;

    return row ? rowToInboxItem(row) : undefined;
  }

  /** Hydrate an explicit Inbox allowlist with one bounded query. */
  listInboxItemsByIds(ids: string[]): InboxItem[] {
    if (ids.length === 0) return [];
    return this.listInboxFiltered({ ids: [...new Set(ids)] });
  }

  updateInboxStatus(id: string, status: InboxStatus): void {
    const result = this.db
      .prepare(`
        UPDATE memory_inbox
        SET status = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, nowIso(), id);

    if (result.changes === 0) {
      throw new Error(`Inbox item not found: ${id}`);
    }
  }

  updateInboxPayload(id: string, payload: Record<string, unknown>): void {
    this.transaction(() => {
      const result = this.db
        .prepare(`
          UPDATE memory_inbox
          SET payload_json = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(JSON.stringify(payload), nowIso(), id);

      if (result.changes === 0) {
        throw new Error(`Inbox item not found: ${id}`);
      }
      this.replaceInboxContextReferences(id, payload);
    });
  }

  createCurationPackage(
    input: Omit<CurationPackageRecord, "id" | "createdAt" | "updatedAt" | "reviewedAt"> & { id?: string; reviewedAt?: string }
  ): CurationPackageRecord {
    const id = input.id ?? createId("curation-package");
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO curation_packages (
        id, capture_id, source_id, product_id, title, summary, status,
        wiki_decision, wiki_reason, wiki_evidence_json, wiki_target_json,
        wiki_synthesis_key, reviewed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO NOTHING
    `).run(
      id,
      input.captureId ?? null,
      input.sourceId,
      input.productId ?? null,
      input.title,
      input.summary ?? null,
      input.status,
      input.wikiDecision,
      input.wikiReason ?? null,
      JSON.stringify(input.wikiEvidenceObservationIds ?? []),
      input.wikiTarget ? JSON.stringify(input.wikiTarget) : null,
      input.wikiSynthesisKey ?? null,
      input.reviewedAt ?? null,
      now,
      now
    );
    return this.getCurationPackage(id) ?? this.listCurationPackages({ sourceId: input.sourceId })[0]!;
  }

  getCurationPackage(id: string): CurationPackageRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, capture_id AS captureId, source_id AS sourceId, product_id AS productId,
             title, summary, status, wiki_decision AS wikiDecision, wiki_reason AS wikiReason,
             wiki_evidence_json AS wikiEvidenceJson, wiki_target_json AS wikiTargetJson,
             wiki_synthesis_key AS wikiSynthesisKey, reviewed_at AS reviewedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM curation_packages WHERE id = ?
    `).get(id) as CurationPackageRow | undefined;
    return row ? normalizeCurationPackage(row) : undefined;
  }

  listCurationPackages(filter: {
    ids?: string[];
    status?: CurationPackageStatus;
    captureId?: string;
    sourceId?: string;
    productIds?: string[];
    entityRefs?: EntityRef[];
    limit?: number;
  } = {}): CurationPackageRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.ids) {
      if (filter.ids.length === 0) return [];
      clauses.push("id IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify([...new Set(filter.ids)]));
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.captureId) {
      clauses.push("capture_id = ?");
      params.push(filter.captureId);
    }
    if (filter.sourceId) {
      clauses.push("source_id = ?");
      params.push(filter.sourceId);
    }
    if (filter.productIds?.length) {
      clauses.push(`(product_id IN (${filter.productIds.map(() => "?").join(", ")}) OR product_id IS NULL)`);
      params.push(...filter.productIds);
    }
    if (filter.entityRefs) {
      if (filter.entityRefs.length === 0) return [];
      const entityRefs = uniqueEntityRefStrings(filter.entityRefs);
      clauses.push(`(
        EXISTS (
          SELECT 1
          FROM source_entities scoped_source
          WHERE scoped_source.source_id = curation_packages.source_id
            AND scoped_source.entity_kind || ':' || scoped_source.entity_id
                IN (SELECT value FROM json_each(?))
        )
        OR EXISTS (
          SELECT 1
          FROM observations scoped_observation
          WHERE scoped_observation.package_id = curation_packages.id
            AND scoped_observation.subject_kind || ':' || scoped_observation.subject_id
                IN (SELECT value FROM json_each(?))
        )
      )`);
      const encoded = JSON.stringify(entityRefs);
      params.push(encoded, encoded);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Number.isFinite(Number(filter.limit)) ? Math.max(1, Math.floor(Number(filter.limit))) : undefined;
    const rows = this.db.prepare(`
      SELECT id, capture_id AS captureId, source_id AS sourceId, product_id AS productId,
             title, summary, status, wiki_decision AS wikiDecision, wiki_reason AS wikiReason,
             wiki_evidence_json AS wikiEvidenceJson, wiki_target_json AS wikiTargetJson,
             wiki_synthesis_key AS wikiSynthesisKey, reviewed_at AS reviewedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM curation_packages ${where}
      ORDER BY created_at DESC
      ${limit ? "LIMIT ?" : ""}
    `).all(...params, ...(limit ? [String(limit)] : [])) as unknown as CurationPackageRow[];
    return rows.map(normalizeCurationPackage);
  }

  /** Index-backed union of packages anchored to any resolved context plane. */
  listCurationPackageContextCandidates(filter: {
    productIds?: string[];
    sourceIds?: string[];
    captureIds?: string[];
  }): CurationPackageRecord[] {
    const candidates: string[] = [];
    const params: string[] = [];
    const add = (column: "product_id" | "source_id" | "capture_id", values: string[] | undefined): void => {
      if (!values?.length) return;
      candidates.push(`SELECT id FROM curation_packages WHERE ${column} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify([...new Set(values)]));
    };
    add("product_id", filter.productIds);
    add("source_id", filter.sourceIds);
    add("capture_id", filter.captureIds);
    if (candidates.length === 0) return [];

    const rows = this.db.prepare(`
      WITH candidate_ids(id) AS (
        ${candidates.join(" UNION ")}
      )
      SELECT curation_packages.id, capture_id AS captureId, source_id AS sourceId, product_id AS productId,
             title, summary, status, wiki_decision AS wikiDecision, wiki_reason AS wikiReason,
             wiki_evidence_json AS wikiEvidenceJson, wiki_target_json AS wikiTargetJson,
             wiki_synthesis_key AS wikiSynthesisKey, reviewed_at AS reviewedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM candidate_ids
      JOIN curation_packages ON curation_packages.id = candidate_ids.id
      ORDER BY created_at DESC
    `).all(...params) as unknown as CurationPackageRow[];
    return rows.map(normalizeCurationPackage);
  }

  /**
   * Packages whose state can change after source-revision activation. This
   * keeps stale-revision maintenance proportional to affected/suggested
   * packages instead of rescanning every package and hydrating its source.
   */
  listCurationPackagesForStaleRefresh(): CurationPackageRecord[] {
    const rows = this.db.prepare(`
      WITH refresh_candidates(id) AS (
        SELECT curation_packages.id
        FROM curation_packages
        JOIN sources ON sources.id = curation_packages.source_id
        WHERE sources.status = 'superseded'
        UNION
        SELECT id FROM curation_packages WHERE wiki_decision = 'suggested'
      )
      SELECT curation_packages.id, capture_id AS captureId, source_id AS sourceId, product_id AS productId,
             title, summary, status, wiki_decision AS wikiDecision, wiki_reason AS wikiReason,
             wiki_evidence_json AS wikiEvidenceJson, wiki_target_json AS wikiTargetJson,
             wiki_synthesis_key AS wikiSynthesisKey, reviewed_at AS reviewedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM refresh_candidates
      JOIN curation_packages ON curation_packages.id = refresh_candidates.id
      ORDER BY created_at DESC
    `).all() as unknown as CurationPackageRow[];
    return rows.map(normalizeCurationPackage);
  }

  updateCurationPackage(
    id: string,
    update: Partial<Pick<CurationPackageRecord, "title" | "status" | "wikiDecision" | "wikiEvidenceObservationIds">> & {
      summary?: string | null;
      wikiReason?: CurationPackageRecord["wikiReason"] | null;
      wikiTarget?: CurationPackageRecord["wikiTarget"] | null;
      wikiSynthesisKey?: string | null;
      reviewedAt?: string | null;
    }
  ): CurationPackageRecord {
    const current = this.getCurationPackage(id);
    if (!current) throw new Error(`Curation package not found: ${id}`);
    this.db.prepare(`
      UPDATE curation_packages
      SET title = ?, summary = ?, status = ?, wiki_decision = ?, wiki_reason = ?,
          wiki_evidence_json = ?, wiki_target_json = ?, wiki_synthesis_key = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      update.title ?? current.title,
      update.summary === undefined ? current.summary ?? null : update.summary,
      update.status ?? current.status,
      update.wikiDecision ?? current.wikiDecision,
      update.wikiReason === undefined ? current.wikiReason ?? null : update.wikiReason,
      JSON.stringify(update.wikiEvidenceObservationIds ?? current.wikiEvidenceObservationIds),
      update.wikiTarget === undefined
        ? (current.wikiTarget ? JSON.stringify(current.wikiTarget) : null)
        : (update.wikiTarget ? JSON.stringify(update.wikiTarget) : null),
      update.wikiSynthesisKey === undefined ? current.wikiSynthesisKey ?? null : update.wikiSynthesisKey,
      update.reviewedAt === undefined ? current.reviewedAt ?? null : update.reviewedAt,
      nowIso(),
      id
    );
    return this.getCurationPackage(id)!;
  }

  insertObservation(
    input: Omit<ObservationRecord, "id" | "createdAt" | "updatedAt" | "reviewedAt"> & { id?: string; reviewedAt?: string }
  ): ObservationRecord {
    const id = input.id ?? createId("observation");
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO observations (
        id, package_id, kind, title, body, excerpt, source_id, source_chunk_id,
        capture_id, product_id, subject_kind, subject_id, validation_status, evidence_status,
        measurement_json, proposal_key, confidence,
        fingerprint, polarity, review_note, reviewed_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_id, proposal_key) WHERE proposal_key IS NOT NULL DO NOTHING
    `).run(
      id,
      input.packageId,
      input.kind,
      input.title,
      input.body,
      input.excerpt,
      input.sourceId,
      input.sourceChunkId ?? null,
      input.captureId ?? null,
      input.productId ?? null,
      input.subjectKind ?? null,
      input.subjectId ?? null,
      input.validationStatus,
      input.evidenceStatus,
      input.measurement ? JSON.stringify(input.measurement) : null,
      input.proposalKey ?? null,
      input.confidence,
      input.fingerprint,
      input.polarity,
      input.reviewNote ?? null,
      input.reviewedAt ?? null,
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    );
    return this.getObservation(id) ?? this.getObservationByProposalKey(input.packageId, input.proposalKey)!;
  }

  getObservationByProposalKey(packageId: string, proposalKey?: string): ObservationRecord | undefined {
    if (!proposalKey) return undefined;
    const row = this.db
      .prepare(`${OBSERVATION_SELECT} WHERE package_id = ? AND proposal_key = ?`)
      .get(packageId, proposalKey) as ObservationRow | undefined;
    return row ? rowToObservation(row) : undefined;
  }

  getObservation(id: string): ObservationRecord | undefined {
    const row = this.db.prepare(`${OBSERVATION_SELECT} WHERE id = ?`).get(id) as ObservationRow | undefined;
    return row ? rowToObservation(row) : undefined;
  }

  /** Hydrate an explicit observation allowlist with one bounded query. */
  listObservationsByIds(observationIds: string[]): ObservationRecord[] {
    if (observationIds.length === 0) return [];
    const rows = this.db.prepare(`
      ${OBSERVATION_SELECT}
      WHERE id IN (SELECT value FROM json_each(?))
      ORDER BY created_at DESC
    `).all(JSON.stringify([...new Set(observationIds)])) as unknown as ObservationRow[];
    return rows.map(rowToObservation);
  }

  /**
   * Return only observations whose primary or secondary evidence cites a
   * superseded source revision. Both branches use source/evidence indexes and
   * are deduplicated before observation bodies are hydrated.
   */
  listObservationsWithSupersededSources(): ObservationRecord[] {
    const rows = this.db.prepare(`
      WITH stale_observation_ids(id) AS (
        SELECT observations.id
        FROM observations
        JOIN sources ON sources.id = observations.source_id
        WHERE sources.status IN ('superseded', 'missing')
        UNION
        SELECT observation_evidence.observation_id
        FROM observation_evidence
        JOIN sources ON sources.id = observation_evidence.source_id
        WHERE sources.status IN ('superseded', 'missing')
      )
      ${OBSERVATION_SELECT}
      WHERE id IN (SELECT id FROM stale_observation_ids)
      ORDER BY created_at DESC
    `).all() as unknown as ObservationRow[];
    return rows.map(rowToObservation);
  }

  /** Hydrate observations for an explicit curation-package set. */
  listObservationsForPackages(packageIds: string[]): ObservationRecord[] {
    if (packageIds.length === 0) return [];
    const rows = this.db.prepare(`
      ${OBSERVATION_SELECT}
      WHERE package_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at DESC
    `).all(JSON.stringify([...new Set(packageIds)])) as unknown as ObservationRow[];
    return rows.map(rowToObservation);
  }

  listObservations(filter: {
    packageId?: string;
    sourceId?: string;
    captureId?: string;
    subjectKind?: string;
    subjectId?: string;
    validationStatuses?: ObservationRecord["validationStatus"][];
    evidenceStatuses?: ObservationRecord["evidenceStatus"][];
  } = {}): ObservationRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.packageId) { clauses.push("package_id = ?"); params.push(filter.packageId); }
    if (filter.sourceId) { clauses.push("source_id = ?"); params.push(filter.sourceId); }
    if (filter.captureId) { clauses.push("capture_id = ?"); params.push(filter.captureId); }
    if (filter.subjectKind) { clauses.push("subject_kind = ?"); params.push(filter.subjectKind); }
    if (filter.subjectId) { clauses.push("subject_id = ?"); params.push(filter.subjectId); }
    if (filter.validationStatuses?.length) {
      clauses.push(`validation_status IN (${filter.validationStatuses.map(() => "?").join(", ")})`);
      params.push(...filter.validationStatuses);
    }
    if (filter.evidenceStatuses?.length) {
      clauses.push(`evidence_status IN (${filter.evidenceStatuses.map(() => "?").join(", ")})`);
      params.push(...filter.evidenceStatuses);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`${OBSERVATION_SELECT}${where} ORDER BY created_at DESC`).all(...params) as unknown as ObservationRow[];
    return rows.map(rowToObservation);
  }

  /**
   * Search reviewed or pending interpretations without falling back to a full
   * observation scan. Callers can pass the concrete observation ids resolved
   * by an active Context Scope; an explicit empty allowlist is fail-closed.
   */
  searchObservations(query: string, filter: ObservationSearchFilter = {}): ObservationSearchResult[] {
    const ftsQuery = toFtsQuery(query);
    const limit = Math.min(500, Math.max(0, Math.trunc(filter.limit ?? 10)));
    const observationIds = filter.observationIds === undefined
      ? undefined
      : uniqueStrings(filter.observationIds);
    const sourceIds = filter.sourceIds === undefined ? undefined : uniqueStrings(filter.sourceIds);
    const productIds = filter.productIds === undefined ? undefined : uniqueStrings(filter.productIds);
    if (!ftsQuery || limit === 0 || observationIds?.length === 0 || sourceIds?.length === 0 || productIds?.length === 0) {
      return [];
    }

    const clauses = ["observations_fts MATCH ?"];
    const params: Array<string | number> = [ftsQuery];
    const addJsonAllowlist = (column: string, values: string[] | undefined): void => {
      if (values === undefined) return;
      clauses.push(`${column} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(values));
    };
    addJsonAllowlist("observation.id", observationIds);
    addJsonAllowlist("observation.source_id", sourceIds);
    addJsonAllowlist("observation.product_id", productIds);
    addJsonAllowlist("observation.validation_status", filter.validationStatuses);
    addJsonAllowlist("observation.evidence_status", filter.evidenceStatuses);
    params.push(limit);

    const hits = this.db.prepare(`
      SELECT observation.id,
             snippet(observations_fts, -1, '[', ']', '...', 24) AS snippet,
             bm25(observations_fts, 4.0, 1.5, 2.0, 0.5, 0.25, 0.25) AS score
      FROM observations_fts
      JOIN observations AS observation ON observation.rowid = observations_fts.rowid
      WHERE ${clauses.join(" AND ")}
      ORDER BY score ASC, observation.updated_at DESC, observation.id ASC
      LIMIT ?
    `).all(...params) as unknown as Array<{ id: string; snippet: string; score: number }>;
    if (hits.length === 0) return [];

    const observations = new Map(this.listObservationsByIds(hits.map((hit) => hit.id)).map((item) => [item.id, item]));
    return hits.flatMap((hit) => {
      const observation = observations.get(hit.id);
      return observation ? [{ observation, snippet: hit.snippet, score: hit.score }] : [];
    });
  }

  /**
   * Return only observations that have at least one primary dimension anchored
   * in a resolved context. The candidate ids are built from indexed columns
   * before the observation rows are hydrated, avoiding a full observation scan
   * for every scoped retrieval.
   *
   * Strict callers must still validate every populated dimension (and all
   * secondary evidence) after this candidate query. This method deliberately
   * implements the inclusive "any anchor" half shared by guided and strict
   * resolution.
   */
  listObservationContextCandidates(filter: {
    sourceIds?: string[];
    captureIds?: string[];
    productIds?: string[];
    entityRefs?: Array<{ kind: string; id: string }>;
    validationStatuses?: string[];
    evidenceStatuses?: string[];
  }): ObservationRecord[] {
    const candidateQueries: string[] = [];
    const params: string[] = [];
    const sourceIds = [...new Set(filter.sourceIds ?? [])];
    const captureIds = [...new Set(filter.captureIds ?? [])];
    const productIds = [...new Set(filter.productIds ?? [])];
    const entityRefs = [...new Map(
      (filter.entityRefs ?? []).map((ref) => [`${ref.kind}\u0000${ref.id}`, { kind: ref.kind, id: ref.id }])
    ).values()];

    if (sourceIds.length > 0) {
      candidateQueries.push(`
        SELECT observation.id
        FROM json_each(?) AS selected
        JOIN observations AS observation ON observation.source_id = selected.value
      `);
      params.push(JSON.stringify(sourceIds));
    }
    if (captureIds.length > 0) {
      candidateQueries.push(`
        SELECT observation.id
        FROM json_each(?) AS selected
        JOIN observations AS observation ON observation.capture_id = selected.value
      `);
      params.push(JSON.stringify(captureIds));
    }
    if (productIds.length > 0) {
      candidateQueries.push(`
        SELECT observation.id
        FROM json_each(?) AS selected
        JOIN observations AS observation ON observation.product_id = selected.value
      `);
      params.push(JSON.stringify(productIds));
    }
    if (entityRefs.length > 0) {
      candidateQueries.push(`
        SELECT observation.id
        FROM json_each(?) AS selected
        JOIN observations AS observation
          ON observation.subject_kind = json_extract(selected.value, '$.kind')
         AND observation.subject_id = json_extract(selected.value, '$.id')
      `);
      params.push(JSON.stringify(entityRefs));
    }
    if (candidateQueries.length === 0) return [];

    const clauses = ["id IN (SELECT id FROM context_candidate_observations)"];
    if (filter.validationStatuses?.length) {
      clauses.push("validation_status IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify([...new Set(filter.validationStatuses)]));
    }
    if (filter.evidenceStatuses?.length) {
      clauses.push("evidence_status IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify([...new Set(filter.evidenceStatuses)]));
    }

    const rows = this.db.prepare(`
      WITH context_candidate_observations(id) AS (
        ${candidateQueries.join("\nUNION\n")}
      )
      ${OBSERVATION_SELECT}
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
    `).all(...params) as unknown as ObservationRow[];
    return rows.map(rowToObservation);
  }

  updateObservation(
    id: string,
    update: Partial<Omit<ObservationRecord, "id" | "packageId" | "sourceId" | "sourceChunkId" | "captureId" | "excerpt" | "createdAt" | "updatedAt">>
  ): ObservationRecord {
    const current = this.getObservation(id);
    if (!current) throw new Error(`Observation not found: ${id}`);
    const next = { ...current, ...update, metadata: update.metadata ?? current.metadata };
    this.db.prepare(`
      UPDATE observations SET
        kind = ?, title = ?, body = ?, product_id = ?, subject_kind = ?, subject_id = ?,
        validation_status = ?, evidence_status = ?, measurement_json = ?, proposal_key = ?, confidence = ?,
        fingerprint = ?, polarity = ?, review_note = ?, reviewed_at = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.kind,
      next.title,
      next.body,
      next.productId ?? null,
      next.subjectKind ?? null,
      next.subjectId ?? null,
      next.validationStatus,
      next.evidenceStatus,
      next.measurement ? JSON.stringify(next.measurement) : null,
      next.proposalKey ?? null,
      next.confidence,
      next.fingerprint,
      next.polarity,
      next.reviewNote ?? null,
      next.reviewedAt ?? null,
      JSON.stringify(next.metadata ?? {}),
      nowIso(),
      id
    );
    return this.getObservation(id)!;
  }

  insertObservationEvidence(
    input: Omit<ObservationEvidenceRecord, "id" | "createdAt"> & { id?: string }
  ): ObservationEvidenceRecord {
    const id = input.id ?? createStableId("observation-evidence", [
      input.observationId,
      input.sourceId,
      input.sourceChunkId ?? "",
      input.excerpt,
      input.stance
    ]);
    const now = nowIso();
    this.db.prepare(`
      INSERT OR IGNORE INTO observation_evidence (
        id, observation_id, source_id, source_chunk_id, capture_id, excerpt, stance, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.observationId, input.sourceId, input.sourceChunkId ?? null, input.captureId ?? null, input.excerpt, input.stance, input.confidence, now);
    const row = this.db.prepare(`
      SELECT id, observation_id AS observationId, source_id AS sourceId,
             source_chunk_id AS sourceChunkId, capture_id AS captureId,
             excerpt, stance, confidence, created_at AS createdAt
      FROM observation_evidence
      WHERE observation_id = ? AND source_id = ?
        AND COALESCE(source_chunk_id, '') = COALESCE(?, '')
        AND excerpt = ? AND stance = ?
    `).get(input.observationId, input.sourceId, input.sourceChunkId ?? null, input.excerpt, input.stance) as unknown as ObservationEvidenceRecord;
    return normalizeObservationEvidence(row);
  }

  listObservationEvidence(observationId: string): ObservationEvidenceRecord[] {
    return this.listObservationEvidenceForObservations([observationId]);
  }

  /** Batch evidence hydration used by strict context resolution. */
  listObservationEvidenceForObservations(observationIds: string[]): ObservationEvidenceRecord[] {
    if (observationIds.length === 0) return [];
    const rows = this.db.prepare(`
      SELECT id, observation_id AS observationId, source_id AS sourceId,
             source_chunk_id AS sourceChunkId, capture_id AS captureId,
             excerpt, stance, confidence, created_at AS createdAt
      FROM observation_evidence
      WHERE observation_id IN (SELECT value FROM json_each(?))
      ORDER BY observation_id, created_at
    `).all(JSON.stringify([...new Set(observationIds)])) as unknown as ObservationEvidenceRecord[];
    return rows.map(normalizeObservationEvidence);
  }

  insertObservationRelation(
    input: Omit<ObservationRelationRecord, "id" | "createdAt"> & { id?: string }
  ): ObservationRelationRecord {
    const id = input.id ?? createStableId("observation-relation", [input.sourceObservationId, input.targetObservationId, input.type]);
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO observation_relations (
        id, source_observation_id, target_observation_id, type, status, confidence, reason, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_observation_id, target_observation_id, type) DO UPDATE SET
        status = CASE
          WHEN observation_relations.status IN ('accepted', 'rejected') AND excluded.status = 'proposed'
            THEN observation_relations.status
          ELSE excluded.status
        END,
        confidence = CASE
          WHEN observation_relations.status IN ('accepted', 'rejected') AND excluded.status = 'proposed'
            THEN observation_relations.confidence
          ELSE excluded.confidence
        END,
        reason = CASE
          WHEN observation_relations.status IN ('accepted', 'rejected') AND excluded.status = 'proposed'
            THEN observation_relations.reason
          ELSE excluded.reason
        END,
        reviewed_at = CASE
          WHEN observation_relations.status IN ('accepted', 'rejected') AND excluded.status = 'proposed'
            THEN observation_relations.reviewed_at
          ELSE excluded.reviewed_at
        END
    `).run(id, input.sourceObservationId, input.targetObservationId, input.type, input.status, input.confidence, input.reason ?? null, input.reviewedAt ?? null, now);
    const row = this.db.prepare(`
      SELECT id, source_observation_id AS sourceObservationId,
             target_observation_id AS targetObservationId, type, status, confidence, reason,
             reviewed_at AS reviewedAt, created_at AS createdAt
      FROM observation_relations
      WHERE source_observation_id = ? AND target_observation_id = ? AND type = ?
    `).get(input.sourceObservationId, input.targetObservationId, input.type) as unknown as ObservationRelationRecord;
    return normalizeObservationRelation(row);
  }

  listObservationRelations(observationId: string): ObservationRelationRecord[] {
    const rows = this.db.prepare(`
      SELECT id, source_observation_id AS sourceObservationId,
             target_observation_id AS targetObservationId, type, status, confidence, reason,
             reviewed_at AS reviewedAt, created_at AS createdAt
      FROM observation_relations
      WHERE source_observation_id = ? OR target_observation_id = ?
      ORDER BY created_at
    `).all(observationId, observationId) as unknown as ObservationRelationRecord[];
    return rows.map(normalizeObservationRelation);
  }

  /** Hydrate relations incident to an explicit observation set in one query. */
  listObservationRelationsForObservations(observationIds: string[]): ObservationRelationRecord[] {
    if (observationIds.length === 0) return [];
    const ids = JSON.stringify([...new Set(observationIds)]);
    const rows = this.db.prepare(`
      SELECT id, source_observation_id AS sourceObservationId,
             target_observation_id AS targetObservationId, type, status, confidence, reason,
             reviewed_at AS reviewedAt, created_at AS createdAt
      FROM observation_relations
      WHERE source_observation_id IN (SELECT value FROM json_each(?))
         OR target_observation_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at
    `).all(ids, ids) as unknown as ObservationRelationRecord[];
    return rows.map(normalizeObservationRelation);
  }

  insertObservationEvent(
    input: Omit<ObservationEventRecord, "id" | "createdAt"> & { id?: string }
  ): ObservationEventRecord {
    const id = input.id ?? createId("observation-event");
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO observation_events (
        id, observation_id, action, actor, reason, before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.observationId,
      input.action,
      input.actor,
      input.reason ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      createdAt
    );
    return { ...input, id, createdAt };
  }

  listObservationEvents(observationId: string): ObservationEventRecord[] {
    const rows = this.db.prepare(`
      SELECT id, observation_id AS observationId, action, actor, reason,
             before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt
      FROM observation_events WHERE observation_id = ? ORDER BY created_at
    `).all(observationId) as unknown as Array<Omit<ObservationEventRecord, "before" | "after"> & { beforeJson?: string; afterJson?: string }>;
    return rows.map((row) => ({
      id: row.id,
      observationId: row.observationId,
      action: row.action,
      actor: row.actor,
      reason: row.reason ?? undefined,
      before: row.beforeJson ? JSON.parse(row.beforeJson) : undefined,
      after: row.afterJson ? JSON.parse(row.afterJson) : undefined,
      createdAt: row.createdAt
    }));
  }

  /** Hydrate events for an explicit observation set in one query. */
  listObservationEventsForObservations(observationIds: string[]): ObservationEventRecord[] {
    if (observationIds.length === 0) return [];
    const rows = this.db.prepare(`
      SELECT id, observation_id AS observationId, action, actor, reason,
             before_json AS beforeJson, after_json AS afterJson, created_at AS createdAt
      FROM observation_events
      WHERE observation_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at
    `).all(JSON.stringify([...new Set(observationIds)])) as unknown as Array<
      Omit<ObservationEventRecord, "before" | "after"> & { beforeJson?: string; afterJson?: string }
    >;
    return rows.map((row) => ({
      id: row.id,
      observationId: row.observationId,
      action: row.action,
      actor: row.actor,
      reason: row.reason ?? undefined,
      before: row.beforeJson ? JSON.parse(row.beforeJson) : undefined,
      after: row.afterJson ? JSON.parse(row.afterJson) : undefined,
      createdAt: row.createdAt
    }));
  }

  createTask(input: TaskInput): TaskRecord {
    const now = nowIso();
    const title = input.title.trim();
    if (!title) {
      throw new Error("Task title is required.");
    }
    const id = input.id ?? createId("task");
    this.db
      .prepare(`
        INSERT INTO tasks (
          id, title, body, status, priority, assignee, deadline, notes,
          product_id, source_id, origin, archived_at, created_at, updated_at, tracking_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `)
      .run(
        id,
        title,
        normalizeOptional(input.body, undefined) ?? null,
        normalizeOptional(input.status, undefined) ?? "open",
        normalizeOptional(input.priority, undefined) ?? "medium",
        normalizeOptional(input.assignee, undefined) ?? "me",
        normalizeOptional(input.deadline, undefined) ?? null,
        normalizeOptional(input.notes, undefined) ?? null,
        normalizeOptional(input.productId, undefined) ?? null,
        normalizeOptional(input.sourceId, undefined) ?? null,
        normalizeOptional(input.origin, undefined) ?? "manual",
        now,
        now,
        input.tracking ? JSON.stringify(input.tracking) : null
      );
    return this.getTask(id) as TaskRecord;
  }

  getTask(taskId: string): TaskRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id,
          title,
          body,
          status,
          priority,
          assignee,
          deadline,
          notes,
          product_id AS productId,
          source_id AS sourceId,
          origin,
          archived_at AS archivedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          tracking_json AS trackingJson
        FROM tasks
        WHERE id = ?
      `)
      .get(taskId) as TaskRecord | undefined;
    return row ? normalizeTaskRecord(row) : undefined;
  }

  /** Hydrate an explicit task allowlist with one bounded query. */
  listTasksByIds(taskIds: string[]): TaskRecord[] {
    if (taskIds.length === 0) return [];
    const rows = this.db
      .prepare(`
        SELECT
          id,
          title,
          body,
          status,
          priority,
          assignee,
          deadline,
          notes,
          product_id AS productId,
          source_id AS sourceId,
          origin,
          archived_at AS archivedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          tracking_json AS trackingJson
        FROM tasks
        WHERE id IN (SELECT value FROM json_each(?))
        ORDER BY id
      `)
      .all(JSON.stringify([...new Set(taskIds)])) as unknown as TaskRecord[];
    return rows.map(normalizeTaskRecord);
  }

  listTasks(productIds: string[] = [], options: { includeArchived?: boolean } = {}): TaskRecord[] {
    const productFilter = productIds.length > 0 ? `AND (product_id IS NULL OR product_id IN (${productIds.map(() => "?").join(", ")}))` : "";
    const archiveFilter = options.includeArchived ? "" : "AND archived_at IS NULL";
    const rows = this.db
      .prepare(`
        SELECT
          id,
          title,
          body,
          status,
          priority,
          assignee,
          deadline,
          notes,
          product_id AS productId,
          source_id AS sourceId,
          origin,
          archived_at AS archivedAt,
          created_at AS createdAt,
          updated_at AS updatedAt,
          tracking_json AS trackingJson
        FROM tasks
        WHERE 1 = 1
        ${productFilter}
        ${archiveFilter}
        ORDER BY
          CASE status
            WHEN 'blocked' THEN 0
            WHEN 'open' THEN 1
            WHEN 'pending' THEN 2
            WHEN 'ready' THEN 3
            WHEN 'done' THEN 4
            ELSE 5
          END,
          COALESCE(deadline, '9999-12-31') ASC,
          updated_at DESC
      `)
      .all(...productIds) as unknown as TaskRecord[];
    return rows.map(normalizeTaskRecord);
  }

  /**
   * Fetch the bounded task candidate set for a resolved context. A candidate
   * has at least one in-scope product, source or linked entity; strict callers
   * then validate that every populated dimension stays inside the boundary.
   */
  listTaskContextCandidates(filter: {
    productIds?: string[];
    sourceIds?: string[];
    entityRefs?: Array<{ kind: string; id: string }>;
    includeArchived?: boolean;
  }): TaskRecord[] {
    const candidateQueries: string[] = [];
    const params: string[] = [];
    const productIds = [...new Set(filter.productIds ?? [])];
    const sourceIds = [...new Set(filter.sourceIds ?? [])];
    const entityRefs = [...new Map(
      (filter.entityRefs ?? []).map((ref) => [`${ref.kind}\u0000${ref.id}`, { kind: ref.kind, id: ref.id }])
    ).values()];

    if (productIds.length > 0) {
      candidateQueries.push(`
        SELECT task.id
        FROM json_each(?) AS selected
        JOIN tasks AS task ON task.product_id = selected.value
      `);
      params.push(JSON.stringify(productIds));
    }
    if (sourceIds.length > 0) {
      candidateQueries.push(`
        SELECT task.id
        FROM json_each(?) AS selected
        JOIN tasks AS task ON task.source_id = selected.value
      `);
      params.push(JSON.stringify(sourceIds));
    }
    if (entityRefs.length > 0) {
      candidateQueries.push(`
        SELECT task_link.task_id AS id
        FROM json_each(?) AS selected
        JOIN task_links AS task_link
          ON task_link.target_kind = json_extract(selected.value, '$.kind')
         AND task_link.target_id = json_extract(selected.value, '$.id')
      `);
      params.push(JSON.stringify(entityRefs));
    }
    if (candidateQueries.length === 0) return [];

    const archiveFilter = filter.includeArchived ? "" : "AND archived_at IS NULL";
    const rows = this.db.prepare(`
      WITH context_candidate_tasks(id) AS (
        ${candidateQueries.join("\nUNION\n")}
      )
      SELECT
        id,
        title,
        body,
        status,
        priority,
        assignee,
        deadline,
        notes,
        product_id AS productId,
        source_id AS sourceId,
        origin,
        archived_at AS archivedAt,
        created_at AS createdAt,
        updated_at AS updatedAt,
        tracking_json AS trackingJson
      FROM tasks
      WHERE id IN (SELECT id FROM context_candidate_tasks)
      ${archiveFilter}
      ORDER BY
        CASE status
          WHEN 'blocked' THEN 0
          WHEN 'open' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'ready' THEN 3
          WHEN 'done' THEN 4
          ELSE 5
        END,
        COALESCE(deadline, '9999-12-31') ASC,
        updated_at DESC
    `).all(...params) as unknown as TaskRecord[];
    return rows.map(normalizeTaskRecord);
  }

  updateTask(input: TaskUpdateInput): TaskRecord {
    const existing = this.getTask(input.taskId);
    if (!existing) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    const now = nowIso();
    const next: TaskRecord = {
      ...existing,
      title: normalizeOptional(input.title, existing.title) ?? existing.title,
      body: normalizeOptional(input.body, existing.body),
      status: normalizeOptional(input.status, existing.status) ?? existing.status,
      priority: normalizeOptional(input.priority, existing.priority) ?? existing.priority,
      assignee: normalizeOptional(input.assignee, existing.assignee) ?? existing.assignee,
      deadline: normalizeOptional(input.deadline, existing.deadline),
      notes: normalizeOptional(input.notes, existing.notes),
      productId: normalizeOptional(input.productId, existing.productId),
      sourceId: normalizeOptional(input.sourceId, existing.sourceId),
      origin: normalizeOptional(input.origin, existing.origin) ?? existing.origin,
      tracking: input.tracking === undefined ? existing.tracking : input.tracking,
      updatedAt: now
    };

    this.db
      .prepare(`
        UPDATE tasks
        SET
          title = ?,
          body = ?,
          status = ?,
          priority = ?,
          assignee = ?,
          deadline = ?,
          notes = ?,
          product_id = ?,
          source_id = ?,
          origin = ?,
          updated_at = ?,
          tracking_json = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.body ?? null,
        next.status,
        next.priority,
        next.assignee,
        next.deadline ?? null,
        next.notes ?? null,
        next.productId ?? null,
        next.sourceId ?? null,
        next.origin,
        next.updatedAt,
        next.tracking ? JSON.stringify(next.tracking) : null,
        next.id
      );
    return this.getTask(input.taskId) as TaskRecord;
  }

  archiveTask(taskId: string): void {
    const now = nowIso();
    const result = this.db
      .prepare(`
        UPDATE tasks
        SET status = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, now, taskId);
    if (result.changes > 0) {
      return;
    }
    const inbox = this.getInboxItem(taskId);
    if (inbox?.type === "task") {
      this.updateInboxStatus(taskId, "rejected");
      return;
    }
    this.upsertTaskMetadata({ taskId, status: "archived" });
  }

  listTaskMetadata(taskIds: string[]): TaskMetadataRecord[] {
    if (taskIds.length === 0) {
      return [];
    }
    const rows = this.db
      .prepare(`
        SELECT
          task_id AS taskId,
          title,
          body,
          status,
          priority,
          assignee,
          deadline,
          notes,
          updated_at AS updatedAt
        FROM task_metadata
        WHERE task_id IN (${taskIds.map(() => "?").join(", ")})
      `)
      .all(...taskIds) as unknown as TaskMetadataRecord[];
    return rows.map((row) => normalizeTaskMetadata(row));
  }

  getTaskMetadata(taskId: string): TaskMetadataRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          task_id AS taskId,
          title,
          body,
          status,
          priority,
          assignee,
          deadline,
          notes,
          updated_at AS updatedAt
        FROM task_metadata
        WHERE task_id = ?
      `)
      .get(taskId) as TaskMetadataRecord | undefined;
    return row ? normalizeTaskMetadata(row) : undefined;
  }

  upsertTaskMetadata(input: TaskMetadataInput): TaskMetadataRecord {
    const now = nowIso();
    const existing = this.getTaskMetadata(input.taskId);
    const next = {
      taskId: input.taskId,
      title: normalizeOptional(input.title, existing?.title),
      body: normalizeOptional(input.body, existing?.body),
      status: normalizeOptional(input.status, existing?.status),
      priority: normalizeOptional(input.priority, existing?.priority),
      assignee: normalizeOptional(input.assignee, existing?.assignee),
      deadline: normalizeOptional(input.deadline, existing?.deadline),
      notes: normalizeOptional(input.notes, existing?.notes),
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO task_metadata (task_id, title, body, status, priority, assignee, deadline, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          status = excluded.status,
          priority = excluded.priority,
          assignee = excluded.assignee,
          deadline = excluded.deadline,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `)
      .run(
        next.taskId,
        next.title ?? null,
        next.body ?? null,
        next.status ?? null,
        next.priority ?? null,
        next.assignee ?? null,
        next.deadline ?? null,
        next.notes ?? null,
        next.updatedAt
      );

    return next;
  }

  listTaskLinks(taskIds: string[]): TaskLinkRecord[] {
    if (taskIds.length === 0) {
      return [];
    }
    const rows = this.db
      .prepare(`
        SELECT
          id,
          task_id AS taskId,
          relation_type AS relationType,
          target_kind AS targetKind,
          target_id AS targetId,
          label,
          metadata_json AS metadataJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM task_links
        WHERE task_id IN (SELECT value FROM json_each(?))
        ORDER BY relation_type ASC, label ASC, target_kind ASC, target_id ASC
      `)
      .all(JSON.stringify([...new Set(taskIds)])) as unknown as TaskLinkRecord[];
    return rows.map(normalizeTaskLink);
  }

  listTaskLinksForTargets(targets: Array<{ kind: string; id: string }>): TaskLinkRecord[] {
    if (targets.length === 0) return [];
    const rows = this.db.prepare(`
      WITH requested(kind, id) AS (
        SELECT json_extract(value, '$.kind'), json_extract(value, '$.id')
        FROM json_each(?)
      )
      SELECT
        task_links.id,
        task_links.task_id AS taskId,
        task_links.relation_type AS relationType,
        task_links.target_kind AS targetKind,
        task_links.target_id AS targetId,
        task_links.label,
        task_links.metadata_json AS metadataJson,
        task_links.created_at AS createdAt,
        task_links.updated_at AS updatedAt
      FROM requested
      JOIN task_links
        ON task_links.target_kind = requested.kind AND task_links.target_id = requested.id
      ORDER BY task_links.updated_at DESC, task_links.id
    `).all(JSON.stringify(targets)) as unknown as TaskLinkRecord[];
    return rows.map(normalizeTaskLink);
  }

  upsertTaskLink(input: TaskLinkInput): TaskLinkRecord {
    const relationType = input.relationType.trim();
    const targetKind = input.targetKind.trim();
    const targetId = input.targetId.trim();
    if (!relationType || !targetKind || !targetId) {
      throw new Error("Task link requires relationType, targetKind and targetId.");
    }
    if (!this.getTask(input.taskId)) throw new Error(`Task not found: ${input.taskId}`);
    this.assertOutcomeTaskLink({ ...input, relationType, targetKind, targetId });
    const now = nowIso();
    const id = createStableId("task-link", [input.taskId, relationType, targetKind, targetId]);
    this.db.prepare(`
      INSERT INTO task_links (
        id, task_id, relation_type, target_kind, target_id, label,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, relation_type, target_kind, target_id) DO UPDATE SET
        label = excluded.label,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.taskId,
      relationType,
      targetKind,
      targetId,
      normalizeOptional(input.label, undefined) ?? null,
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    );
    return this.listTaskLinks([input.taskId]).find((link) => link.id === id)!;
  }

  replaceTaskLinks(taskId: string, links: Omit<TaskLinkInput, "taskId">[]): TaskLinkRecord[] {
    const now = nowIso();
    this.transaction(() => {
      this.db.prepare("DELETE FROM task_links WHERE task_id = ?").run(taskId);
      const insert = this.db.prepare(`
        INSERT INTO task_links (
          id, task_id, relation_type, target_kind, target_id, label,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const link of links) {
        const relationType = link.relationType.trim();
        const targetKind = link.targetKind.trim();
        const targetId = link.targetId.trim();
        if (!relationType || !targetKind || !targetId) {
          continue;
        }
        this.assertOutcomeTaskLink({ ...link, taskId, relationType, targetKind, targetId });
        insert.run(
          createStableId("task-link", [taskId, relationType, targetKind, targetId]),
          taskId,
          relationType,
          targetKind,
          targetId,
          normalizeOptional(link.label, undefined) ?? null,
          JSON.stringify(link.metadata ?? {}),
          now,
          now
        );
      }
    });
    return this.listTaskLinks([taskId]);
  }

  private assertOutcomeTaskLink(input: TaskLinkInput): void {
    if (input.relationType !== "contributes_to") return;
    if (input.targetKind !== "okr") {
      throw new Error(
        `Invalid contributes_to task link: expected task -> okr, received task -> ${input.targetKind}.`
      );
    }
    if (!this.getEntity("okr", input.targetId)) {
      throw new Error(`Cannot create contributes_to task link: target entity not found: okr:${input.targetId}.`);
    }
    const outcome = input.metadata?.outcome;
    const rawMetadataImpact = outcome && typeof outcome === "object" && !Array.isArray(outcome)
      ? (outcome as Record<string, unknown>).expectedImpact
      : undefined;
    const metadataImpact = typeof rawMetadataImpact === "string"
      ? normalizeOptional(rawMetadataImpact, undefined)
      : undefined;
    if (!normalizeOptional(input.label, undefined) && !metadataImpact) {
      throw new Error("A contributes_to task link requires an expected-impact label or outcome metadata.");
    }
  }

  upsertKpiMeasurement(input: KpiMeasurementInput): KpiMeasurementRecord {
    if (this.transactionDepth === 0) {
      return this.runInImmediateTransaction(() => this.upsertKpiMeasurement(input));
    }
    if (!this.getEntity("kpi", input.kpiId)) {
      throw new Error(`Cannot record KPI measurement: KPI entity not found: kpi:${input.kpiId}.`);
    }
    if (!Number.isFinite(input.value)) throw new Error("KPI measurement value must be finite.");
    if (!Number.isFinite(Date.parse(input.measuredAt))) throw new Error("KPI measurement date must be a valid ISO date.");
    const measuredAt = new Date(input.measuredAt).toISOString();
    const sourceId = normalizeOptional(input.sourceId, undefined);
    const observationId = normalizeOptional(input.observationId, undefined);
    const note = normalizeOptional(input.note, undefined);
    const id = input.id ?? createStableId("kpi-measurement", [
      input.kpiId,
      measuredAt,
      sourceId ?? "",
      observationId ?? ""
    ]);

    const assertSameMeasurement = (existing: KpiMeasurementRecord): KpiMeasurementRecord => {
      const unchanged = existing.kpiId === input.kpiId
        && existing.value === input.value
        && existing.measuredAt === measuredAt
        && existing.sourceId === sourceId
        && existing.observationId === observationId
        && existing.note === note;
      if (!unchanged) {
        throw new Error(`KPI measurement ${existing.id} is immutable; record a correction at a distinct timestamp instead.`);
      }
      return existing;
    };
    const existingById = this.getKpiMeasurement(id);
    if (existingById) return assertSameMeasurement(existingById);

    const existingNaturalRow = this.db.prepare(`
      SELECT id, kpi_id AS kpiId, value, measured_at AS measuredAt,
             source_id AS sourceId, observation_id AS observationId, note,
             created_at AS createdAt, updated_at AS updatedAt
      FROM kpi_measurements
      WHERE kpi_id = ? AND measured_at = ?
        AND COALESCE(source_id, '') = COALESCE(?, '')
        AND COALESCE(observation_id, '') = COALESCE(?, '')
    `).get(input.kpiId, measuredAt, sourceId ?? null, observationId ?? null) as KpiMeasurementRecord | undefined;
    if (existingNaturalRow) return assertSameMeasurement(normalizeKpiMeasurement(existingNaturalRow));

    const now = nowIso();
    this.db.prepare(`
      INSERT INTO kpi_measurements (
        id, kpi_id, value, measured_at, source_id, observation_id, note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.kpiId,
      input.value,
      measuredAt,
      sourceId ?? null,
      observationId ?? null,
      note ?? null,
      now,
      now
    );
    return this.getKpiMeasurement(id)!;
  }

  getKpiMeasurement(id: string): KpiMeasurementRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, kpi_id AS kpiId, value, measured_at AS measuredAt,
             source_id AS sourceId, observation_id AS observationId, note,
             created_at AS createdAt, updated_at AS updatedAt
      FROM kpi_measurements WHERE id = ?
    `).get(id) as KpiMeasurementRecord | undefined;
    return row ? normalizeKpiMeasurement(row) : undefined;
  }

  listKpiMeasurements(
    kpiId: string,
    options: { from?: string; to?: string; limit?: number; ascending?: boolean } = {}
  ): KpiMeasurementRecord[] {
    const clauses = ["kpi_id = ?"];
    const params: Array<string | number> = [kpiId];
    if (options.from) {
      clauses.push("measured_at >= ?");
      params.push(new Date(options.from).toISOString());
    }
    if (options.to) {
      clauses.push("measured_at <= ?");
      params.push(new Date(options.to).toISOString());
    }
    const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit ?? 500)));
    const order = options.ascending ? "ASC" : "DESC";
    const rows = this.db.prepare(`
      SELECT id, kpi_id AS kpiId, value, measured_at AS measuredAt,
             source_id AS sourceId, observation_id AS observationId, note,
             created_at AS createdAt, updated_at AS updatedAt
      FROM kpi_measurements
      WHERE ${clauses.join(" AND ")}
      ORDER BY measured_at ${order}, id ${order}
      LIMIT ?
    `).all(...params, limit) as unknown as KpiMeasurementRecord[];
    return rows.map(normalizeKpiMeasurement);
  }

  listKpiMeasurementsForKpis(kpiIds: string[], perKpiLimit = 50): KpiMeasurementRecord[] {
    if (kpiIds.length === 0) return [];
    const limit = Math.max(1, Math.min(500, Math.floor(perKpiLimit)));
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT id, kpi_id AS kpiId, value, measured_at AS measuredAt,
               source_id AS sourceId, observation_id AS observationId, note,
               created_at AS createdAt, updated_at AS updatedAt,
               ROW_NUMBER() OVER (PARTITION BY kpi_id ORDER BY measured_at DESC, id DESC) AS rank
        FROM kpi_measurements
        WHERE kpi_id IN (SELECT value FROM json_each(?))
      )
      SELECT id, kpiId, value, measuredAt, sourceId, observationId, note,
             createdAt, updatedAt
      FROM ranked WHERE rank <= ?
      ORDER BY kpiId, measuredAt DESC, id DESC
    `).all(JSON.stringify([...new Set(kpiIds)]), limit) as unknown as KpiMeasurementRecord[];
    return rows.map(normalizeKpiMeasurement);
  }

  /** Complete KPI history for backup/export paths; interactive reads stay bounded. */
  listAllKpiMeasurements(): KpiMeasurementRecord[] {
    const rows = this.db.prepare(`
      SELECT id, kpi_id AS kpiId, value, measured_at AS measuredAt,
             source_id AS sourceId, observation_id AS observationId, note,
             created_at AS createdAt, updated_at AS updatedAt
      FROM kpi_measurements
      ORDER BY kpi_id, measured_at, id
    `).all() as unknown as KpiMeasurementRecord[];
    return rows.map(normalizeKpiMeasurement);
  }

  listInbox(status?: InboxStatus, productIds: string[] = []): InboxItem[] {
    return this.listInboxFiltered({ status, productIds });
  }

  /**
   * Return every Inbox item anchored to at least one resolved context
   * dimension. Payload references are served by the migration-maintained
   * projection instead of hydrating and scanning the global Inbox.
   */
  listInboxContextCandidates(filter: {
    productIds?: string[];
    sourceIds?: string[];
    captureIds?: string[];
    entityRefs?: string[];
    observationIds?: string[];
    relationTypes?: string[];
  }): InboxItem[] {
    const candidates: string[] = [];
    const params: string[] = [];
    const topLevel = (column: "product_id" | "source_id", values: string[] | undefined): void => {
      if (!values?.length) return;
      candidates.push(`SELECT id FROM memory_inbox WHERE ${column} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify([...new Set(values)]));
    };
    const payload = (
      kind: "product" | "source" | "capture" | "entity" | "observation" | "relation",
      values: string[] | undefined
    ): void => {
      if (!values?.length) return;
      candidates.push(`
        SELECT inbox_id AS id FROM inbox_context_refs
        WHERE ref_kind = ? AND ref_value IN (SELECT value FROM json_each(?))
      `);
      params.push(kind, JSON.stringify([...new Set(values)]));
    };

    topLevel("product_id", filter.productIds);
    topLevel("source_id", filter.sourceIds);
    payload("product", filter.productIds);
    payload("source", filter.sourceIds);
    payload("capture", filter.captureIds);
    payload("entity", filter.entityRefs);
    payload("observation", filter.observationIds);
    payload("relation", filter.relationTypes);
    if (candidates.length === 0) return [];

    const rows = this.db.prepare(`
      WITH candidate_ids(id) AS (
        ${candidates.join(" UNION ")}
      )
      SELECT
        memory_inbox.id,
        type,
        title,
        body,
        status,
        source_id AS sourceId,
        product_id AS productId,
        payload_json AS payloadJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM candidate_ids
      JOIN memory_inbox ON memory_inbox.id = candidate_ids.id
      ORDER BY created_at DESC
    `).all(...params) as unknown as Array<InboxItem & { payloadJson: string }>;
    return rows.map(rowToInboxItem);
  }

  /** Storage-bounded Inbox query for histories and strict allowlists. */
  listInboxFiltered(filter: {
    status?: InboxStatus;
    productIds?: string[];
    entityRefs?: EntityRef[];
    types?: string[];
    ids?: string[];
    limit?: number;
  } = {}): InboxItem[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.productIds?.length) {
      // Items without a product (curation reviews on non-product entities) are visible in every product scope.
      clauses.push(`(product_id IN (${filter.productIds.map(() => "?").join(", ")}) OR product_id IS NULL)`);
      params.push(...filter.productIds);
    }
    if (filter.entityRefs) {
      if (filter.entityRefs.length === 0) return [];
      const entityRefs = JSON.stringify(uniqueEntityRefStrings(filter.entityRefs));
      clauses.push(`(
        EXISTS (
          SELECT 1
          FROM inbox_context_refs scoped_ref
          WHERE scoped_ref.inbox_id = memory_inbox.id
            AND scoped_ref.ref_kind = 'entity'
            AND scoped_ref.ref_value IN (SELECT value FROM json_each(?))
        )
        OR EXISTS (
          SELECT 1
          FROM source_entities scoped_source
          WHERE scoped_source.source_id = memory_inbox.source_id
            AND scoped_source.entity_kind || ':' || scoped_source.entity_id
                IN (SELECT value FROM json_each(?))
        )
        OR EXISTS (
          SELECT 1
          FROM inbox_context_refs scoped_source_ref
          JOIN source_entities scoped_source
            ON scoped_source_ref.ref_kind = 'source'
           AND scoped_source.source_id = scoped_source_ref.ref_value
          WHERE scoped_source_ref.inbox_id = memory_inbox.id
            AND scoped_source.entity_kind || ':' || scoped_source.entity_id
                IN (SELECT value FROM json_each(?))
        )
        OR EXISTS (
          SELECT 1
          FROM inbox_context_refs scoped_capture_ref
          JOIN captures scoped_capture
            ON scoped_capture_ref.ref_kind = 'capture'
           AND scoped_capture.id = scoped_capture_ref.ref_value
          WHERE scoped_capture_ref.inbox_id = memory_inbox.id
            AND scoped_capture.primary_entity_kind || ':' || scoped_capture.primary_entity_id
                IN (SELECT value FROM json_each(?))
        )
        OR EXISTS (
          SELECT 1
          FROM inbox_context_refs scoped_capture_ref
          JOIN capture_entities scoped_capture_entity
            ON scoped_capture_ref.ref_kind = 'capture'
           AND scoped_capture_entity.capture_id = scoped_capture_ref.ref_value
          WHERE scoped_capture_ref.inbox_id = memory_inbox.id
            AND scoped_capture_entity.entity_kind || ':' || scoped_capture_entity.entity_id
                IN (SELECT value FROM json_each(?))
        )
        OR EXISTS (
          SELECT 1
          FROM inbox_context_refs scoped_observation_ref
          JOIN observations scoped_observation
            ON scoped_observation_ref.ref_kind = 'observation'
           AND scoped_observation.id = scoped_observation_ref.ref_value
          WHERE scoped_observation_ref.inbox_id = memory_inbox.id
            AND scoped_observation.subject_kind || ':' || scoped_observation.subject_id
                IN (SELECT value FROM json_each(?))
        )
      )`);
      params.push(entityRefs, entityRefs, entityRefs, entityRefs, entityRefs, entityRefs);
    }
    if (filter.types) {
      if (filter.types.length === 0) return [];
      clauses.push(`type IN (${filter.types.map(() => "?").join(", ")})`);
      params.push(...filter.types);
    }
    if (filter.ids) {
      if (filter.ids.length === 0) return [];
      clauses.push("id IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify([...new Set(filter.ids)]));
    }
    const limit = Number.isFinite(Number(filter.limit)) ? Math.max(1, Math.floor(Number(filter.limit))) : undefined;
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`
        SELECT
          id,
          type,
          title,
          body,
          status,
          source_id AS sourceId,
          product_id AS productId,
          payload_json AS payloadJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM memory_inbox
        ${where}
        ORDER BY created_at DESC
        ${limit ? "LIMIT ?" : ""}
      `)
      .all(...params, ...(limit ? [limit] : [])) as unknown as Array<InboxItem & { payloadJson: string }>;

    return rows.map(rowToInboxItem);
  }

  close(): void {
    this.db.close();
  }

  getUiState<T = unknown>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value_json AS valueJson FROM ui_state WHERE key = ?")
      .get(key) as { valueJson: string } | undefined;
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.valueJson) as T;
  }

  setUiState(key: string, value: unknown): void {
    const now = nowIso();
    this.db
      .prepare(`
        INSERT INTO ui_state (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(key, JSON.stringify(value), now);
  }

  listContextViews(): ContextViewRecord[] {
    const rows = this.db
      .prepare(`
        SELECT id, name, version, visual_state_json AS visualStateJson,
               context_json AS contextJson, refresh_policy AS refreshPolicy,
               created_at AS createdAt, updated_at AS updatedAt
        FROM context_views
        ORDER BY name COLLATE NOCASE, created_at
      `)
      .all() as unknown as Array<{
        id: string;
        name: string;
        version: number;
        visualStateJson: string;
        contextJson: string;
        refreshPolicy: ContextViewRecord["refreshPolicy"];
        createdAt: string;
        updatedAt: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      visualState: parseJsonObject(row.visualStateJson) ?? {},
      context: JSON.parse(row.contextJson) as ContextViewRecord["context"],
      refreshPolicy: row.refreshPolicy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  getContextView(id: string): ContextViewRecord | undefined {
    return this.listContextViews().find((view) => view.id === id);
  }

  saveContextView(view: ContextViewRecord): void {
    this.db
      .prepare(`
        INSERT INTO context_views (
          id, name, version, visual_state_json, context_json, refresh_policy, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          version = excluded.version,
          visual_state_json = excluded.visual_state_json,
          context_json = excluded.context_json,
          refresh_policy = excluded.refresh_policy,
          updated_at = excluded.updated_at
      `)
      .run(
        view.id,
        view.name,
        view.version,
        JSON.stringify(view.visualState),
        JSON.stringify(view.context),
        view.refreshPolicy,
        view.createdAt,
        view.updatedAt
      );
  }

  deleteContextView(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM context_views WHERE id = ?").run(id).changes) > 0;
  }

  nextContextPackVersion(viewId?: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM context_packs WHERE version_scope = ?")
      .get(contextPackVersionScope(viewId));
    return Number((row as { version?: number } | undefined)?.version ?? 1);
  }

  saveContextPack(pack: ContextPack): void {
    this.db
      .prepare(`
        INSERT INTO context_packs (
          id, version, version_scope, view_id, view_version, session_id, request_text, scope_json,
          resolved_entities_json, entries_json, entry_count, exclusions_json, provenance_json,
          estimated_tokens, actual_tokens, budget, truncated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        pack.id,
        pack.version,
        contextPackVersionScope(pack.viewId),
        pack.viewId ?? null,
        pack.viewVersion ?? null,
        pack.sessionId ?? null,
        pack.request,
        JSON.stringify(pack.scope),
        JSON.stringify(pack.resolvedEntities),
        JSON.stringify(pack.entries),
        pack.entries.length,
        JSON.stringify(pack.exclusions),
        JSON.stringify(pack.provenance),
        pack.estimatedTokens,
        pack.actualTokens,
        pack.budget,
        pack.truncated ? 1 : 0,
        pack.createdAt
      );
  }

  /** Allocates and inserts a version while holding SQLite's writer lock. */
  saveContextPackWithNextVersion(
    pack: Omit<ContextPack, "version">,
    retentionPolicy: Partial<ContextPackRetentionPolicy> = DEFAULT_CONTEXT_PACK_RETENTION_POLICY
  ): ContextPack {
    return this.runInImmediateTransaction(() => {
      const saved: ContextPack = { ...pack, version: this.nextContextPackVersion(pack.viewId) };
      this.saveContextPack(saved);
      this.pruneContextPacks({
        policy: retentionPolicy,
        // Bound automatic maintenance to the scope being written. Explicit CLI
        // maintenance can scan all scopes when desired.
        viewId: pack.viewId ?? null
      });
      return saved;
    });
  }

  getContextPack(id: string): ContextPack | undefined {
    const row = this.db.prepare("SELECT * FROM context_packs WHERE id = ?").get(id) as ContextPackRow | undefined;
    return row ? rowToContextPack(row) : undefined;
  }

  listContextPacks(filter: { viewId?: string; sessionId?: string; limit?: number } = {}): ContextPack[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.viewId) {
      clauses.push("view_id = ?");
      params.push(filter.viewId);
    }
    if (filter.sessionId) {
      clauses.push("session_id = ?");
      params.push(filter.sessionId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.max(1, Math.min(500, filter.limit ?? 50)));
    const rows = this.db
      .prepare(`SELECT * FROM context_packs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as unknown as ContextPackRow[];
    return rows.map(rowToContextPack);
  }

  /** Reads Context Pack history without selecting or parsing `entries_json`. */
  listContextPackSummaries(filter: { viewId?: string; sessionId?: string; limit?: number } = {}): ContextPackSummary[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.viewId) {
      clauses.push("view_id = ?");
      params.push(filter.viewId);
    }
    if (filter.sessionId) {
      clauses.push("session_id = ?");
      params.push(filter.sessionId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.max(1, Math.min(500, filter.limit ?? 50)));
    const rows = this.db
      .prepare(`
        SELECT id, version, view_id, view_version, session_id, request_text,
               scope_json, entry_count, provenance_json, estimated_tokens,
               actual_tokens, budget, truncated, created_at
        FROM context_packs ${where}
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(...params) as unknown as ContextPackSummaryRow[];
    return rows.map(rowToContextPackSummary);
  }

  pruneContextPacks(options: ContextPackPruneOptions = {}): ContextPackPruneResult {
    if (this.transactionDepth === 0) {
      return this.runInImmediateTransaction(() => this.pruneContextPacks(options));
    }
    const policy = normalizeContextPackRetentionPolicy(options.policy);
    const params: string[] = [];
    let where = "";
    if (options.viewId === null) {
      where = "WHERE version_scope = 'global'";
    } else if (options.viewId !== undefined) {
      where = "WHERE version_scope = ?";
      params.push(contextPackVersionScope(options.viewId));
    }
    const rows = this.db
      .prepare(`
        SELECT id, version_scope AS versionScope, session_id AS sessionId,
               version, created_at AS createdAt
        FROM context_packs ${where}
        ORDER BY created_at DESC, version DESC, id DESC
      `)
      .all(...params) as unknown as ContextPackRetentionRow[];
    const byScope = groupContextPackRetentionRows(rows, (row) => row.versionScope);
    for (const group of byScope.values()) {
      // Version is the durable sequence. Protecting by timestamp could delete
      // MAX(version) after clock skew and allow a later allocation to reuse it.
      group.sort((left, right) => right.version - left.version || right.id.localeCompare(left.id));
    }
    const protectedIds = new Set<string>();
    for (const group of byScope.values()) {
      for (const row of group.slice(0, policy.preserveLatestPerView)) protectedIds.add(row.id);
    }

    const reasons = new Map<string, Set<keyof ContextPackPruneResult["byReason"]>>();
    const mark = (id: string, reason: keyof ContextPackPruneResult["byReason"]): void => {
      if (protectedIds.has(id)) return;
      const current = reasons.get(id) ?? new Set();
      current.add(reason);
      reasons.set(id, current);
    };
    const cutoff = Date.parse(options.now ?? nowIso()) - policy.maxAgeDays * 24 * 60 * 60 * 1_000;
    for (const row of rows) {
      const createdAt = Date.parse(row.createdAt);
      if (Number.isFinite(createdAt) && createdAt < cutoff) mark(row.id, "age");
    }
    for (const group of byScope.values()) {
      group.slice(policy.maxPacksPerView).forEach((row) => mark(row.id, "view_limit"));
    }
    const withSession = rows.filter((row): row is ContextPackRetentionRow & { sessionId: string } => Boolean(row.sessionId));
    const bySession = groupContextPackRetentionRows(withSession, (row) =>
      JSON.stringify([row.versionScope, row.sessionId])
    );
    for (const group of bySession.values()) {
      group.sort((left, right) => right.version - left.version || right.id.localeCompare(left.id));
      group.slice(policy.maxPacksPerSession).forEach((row) => mark(row.id, "session_limit"));
    }

    const candidateIds = rows.filter((row) => reasons.has(row.id)).map((row) => row.id);
    const byReason: ContextPackPruneResult["byReason"] = { age: 0, view_limit: 0, session_limit: 0 };
    for (const rowReasons of reasons.values()) {
      for (const reason of rowReasons) byReason[reason] += 1;
    }
    if (!options.dryRun && candidateIds.length > 0) {
      this.runInTransaction(() => {
        const remove = this.db.prepare("DELETE FROM context_packs WHERE id = ?");
        for (const id of candidateIds) remove.run(id);
      });
    }
    return {
      dryRun: Boolean(options.dryRun),
      scanned: rows.length,
      deleted: candidateIds.length,
      retained: rows.length - candidateIds.length,
      protected: protectedIds.size,
      candidateIds,
      byReason,
      policy
    };
  }

  estimateSourceTokens(sourceIds: string[]): number {
    if (sourceIds.length === 0) return 0;
    const placeholders = sourceIds.map(() => "?").join(", ");
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(COALESCE(token_count, 0)), 0) AS tokens FROM source_chunks WHERE source_id IN (${placeholders})`)
      .get(...sourceIds) as { tokens: number };
    return Number(row.tokens ?? 0);
  }

  runInTransaction<T>(work: () => T): T {
    return this.transaction(work);
  }

  runInImmediateTransaction<T>(work: () => T): T {
    return this.transaction(work, "immediate");
  }

  private transaction<T>(work: () => T, mode: "deferred" | "immediate" = "deferred"): T {
    const outermost = this.transactionDepth === 0;
    const savepoint = `oneagent_${this.transactionDepth}`;
    this.db.exec(outermost ? mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    this.rollbackActions.push([]);
    try {
      const result = work();
      this.db.exec(outermost ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      const actions = this.rollbackActions.pop() ?? [];
      if (!outermost) this.rollbackActions.at(-1)?.push(...actions);
      return result;
    } catch (error) {
      try {
        if (outermost) {
          this.db.exec("ROLLBACK");
        } else {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        }
      } catch {
        // Preserve the original operation/commit error if rollback itself fails.
      }
      const recoveryErrors: unknown[] = [];
      for (const action of (this.rollbackActions.pop() ?? []).reverse()) {
        try { action(); } catch (recoveryError) { recoveryErrors.push(recoveryError); }
      }
      if (recoveryErrors.length > 0) {
        throw new AggregateError([error, ...recoveryErrors], "Database operation failed and a Markdown file could not be restored.");
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private ensureEntityColumns(): void {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entities'").all();
    if (tables.length === 0) {
      return;
    }
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has("repo_path")) {
      this.db.exec("ALTER TABLE entities ADD COLUMN repo_path TEXT;");
    }
    if (!columns.has("wiki_root")) {
      this.db.exec("ALTER TABLE entities ADD COLUMN wiki_root TEXT;");
    }
    if (!columns.has("focus_level")) {
      this.db.exec("ALTER TABLE entities ADD COLUMN focus_level TEXT;");
    }
    if (!columns.has("contributor_ids_json")) {
      this.db.exec("ALTER TABLE entities ADD COLUMN contributor_ids_json TEXT;");
    }
  }

  private ensureEntitySearchIndex(): void {
    const alreadyBackfilled = this.db
      .prepare("SELECT id FROM schema_migrations WHERE id = '010_entity_search_fts'")
      .get();
    if (alreadyBackfilled) return;
    // Rebuild is the documented FTS5 backfill operation for an external-content
    // table. migrate() holds the immediate writer lock for legacy databases.
    this.db.prepare("INSERT INTO entities_fts(entities_fts) VALUES ('rebuild')").run();
  }

  private ensureObservationSearchIndex(): void {
    const alreadyBackfilled = this.db
      .prepare("SELECT id FROM schema_migrations WHERE id = '012_observation_search_fts'")
      .get();
    if (alreadyBackfilled) return;
    // `INITIAL_SCHEMA_SQL` creates the FTS table and triggers for both fresh
    // and legacy databases. Rebuild once so pre-P3 observations become visible.
    this.db.prepare("INSERT INTO observations_fts(observations_fts) VALUES ('rebuild')").run();
  }

  /**
   * Migration boundary from the historical product registry scope to generic
   * typed entity links. Legacy columns remain readable, but every runtime
   * lookup and every new write uses source_entities + observation subjects.
   */
  private ensureGenericSourceEntityLinks(): void {
    const migrated = this.db
      .prepare("SELECT id FROM schema_migrations WHERE id = '013_generic_source_entities'")
      .get();
    if (migrated) return;

    this.db.exec(`
      INSERT OR IGNORE INTO source_entities
        (source_id, entity_kind, entity_id, relation_type, confidence)
      SELECT source_id, 'product', product_id, 'about', confidence
      FROM source_products;

      INSERT OR IGNORE INTO source_entities
        (source_id, entity_kind, entity_id, relation_type, confidence)
      SELECT source_id, primary_entity_kind, primary_entity_id, 'primary', 1.0
      FROM captures
      WHERE source_id IS NOT NULL;

      INSERT OR IGNORE INTO source_entities
        (source_id, entity_kind, entity_id, relation_type, confidence)
      SELECT capture.source_id, related.entity_kind, related.entity_id, related.relation_type, 1.0
      FROM capture_entities related
      JOIN captures capture ON capture.id = related.capture_id
      WHERE capture.source_id IS NOT NULL;

      UPDATE observations
      SET subject_kind = (
            SELECT primary_entity_kind FROM captures WHERE captures.id = observations.capture_id
          ),
          subject_id = (
            SELECT primary_entity_id FROM captures WHERE captures.id = observations.capture_id
          )
      WHERE subject_kind IS NULL AND subject_id IS NULL AND capture_id IS NOT NULL;

      UPDATE observations
      SET subject_kind = 'product', subject_id = product_id
      WHERE subject_kind IS NULL AND subject_id IS NULL AND product_id IS NOT NULL;

      DELETE FROM source_chunks_fts;
      INSERT INTO source_chunks_fts (chunk_id, source_id, product_id, title, content)
      SELECT chunk.id, chunk.source_id, NULL, source.title, chunk.content
      FROM source_chunks chunk
      JOIN sources source ON source.id = chunk.source_id;
    `);
  }

  private ensureSourceColumns(): void {
    const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sources'").get();
    if (!table) return;
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(sources)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    const isLegacySourceTable = !columns.has("logical_key");
    if (isLegacySourceTable) this.db.exec("ALTER TABLE sources ADD COLUMN logical_key TEXT;");
    if (!columns.has("revision")) this.db.exec("ALTER TABLE sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;");
    if (!columns.has("superseded_by")) this.db.exec("ALTER TABLE sources ADD COLUMN superseded_by TEXT;");
    this.db.exec("UPDATE sources SET logical_key = COALESCE(logical_key, raw_path, origin_uri, id) WHERE logical_key IS NULL;");
    if (isLegacySourceTable) {
      // Before revisions existed, repeated ingests accumulated several active
      // sources for the same file/capture. Backfill once while adding the new
      // columns: the newest row stays active and every older row is retired.
      const rows = this.db
        .prepare(`
          SELECT id, logical_key AS logicalKey, status, created_at AS createdAt, updated_at AS updatedAt
          FROM sources
          ORDER BY logical_key, updated_at, created_at, id
        `)
        .all() as unknown as Array<{ id: string; logicalKey: string; status: string; createdAt: string; updatedAt: string }>;
      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        const group = groups.get(row.logicalKey) ?? [];
        group.push(row);
        groups.set(row.logicalKey, group);
      }
      const update = this.db.prepare("UPDATE sources SET revision = ?, status = ?, superseded_by = ? WHERE id = ?");
      this.transaction(() => {
        for (const group of groups.values()) {
          // A newer failed/incomplete legacy attempt must not displace the last
          // successfully indexed source.
          const active = [...group].reverse().find((row) => row.status === "indexed");
          group.forEach((row, index) => {
            const superseded = Boolean(active && row.id !== active.id && row.status === "indexed");
            update.run(
              index + 1,
              superseded ? "superseded" : row.status,
              superseded ? active?.id ?? null : null,
              row.id
            );
          });
        }
      });
    }
  }

  private ensureCaptureColumns(): void {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'captures'").all();
    if (tables.length === 0) {
      return;
    }
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(captures)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has("source_id")) {
      this.db.exec("ALTER TABLE captures ADD COLUMN source_id TEXT;");
    }
    if (!columns.has("curation_status")) {
      this.db.exec("ALTER TABLE captures ADD COLUMN curation_status TEXT NOT NULL DEFAULT 'pending';");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_captures_curation ON captures(curation_status);");
    }
    if (!columns.has("curated_at")) {
      this.db.exec("ALTER TABLE captures ADD COLUMN curated_at TEXT;");
    }
    if (!columns.has("curation_summary")) {
      this.db.exec("ALTER TABLE captures ADD COLUMN curation_summary TEXT;");
    }
    if (!columns.has("tags_json")) {
      this.db.exec("ALTER TABLE captures ADD COLUMN tags_json TEXT;");
    }
  }

  private ensureObservationIntegrityColumns(): void {
    const observations = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observations'").get();
    if (observations) {
      const columns = new Set(
        (this.db.prepare("PRAGMA table_info(observations)").all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has("measurement_json")) {
        this.db.exec("ALTER TABLE observations ADD COLUMN measurement_json TEXT;");
      }
      if (!columns.has("proposal_key")) {
        this.db.exec("ALTER TABLE observations ADD COLUMN proposal_key TEXT;");
      }
      const legacyMeasured = this.db.prepare(`
        SELECT id, review_note AS reviewNote, reviewed_at AS reviewedAt, updated_at AS updatedAt
        FROM observations WHERE evidence_status = 'measured'
      `).all() as unknown as Array<{ id: string; reviewNote?: string; reviewedAt?: string; updatedAt: string }>;
      const migrateMeasurement = this.db.prepare(`
        UPDATE observations SET evidence_status = 'standalone', measurement_json = ? WHERE id = ?
      `);
      for (const row of legacyMeasured) {
        migrateMeasurement.run(JSON.stringify({
          note: row.reviewNote?.trim() || "Migrated legacy measurement",
          measuredAt: row.reviewedAt ?? row.updatedAt
        }), row.id);
      }
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_package_proposal
          ON observations(package_id, proposal_key) WHERE proposal_key IS NOT NULL;
      `);
    }

    const evidence = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observation_evidence'").get();
    if (evidence) {
      // The old key omitted the chunk. Recreate it so two exact citations in
      // distinct chunks remain distinct while retries of one citation dedupe.
      const currentIndex = this.db.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_observation_evidence_dedupe'
      `).get() as { sql?: string } | undefined;
      if (!currentIndex?.sql?.includes("COALESCE(source_chunk_id")) {
        this.db.exec(`
          DROP INDEX IF EXISTS idx_observation_evidence_dedupe;
          CREATE UNIQUE INDEX idx_observation_evidence_dedupe
            ON observation_evidence(observation_id, source_id, COALESCE(source_chunk_id, ''), excerpt, stance);
        `);
      }
    }
  }

  private ensureWikiSynthesisColumns(): void {
    const packages = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'curation_packages'").get();
    if (!packages) return;
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(curation_packages)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has("wiki_target_json")) {
      this.db.exec("ALTER TABLE curation_packages ADD COLUMN wiki_target_json TEXT;");
    }
    if (!columns.has("wiki_synthesis_key")) {
      this.db.exec("ALTER TABLE curation_packages ADD COLUMN wiki_synthesis_key TEXT;");
    }
    // Legacy suggestions had no durable target and cannot be published safely.
    // Keep observations intact but reset the optional documentation decision so
    // a human can select and validate an explicit target after migration.
    this.db.exec(`
      UPDATE curation_packages
      SET wiki_decision = 'not_needed', wiki_reason = NULL, wiki_evidence_json = '[]',
          wiki_target_json = NULL, wiki_synthesis_key = NULL
      WHERE wiki_decision = 'suggested'
        AND (wiki_target_json IS NULL OR wiki_synthesis_key IS NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_packages_wiki_synthesis
        ON curation_packages(wiki_synthesis_key) WHERE wiki_synthesis_key IS NOT NULL;
    `);
  }

  private ensureInboxContextReferenceIndex(): void {
    const migration = this.db.prepare(`
      SELECT id FROM schema_migrations WHERE id = '009_inbox_context_refs'
    `).get();
    if (migration) return;

    // Rebuild rather than append so an interrupted/manual partial projection is
    // repaired deterministically. migrate() holds the immediate migration lock.
    this.db.prepare("DELETE FROM inbox_context_refs").run();
    const rows = this.db.prepare(`
      SELECT id, payload_json AS payloadJson FROM memory_inbox ORDER BY id
    `).all() as unknown as Array<{ id: string; payloadJson: string }>;
    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(row.payloadJson) as unknown;
        payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      } catch {
        // Keep malformed legacy rows queryable through their top-level product
        // or source. Payload hydration already reports invalid JSON separately.
        payload = {};
      }
      this.replaceInboxContextReferences(row.id, payload);
    }
  }

  private replaceInboxContextReferences(inboxId: string, payload: Record<string, unknown>): void {
    this.db.prepare("DELETE FROM inbox_context_refs WHERE inbox_id = ?").run(inboxId);
    const insert = this.db.prepare(`
      INSERT INTO inbox_context_refs (inbox_id, ref_kind, ref_value)
      VALUES (?, ?, ?)
    `);
    for (const reference of inboxContextReferenceRows(payload)) {
      insert.run(inboxId, reference.kind, reference.value);
    }
  }

  private ensureContextPackColumns(): void {
    const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'context_packs'").get();
    if (!table) return;
    const existingColumns = new Set(
      (this.db.prepare("PRAGMA table_info(context_packs)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    const uniqueIndex = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_context_packs_scope_version_unique'
    `).get();
    // Every CLI command opens and migrates its runtime. Once migration 007 is
    // complete, keep that hot path read-only: do not take the SQLite writer
    // lock or rescan the full Context Pack history.
    if (existingColumns.has("version_scope") && existingColumns.has("entry_count") && uniqueIndex) return;
    this.runInImmediateTransaction(() => {
      const columns = existingColumns;
      const addedVersionScope = !columns.has("version_scope");
      const addedEntryCount = !columns.has("entry_count");
      if (addedVersionScope) {
        this.db.exec("ALTER TABLE context_packs ADD COLUMN version_scope TEXT NOT NULL DEFAULT 'global';");
        this.db.exec(`
          UPDATE context_packs
          SET version_scope = CASE WHEN view_id IS NULL THEN 'global' ELSE 'view:' || view_id END;
        `);
      }
      if (addedEntryCount) {
        this.db.exec("ALTER TABLE context_packs ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0;");
        const rows = this.db
          .prepare("SELECT id, entries_json AS entriesJson FROM context_packs")
          .all() as unknown as Array<{ id: string; entriesJson: string }>;
        const updateEntryCount = this.db.prepare("UPDATE context_packs SET entry_count = ? WHERE id = ?");
        for (const row of rows) {
          let count = 0;
          try {
            const entries = JSON.parse(row.entriesJson);
            count = Array.isArray(entries) ? entries.length : 0;
          } catch {
            // A malformed legacy payload remains readable through summary APIs.
          }
          updateEntryCount.run(count, row.id);
        }
      }

      // A legacy caller could allocate the same version concurrently. Repair
      // duplicates deterministically before enforcing the new invariant.
      const rows = this.db
        .prepare(`
          SELECT id, version_scope AS versionScope, version, created_at AS createdAt
          FROM context_packs
          ORDER BY version_scope, version, created_at, id
        `)
        .all() as unknown as Array<{ id: string; versionScope: string; version: number; createdAt: string }>;
      const maximumByScope = new Map<string, number>();
      for (const row of rows) {
        maximumByScope.set(row.versionScope, Math.max(maximumByScope.get(row.versionScope) ?? 0, row.version));
      }
      const seen = new Set<string>();
      const updateVersion = this.db.prepare("UPDATE context_packs SET version = ? WHERE id = ?");
      for (const row of rows) {
        const key = JSON.stringify([row.versionScope, row.version]);
        if (!seen.has(key)) {
          seen.add(key);
          continue;
        }
        const version = (maximumByScope.get(row.versionScope) ?? 0) + 1;
        maximumByScope.set(row.versionScope, version);
        updateVersion.run(version, row.id);
      }
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_context_packs_scope_version_unique
          ON context_packs(version_scope, version);
      `);
    });
  }

  private ensureTaskTrackingColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "tracking_json")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN tracking_json TEXT;");
    }
  }

  private ensureTaskTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'medium',
        assignee TEXT NOT NULL DEFAULT 'me',
        deadline TEXT,
        notes TEXT,
        product_id TEXT,
        source_id TEXT,
        origin TEXT NOT NULL DEFAULT 'manual',
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_product ON tasks(product_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
    `);
  }

  private ensureTaskMetadataColumns(): void {
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(task_metadata)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has("title")) {
      this.db.exec("ALTER TABLE task_metadata ADD COLUMN title TEXT;");
    }
    if (!columns.has("body")) {
      this.db.exec("ALTER TABLE task_metadata ADD COLUMN body TEXT;");
    }
  }

  private ensureTaskLinkTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_links (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        label TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_kind, target_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_links_dedupe ON task_links(task_id, relation_type, target_kind, target_id);
    `);
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(task_links)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has("metadata_json")) {
      this.db.exec("ALTER TABLE task_links ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';");
    }
  }

  private ensureImpactTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kpi_measurements (
        id TEXT PRIMARY KEY,
        kpi_id TEXT NOT NULL,
        value REAL NOT NULL,
        measured_at TEXT NOT NULL,
        source_id TEXT,
        observation_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES sources(id),
        FOREIGN KEY (observation_id) REFERENCES observations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_kpi_measurements_kpi_date
        ON kpi_measurements(kpi_id, measured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_kpi_measurements_source ON kpi_measurements(source_id);
      CREATE INDEX IF NOT EXISTS idx_kpi_measurements_observation ON kpi_measurements(observation_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_measurements_dedupe
        ON kpi_measurements(kpi_id, measured_at, COALESCE(source_id, ''), COALESCE(observation_id, ''));
    `);
  }

  private ensureUiStateTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ui_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ui_state_updated ON ui_state(updated_at);
    `);
  }
}

function normalizeTaskMetadata(row: TaskMetadataRecord): TaskMetadataRecord {
  return {
    taskId: row.taskId,
    title: row.title ?? undefined,
    body: row.body ?? undefined,
    status: row.status ?? undefined,
    priority: row.priority ?? undefined,
    assignee: row.assignee ?? undefined,
    deadline: row.deadline ?? undefined,
    notes: row.notes ?? undefined,
    updatedAt: row.updatedAt
  };
}

function normalizeTaskRecord(row: TaskRecord): TaskRecord {
  return {
    tracking: parseJsonObject((row as TaskRecord & { trackingJson?: string }).trackingJson ?? null) as TaskTracking | undefined,
    id: row.id,
    title: row.title,
    body: row.body ?? undefined,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee,
    deadline: row.deadline ?? undefined,
    notes: row.notes ?? undefined,
    productId: row.productId ?? undefined,
    sourceId: row.sourceId ?? undefined,
    origin: row.origin,
    archivedAt: row.archivedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeTaskLink(row: TaskLinkRecord): TaskLinkRecord {
  const metadataJson = (row as TaskLinkRecord & { metadataJson?: string }).metadataJson;
  return {
    id: row.id,
    taskId: row.taskId,
    relationType: row.relationType,
    targetKind: row.targetKind,
    targetId: row.targetId,
    label: row.label ?? undefined,
    metadata: row.metadata ?? parseJsonObject(metadataJson ?? null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeKpiMeasurement(row: KpiMeasurementRecord): KpiMeasurementRecord {
  return {
    id: row.id,
    kpiId: row.kpiId,
    value: Number(row.value),
    measuredAt: row.measuredAt,
    sourceId: row.sourceId ?? undefined,
    observationId: row.observationId ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeOptional(value: string | null | undefined, fallback: string | undefined): string | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none" || trimmed === "clear") {
    return undefined;
  }
  return trimmed;
}

function rowToInboxItem(row: InboxItem & { payloadJson: string }): InboxItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    status: row.status,
    sourceId: row.sourceId ?? undefined,
    productId: row.productId ?? undefined,
    payload: JSON.parse(row.payloadJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

const OBSERVATION_SELECT = `
  SELECT id, package_id AS packageId, kind, title, body, excerpt,
         source_id AS sourceId, source_chunk_id AS sourceChunkId,
         capture_id AS captureId, product_id AS productId,
         subject_kind AS subjectKind, subject_id AS subjectId,
         validation_status AS validationStatus, evidence_status AS evidenceStatus,
         measurement_json AS measurementJson, proposal_key AS proposalKey,
         confidence, fingerprint, polarity, review_note AS reviewNote,
         reviewed_at AS reviewedAt, metadata_json AS metadataJson,
         created_at AS createdAt, updated_at AS updatedAt
  FROM observations
`;

interface ObservationRow extends Omit<ObservationRecord, "metadata" | "measurement" | "evidenceStatus"> {
  metadataJson: string;
  measurementJson?: string;
  /** Legacy databases may still expose the pre-006 overloaded value. */
  evidenceStatus: ObservationRecord["evidenceStatus"] | "measured";
}

function rowToObservation(row: ObservationRow): ObservationRecord {
  return {
    id: row.id,
    packageId: row.packageId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    excerpt: row.excerpt,
    sourceId: row.sourceId,
    sourceChunkId: row.sourceChunkId ?? undefined,
    captureId: row.captureId ?? undefined,
    productId: row.productId ?? undefined,
    subjectKind: row.subjectKind ?? undefined,
    subjectId: row.subjectId ?? undefined,
    validationStatus: row.validationStatus,
    // Databases opened without running migrate() can still contain the legacy
    // overloaded value. Surface it safely as standalone + measured dimension.
    evidenceStatus: row.evidenceStatus === "measured" ? "standalone" : row.evidenceStatus,
    measurement: row.measurementJson
      ? JSON.parse(row.measurementJson)
      : row.evidenceStatus === "measured"
        ? { note: "Legacy measurement", measuredAt: row.reviewedAt ?? row.updatedAt }
        : undefined,
    proposalKey: row.proposalKey ?? undefined,
    confidence: row.confidence,
    fingerprint: row.fingerprint,
    polarity: Number(row.polarity) < 0 ? -1 : Number(row.polarity) > 0 ? 1 : 0,
    reviewNote: row.reviewNote ?? undefined,
    reviewedAt: row.reviewedAt ?? undefined,
    metadata: JSON.parse(row.metadataJson || "{}") as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

interface CurationPackageRow extends Omit<CurationPackageRecord, "wikiEvidenceObservationIds" | "wikiTarget"> {
  wikiEvidenceJson: string;
  wikiTargetJson?: string;
}

function normalizeCurationPackage(row: CurationPackageRow): CurationPackageRecord {
  const { wikiEvidenceJson, ...record } = row;
  return {
    ...record,
    captureId: row.captureId ?? undefined,
    productId: row.productId ?? undefined,
    summary: row.summary ?? undefined,
    wikiReason: row.wikiReason ?? undefined,
    wikiEvidenceObservationIds: JSON.parse(wikiEvidenceJson || "[]") as string[],
    wikiTarget: row.wikiTargetJson ? JSON.parse(row.wikiTargetJson) : undefined,
    wikiSynthesisKey: row.wikiSynthesisKey ?? undefined,
    reviewedAt: row.reviewedAt ?? undefined
  };
}

function normalizeObservationEvidence(row: ObservationEvidenceRecord): ObservationEvidenceRecord {
  return {
    ...row,
    sourceChunkId: row.sourceChunkId ?? undefined,
    captureId: row.captureId ?? undefined
  };
}

function normalizeObservationRelation(row: ObservationRelationRecord): ObservationRelationRecord {
  return { ...row, reason: row.reason ?? undefined, reviewedAt: row.reviewedAt ?? undefined };
}

function contextPackVersionScope(viewId?: string): string {
  return viewId === undefined ? "global" : `view:${viewId}`;
}

function normalizeContextPackRetentionPolicy(
  policy: Partial<ContextPackRetentionPolicy> | undefined
): ContextPackRetentionPolicy {
  const positiveInteger = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) && Number(value) >= 1 ? Math.floor(Number(value)) : fallback;
  const nonNegativeInteger = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback;
  const maxPacksPerView = positiveInteger(policy?.maxPacksPerView, DEFAULT_CONTEXT_PACK_RETENTION_POLICY.maxPacksPerView);
  return {
    maxPacksPerView,
    maxPacksPerSession: positiveInteger(
      policy?.maxPacksPerSession,
      DEFAULT_CONTEXT_PACK_RETENTION_POLICY.maxPacksPerSession
    ),
    maxAgeDays: nonNegativeInteger(policy?.maxAgeDays, DEFAULT_CONTEXT_PACK_RETENTION_POLICY.maxAgeDays),
    preserveLatestPerView: Math.min(
      maxPacksPerView,
      positiveInteger(policy?.preserveLatestPerView, DEFAULT_CONTEXT_PACK_RETENTION_POLICY.preserveLatestPerView)
    )
  };
}

function groupContextPackRetentionRows<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

interface ContextPackRetentionRow {
  id: string;
  versionScope: string;
  sessionId: string | null;
  version: number;
  createdAt: string;
}

interface ContextPackRow {
  id: string;
  version: number;
  version_scope: string;
  view_id: string | null;
  view_version: number | null;
  session_id: string | null;
  request_text: string;
  scope_json: string;
  resolved_entities_json: string;
  entries_json: string;
  entry_count: number;
  exclusions_json: string;
  provenance_json: string;
  estimated_tokens: number;
  actual_tokens: number;
  budget: number;
  truncated: number;
  created_at: string;
}

type ContextPackSummaryRow = Pick<
  ContextPackRow,
  | "id"
  | "version"
  | "view_id"
  | "view_version"
  | "session_id"
  | "request_text"
  | "scope_json"
  | "entry_count"
  | "provenance_json"
  | "estimated_tokens"
  | "actual_tokens"
  | "budget"
  | "truncated"
  | "created_at"
>;

function rowToContextPack(row: ContextPackRow): ContextPack {
  return {
    id: row.id,
    version: row.version,
    viewId: row.view_id ?? undefined,
    viewVersion: row.view_version ?? undefined,
    sessionId: row.session_id ?? undefined,
    request: row.request_text,
    scope: JSON.parse(row.scope_json) as ContextPack["scope"],
    resolvedEntities: JSON.parse(row.resolved_entities_json) as ContextPack["resolvedEntities"],
    entries: JSON.parse(row.entries_json) as ContextPack["entries"],
    exclusions: JSON.parse(row.exclusions_json) as ContextPack["exclusions"],
    provenance: JSON.parse(row.provenance_json) as ContextPack["provenance"],
    estimatedTokens: row.estimated_tokens,
    actualTokens: row.actual_tokens,
    budget: row.budget,
    truncated: Boolean(row.truncated),
    createdAt: row.created_at
  };
}

function rowToContextPackSummary(row: ContextPackSummaryRow): ContextPackSummary {
  return {
    id: row.id,
    version: row.version,
    viewId: row.view_id ?? undefined,
    viewVersion: row.view_version ?? undefined,
    sessionId: row.session_id ?? undefined,
    request: row.request_text,
    scope: JSON.parse(row.scope_json) as ContextPackSummary["scope"],
    entryCount: row.entry_count,
    provenance: JSON.parse(row.provenance_json) as ContextPackSummary["provenance"],
    estimatedTokens: row.estimated_tokens,
    actualTokens: row.actual_tokens,
    budget: row.budget,
    truncated: Boolean(row.truncated),
    createdAt: row.created_at
  };
}

interface EntityRow {
  id: string;
  kind: string;
  label: string;
  description: string | null;
  aliases_json: string | null;
  status: string;
  parent_id: string | null;
  owner_ids_json: string | null;
  contributor_ids_json: string | null;
  tags_json: string | null;
  focus_level: string | null;
  metadata_json: string | null;
  repo_path: string | null;
  wiki_root: string | null;
  created_at: string;
  updated_at: string;
}

interface EntityRelationRow {
  id: string;
  source_kind: string;
  source_id: string;
  target_kind: string;
  target_id: string;
  relation_type: string;
  description: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface CaptureRow {
  id: string;
  path: string | null;
  title: string;
  content_type: string;
  status: string;
  primary_entity_kind: string;
  primary_entity_id: string;
  source_kind: string;
  source_origin: string;
  ingestion_status: string;
  curation_status: string | null;
  curated_at: string | null;
  curation_summary: string | null;
  tags_json: string | null;
  content_hash: string | null;
  source_id: string | null;
  last_ingested_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    kind: row.kind as EntityRecord["kind"],
    label: row.label,
    description: row.description ?? undefined,
    aliases: parseJsonArray(row.aliases_json),
    status: row.status as EntityRecord["status"],
    parentId: row.parent_id ?? undefined,
    ownerIds: parseJsonArray(row.owner_ids_json),
    contributorIds: parseJsonArray(row.contributor_ids_json),
    tags: parseJsonArray(row.tags_json),
    focusLevel: row.focus_level ? row.focus_level as EntityRecord["focusLevel"] : undefined,
    metadata: parseJsonObject(row.metadata_json),
    repoPath: row.repo_path ?? undefined,
    wikiRoot: row.wiki_root ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToEntityRelation(row: EntityRelationRow): EntityRelationRecord {
  return {
    id: row.id,
    sourceKind: row.source_kind as EntityKind,
    sourceId: row.source_id,
    targetKind: row.target_kind as EntityKind,
    targetId: row.target_id,
    relationType: row.relation_type,
    description: row.description ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToCapture(row: CaptureRow, relatedEntities: CaptureEntityRef[]): CaptureRecord {
  return {
    id: row.id,
    path: row.path ?? undefined,
    title: row.title,
    contentType: row.content_type as CaptureRecord["contentType"],
    status: row.status as CaptureRecord["status"],
    primaryEntityKind: row.primary_entity_kind as EntityKind,
    primaryEntityId: row.primary_entity_id,
    relatedEntities,
    sourceKind: row.source_kind as CaptureRecord["sourceKind"],
    sourceOrigin: row.source_origin as CaptureRecord["sourceOrigin"],
    ingestionStatus: row.ingestion_status as CaptureRecord["ingestionStatus"],
    curationStatus: (row.curation_status ?? "pending") as CaptureRecord["curationStatus"],
    curatedAt: row.curated_at ?? undefined,
    curationSummary: row.curation_summary ?? undefined,
    tags: parseJsonArray(row.tags_json),
    contentHash: row.content_hash ?? undefined,
    sourceId: row.source_id ?? undefined,
    lastIngestedAt: row.last_ingested_at ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Returns input when provided (null clears the field), else keeps the existing value. */
function pick<T>(input: T | null | undefined, existing: T | undefined): T | undefined {
  if (input === undefined) {
    return existing;
  }
  return input === null ? undefined : input;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value) && value.length === 0) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJsonArray(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : undefined;
}

function parseJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
}

export function openWorkMemoryDatabase(config: WorkMemoryConfig): WorkMemoryDatabase {
  const database = new WorkMemoryDatabase(config.storage.databasePath);
  database.migrate();
  database.syncConfig(config);
  return database;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueEntityRefs(values: EntityRef[]): EntityRef[] {
  return [...new Map(values.map((value) => [
    `${resolveEntityKind(value.kind)}\u0000${value.id}`,
    { kind: resolveEntityKind(value.kind), id: value.id }
  ])).values()];
}

function uniqueEntityRefStrings(values: EntityRef[]): string[] {
  return uniqueEntityRefs(values).map((value) => `${value.kind}:${value.id}`);
}

function normalizeSourceEntityRefs(values: EntityRef[] | string[]): EntityRef[] {
  return uniqueEntityRefs(values.map((value) =>
    typeof value === "string" ? { kind: "product", id: value } : value
  ));
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isFtsUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (?:table|module):?\s*(?:main\.)?entities_fts|no such module:\s*fts5/i.test(message);
}

function toFtsQuery(query: string, maxTerms = 64): string {
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    // FTS5 treats '-' as an operator. Keeping a slug such as
    // oneff-settings-governance as one unquoted token makes SQLite parse
    // `settings` as a column name and fail with "no such column: settings".
    // Split punctuation first and quote every prefix term so entity ids and
    // human search text share one safe query path.
    .match(/[\p{L}\p{N}_]+/gu)
    ?.slice(0, Math.max(1, maxTerms));

  if (!terms || terms.length === 0) {
    return "";
  }

  return terms.map((term) => `"${term}"*`).join(" OR ");
}

function createSnippet(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}
