export const INITIAL_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  role TEXT NOT NULL,
  path TEXT NOT NULL,
  git_remote TEXT,
  wiki_root TEXT,
  specs_root TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS product_links (
  id TEXT PRIMARY KEY,
  from_product_id TEXT NOT NULL,
  to_product_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  description TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  logical_key TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  origin TEXT NOT NULL,
  origin_uri TEXT,
  raw_path TEXT,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_date TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'indexed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Durable external document identity is separate from immutable source revisions.
CREATE TABLE IF NOT EXISTS repository_documents (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_id TEXT,
  availability TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id),
  UNIQUE(repository_id, relative_path)
);
CREATE TABLE IF NOT EXISTS repository_source_provenance (
  source_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  branch TEXT,
  commit_hash TEXT,
  content_state TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES repository_documents(id)
);
CREATE INDEX IF NOT EXISTS idx_repository_provenance_document ON repository_source_provenance(document_id);
CREATE TABLE IF NOT EXISTS repository_index_state (
  repository_id TEXT PRIMARY KEY,
  reference_branch TEXT,
  roots_json TEXT NOT NULL DEFAULT '{}',
  last_successful_at TEXT,
  successful_commit TEXT,
  last_attempt_at TEXT NOT NULL,
  last_attempt_status TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sources_logical_revision ON sources(logical_key, revision);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);

CREATE TABLE IF NOT EXISTS source_products (
  source_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (source_id, product_id)
);

-- Canonical source scope. Product is only one possible entity kind; new
-- ingestion paths never need a parallel product registry identity.
CREATE TABLE IF NOT EXISTS source_entities (
  source_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'about',
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (source_id, entity_kind, entity_id, relation_type),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS idx_source_entities_entity
  ON source_entities(entity_kind, entity_id, source_id);

CREATE TABLE IF NOT EXISTS source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (id, source_id),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  source_id UNINDEXED,
  -- Legacy column retained in the FTS shape for in-place upgrades. Generic
  -- entity filtering is performed through source_entities.
  product_id UNINDEXED,
  title,
  content
);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  concept_type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concept_mentions (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_id TEXT,
  quote TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_relations (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  source_id TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_inbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  source_id TEXT,
  product_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Materialized payload dimensions keep context resolution index-backed. The
-- payload remains canonical; application writes and migration 009 rebuild this
-- projection atomically whenever it changes.
CREATE TABLE IF NOT EXISTS inbox_context_refs (
  inbox_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL CHECK (ref_kind IN ('product', 'source', 'capture', 'entity', 'observation', 'relation')),
  ref_value TEXT NOT NULL,
  PRIMARY KEY (inbox_id, ref_kind, ref_value),
  FOREIGN KEY (inbox_id) REFERENCES memory_inbox(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS curation_packages (
  id TEXT PRIMARY KEY,
  capture_id TEXT,
  source_id TEXT NOT NULL,
  product_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'partially_accepted', 'accepted', 'rejected', 'superseded')),
  wiki_decision TEXT NOT NULL DEFAULT 'not_needed' CHECK (wiki_decision IN ('not_needed', 'suggested')),
  wiki_reason TEXT,
  wiki_evidence_json TEXT NOT NULL DEFAULT '[]',
  wiki_target_json TEXT,
  wiki_synthesis_key TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (wiki_decision = 'not_needed' OR (
    wiki_reason IS NOT NULL AND length(trim(wiki_reason)) > 0 AND
    wiki_target_json IS NOT NULL AND wiki_synthesis_key IS NOT NULL
  )),
  UNIQUE (source_id),
  UNIQUE (id, source_id),
  FOREIGN KEY (capture_id) REFERENCES captures(id),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('claim', 'decision', 'question', 'task', 'risk', 'feature_request', 'insight', 'metric', 'relationship')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_chunk_id TEXT,
  capture_id TEXT,
  product_id TEXT,
  subject_kind TEXT,
  subject_id TEXT,
  validation_status TEXT NOT NULL DEFAULT 'proposed' CHECK (validation_status IN ('captured', 'proposed', 'accepted', 'rejected', 'superseded')),
  evidence_status TEXT NOT NULL DEFAULT 'standalone' CHECK (evidence_status IN ('standalone', 'corroborated', 'contradicted')),
  measurement_json TEXT,
  proposal_key TEXT,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  fingerprint TEXT NOT NULL,
  polarity INTEGER NOT NULL DEFAULT 0 CHECK (polarity IN (-1, 0, 1)),
  review_note TEXT,
  reviewed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(excerpt)) > 0),
  FOREIGN KEY (package_id) REFERENCES curation_packages(id),
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (capture_id) REFERENCES captures(id),
  FOREIGN KEY (package_id, source_id) REFERENCES curation_packages(id, source_id),
  FOREIGN KEY (source_chunk_id, source_id) REFERENCES source_chunks(id, source_id)
);

-- Observations are a distinct retrieval plane: unlike raw source chunks they
-- carry review status, evidence maturity and an optional entity anchor. The
-- external-content index keeps the canonical row in observations while
-- making accepted knowledge, weak signals and history independently searchable.
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title,
  body,
  excerpt,
  kind,
  subject_kind,
  subject_id,
  content='observations',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, body, excerpt, kind, subject_kind, subject_id)
  VALUES (new.rowid, new.title, new.body, new.excerpt, new.kind, new.subject_kind, new.subject_id);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, body, excerpt, kind, subject_kind, subject_id)
  VALUES ('delete', old.rowid, old.title, old.body, old.excerpt, old.kind, old.subject_kind, old.subject_id);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_update AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, body, excerpt, kind, subject_kind, subject_id)
  VALUES ('delete', old.rowid, old.title, old.body, old.excerpt, old.kind, old.subject_kind, old.subject_id);
  INSERT INTO observations_fts(rowid, title, body, excerpt, kind, subject_kind, subject_id)
  VALUES (new.rowid, new.title, new.body, new.excerpt, new.kind, new.subject_kind, new.subject_id);
END;

CREATE TABLE IF NOT EXISTS observation_evidence (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_chunk_id TEXT,
  capture_id TEXT,
  excerpt TEXT NOT NULL,
  stance TEXT NOT NULL DEFAULT 'neutral' CHECK (stance IN ('supports', 'contradicts', 'neutral')),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  CHECK (length(trim(excerpt)) > 0),
  FOREIGN KEY (observation_id) REFERENCES observations(id),
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (capture_id) REFERENCES captures(id),
  FOREIGN KEY (source_chunk_id, source_id) REFERENCES source_chunks(id, source_id)
);

CREATE TABLE IF NOT EXISTS observation_relations (
  id TEXT PRIMARY KEY,
  source_observation_id TEXT NOT NULL,
  target_observation_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('supports', 'contradicts', 'supersedes', 'duplicates')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected')),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  reason TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (source_observation_id <> target_observation_id),
  FOREIGN KEY (source_observation_id) REFERENCES observations(id),
  FOREIGN KEY (target_observation_id) REFERENCES observations(id)
);

CREATE TABLE IF NOT EXISTS observation_events (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'edited', 'accepted', 'rejected', 'reclassified', 'merged', 'superseded', 'evidence_changed')),
  actor TEXT NOT NULL CHECK (actor IN ('agent', 'human', 'system')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observations(id)
);

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

CREATE TABLE IF NOT EXISTS task_metadata (
  task_id TEXT PRIMARY KEY,
  title TEXT,
  body TEXT,
  status TEXT,
  priority TEXT,
  assignee TEXT,
  deadline TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

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

-- KPI values are time-series facts, not graph nodes. The KPI itself remains a
-- normal KPI entity and can be linked to an OKR with measured_by.
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

CREATE TABLE IF NOT EXISTS ui_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  visual_state_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  refresh_policy TEXT NOT NULL DEFAULT 'monitored',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_packs (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  version_scope TEXT NOT NULL DEFAULT 'global',
  view_id TEXT,
  view_version INTEGER,
  session_id TEXT,
  request_text TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  resolved_entities_json TEXT NOT NULL,
  entries_json TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  exclusions_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  actual_tokens INTEGER NOT NULL,
  budget INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (view_id) REFERENCES context_views(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  aliases_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  parent_id TEXT,
  owner_ids_json TEXT,
  contributor_ids_json TEXT,
  tags_json TEXT,
  focus_level TEXT,
  metadata_json TEXT,
  repo_path TEXT,
  wiki_root TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

-- External-content FTS projection for bounded Context discovery. Keeping the
-- canonical entity row in the entities table avoids duplicating hydrated metadata.
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  kind UNINDEXED,
  id,
  label,
  description,
  aliases_json,
  tags_json,
  content='entities',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, kind, id, label, description, aliases_json, tags_json)
  VALUES (new.rowid, new.kind, new.id, new.label, new.description, new.aliases_json, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, kind, id, label, description, aliases_json, tags_json)
  VALUES ('delete', old.rowid, old.kind, old.id, old.label, old.description, old.aliases_json, old.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, kind, id, label, description, aliases_json, tags_json)
  VALUES ('delete', old.rowid, old.kind, old.id, old.label, old.description, old.aliases_json, old.tags_json);
  INSERT INTO entities_fts(rowid, kind, id, label, description, aliases_json, tags_json)
  VALUES (new.rowid, new.kind, new.id, new.label, new.description, new.aliases_json, new.tags_json);
END;

CREATE INDEX IF NOT EXISTS idx_entities_label_nocase ON entities(label COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS entity_relations (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  description TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  path TEXT,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'captured',
  primary_entity_kind TEXT NOT NULL DEFAULT 'oneagent',
  primary_entity_id TEXT NOT NULL DEFAULT 'oneagent',
  source_kind TEXT NOT NULL,
  source_origin TEXT NOT NULL,
  ingestion_status TEXT NOT NULL DEFAULT 'not_ingested',
  curation_status TEXT NOT NULL DEFAULT 'pending',
  curated_at TEXT,
  curation_summary TEXT,
  tags_json TEXT,
  content_hash TEXT,
  source_id TEXT,
  last_ingested_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_entities (
  capture_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  PRIMARY KEY (capture_id, entity_kind, entity_id, relation_type),
  FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
CREATE INDEX IF NOT EXISTS idx_entity_relations_source ON entity_relations(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_target ON entity_relations(target_kind, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_relations_dedupe
  ON entity_relations(source_kind, source_id, target_kind, target_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_captures_primary ON captures(primary_entity_kind, primary_entity_id);
CREATE INDEX IF NOT EXISTS idx_captures_content_type ON captures(content_type);
CREATE INDEX IF NOT EXISTS idx_captures_ingestion ON captures(ingestion_status);
CREATE INDEX IF NOT EXISTS idx_captures_curation ON captures(curation_status);
CREATE INDEX IF NOT EXISTS idx_capture_entities_entity ON capture_entities(entity_kind, entity_id);

CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(content_hash);
CREATE INDEX IF NOT EXISTS idx_source_products_product ON source_products(product_id);
CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON source_chunks(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_chunks_id_source ON source_chunks(id, source_id);
CREATE INDEX IF NOT EXISTS idx_inbox_status ON memory_inbox(status);
CREATE INDEX IF NOT EXISTS idx_inbox_product ON memory_inbox(product_id);
CREATE INDEX IF NOT EXISTS idx_inbox_source ON memory_inbox(source_id);
CREATE INDEX IF NOT EXISTS idx_inbox_context_refs_lookup ON inbox_context_refs(ref_kind, ref_value, inbox_id);
CREATE INDEX IF NOT EXISTS idx_curation_packages_status ON curation_packages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_curation_packages_wiki_decision ON curation_packages(wiki_decision, created_at);
CREATE INDEX IF NOT EXISTS idx_curation_packages_source ON curation_packages(source_id, created_at);
CREATE INDEX IF NOT EXISTS idx_curation_packages_capture ON curation_packages(capture_id, created_at);
CREATE INDEX IF NOT EXISTS idx_curation_packages_product ON curation_packages(product_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_packages_source_unique ON curation_packages(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_packages_id_source ON curation_packages(id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_packages_wiki_synthesis
  ON curation_packages(wiki_synthesis_key) WHERE wiki_synthesis_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_package ON observations(package_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_observations_capture ON observations(capture_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_observations_product ON observations(product_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_observations_subject ON observations(subject_kind, subject_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_observations_fingerprint ON observations(fingerprint, polarity, validation_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_package_proposal
  ON observations(package_id, proposal_key) WHERE proposal_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observation_evidence_observation ON observation_evidence(observation_id);
CREATE INDEX IF NOT EXISTS idx_observation_evidence_source ON observation_evidence(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_observation_evidence_dedupe
  ON observation_evidence(observation_id, source_id, COALESCE(source_chunk_id, ''), excerpt, stance);
CREATE UNIQUE INDEX IF NOT EXISTS idx_observation_relations_dedupe
  ON observation_relations(source_observation_id, target_observation_id, type);
CREATE INDEX IF NOT EXISTS idx_observation_events_observation ON observation_events(observation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_product ON tasks(product_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_task_metadata_deadline ON task_metadata(deadline);
CREATE INDEX IF NOT EXISTS idx_task_metadata_assignee ON task_metadata(assignee);
CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_kind, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_links_dedupe ON task_links(task_id, relation_type, target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_kpi_date ON kpi_measurements(kpi_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_source ON kpi_measurements(source_id);
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_observation ON kpi_measurements(observation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_measurements_dedupe
  ON kpi_measurements(kpi_id, measured_at, COALESCE(source_id, ''), COALESCE(observation_id, ''));
CREATE INDEX IF NOT EXISTS idx_ui_state_updated ON ui_state(updated_at);
CREATE INDEX IF NOT EXISTS idx_context_views_updated ON context_views(updated_at);
CREATE INDEX IF NOT EXISTS idx_context_packs_view_version ON context_packs(view_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_context_packs_scope_version_unique ON context_packs(version_scope, version);
CREATE INDEX IF NOT EXISTS idx_context_packs_session ON context_packs(session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_dedupe ON memory_inbox(type, title, body, source_id, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_concepts_name_type ON concepts(canonical_name, concept_type);
CREATE INDEX IF NOT EXISTS idx_concept_mentions_concept ON concept_mentions(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_mentions_source ON concept_mentions(source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_relations_dedupe ON graph_relations(subject, predicate, object, source_id);
`;
