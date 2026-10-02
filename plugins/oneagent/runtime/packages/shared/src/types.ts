import type {
  CaptureSourceKind,
  CaptureSourceOrigin,
  CaptureStatus,
  ContentType,
  CurationStatus,
  EntityFocusLevel,
  EntityRef,
  EntityKind,
  EntityStatus,
  IngestionStatus,
  WorkspaceTaxonomy
} from "./taxonomy.ts";
import type { AgentContextScopeMode } from "./context-scope.ts";

export type RepositoryRole = "specs" | "code" | "docs" | "lib" | "external-context" | string;

export type SourceType =
  | "meeting_transcript"
  | "meeting_summary"
  | "raw_user_input"
  | "product_spec"
  | "api_contract"
  | "architecture_doc"
  | "flow_doc"
  | "external_doc"
  | "bmad_artifact"
  | "code_reference"
  | "wiki_page"
  | "decision_note"
  | "markdown"
  | "plain_text";

export type InboxItemType = "wiki_proposal" | "graph_change_proposal" | "decision_candidate" | "open_question" | "task" | "risk";

export type InboxStatus = "pending" | "accepted" | "rejected" | "superseded";

export type ObservationKind =
  | "claim"
  | "decision"
  | "question"
  | "task"
  | "risk"
  | "feature_request"
  | "insight"
  | "metric"
  | "relationship";

export type ObservationValidationStatus = "captured" | "proposed" | "accepted" | "rejected" | "superseded";
export type ObservationEvidenceStatus = "standalone" | "corroborated" | "contradicted";

export type ObservationEvidenceStance = "supports" | "contradicts" | "neutral";
export type ObservationRelationType = "supports" | "contradicts" | "supersedes" | "duplicates";
export type CurationPackageStatus = "pending" | "in_review" | "partially_accepted" | "accepted" | "rejected" | "superseded";

/**
 * Measurement is independent from corroboration/contradiction. Keeping it as a
 * structured dimension prevents a measured claim from hiding later conflicting
 * evidence while preserving the human note that justified the measurement.
 */
export interface ObservationMeasurement {
  note: string;
  measuredAt: string;
}

export type ScopeMode =
  | "current-product"
  | "current-product-plus-direct-dependencies"
  | "manual-selection"
  | "portfolio";

export interface ProductConfig {
  id: string;
  label: string;
  description?: string;
  parentEntityId?: string;
  dependencies?: string[];
  repositories: RepositoryConfig[];
}

export type OrganizationEntityKind = "domain" | "subdomain" | "team";

export interface OrganizationMember {
  name: string;
  role?: string;
}

export interface OrganizationEntityConfig {
  id: string;
  kind: OrganizationEntityKind;
  label: string;
  description?: string;
  parentId?: string;
  members?: OrganizationMember[];
}

export interface EntityLinkConfig {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description?: string;
}

export interface RepositoryConfig {
  id: string;
  productId: string;
  role: RepositoryRole;
  /** Product references never authorize private-memory synchronization. */
  purpose?: "product-reference";
  path: string;
  wikiRoot?: string;
  specsRoot?: string;
  gitRemote?: string;
}

/** @deprecated Read-only compatibility for workspaces configured before FTS5-only search. */
export interface EmbeddingsConfig {
  provider: "noop" | "ollama" | "omlx" | string;
  model: string;
  endpoint?: string;
  batchSize: number;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyFile?: string;
  /** Pause before retrying a failed embedding request (default 2000ms). */
  retryDelayMs?: number;
  /**
   * Embedding inputs are truncated to roughly this many tokens (~4 chars each,
   * default 1024). Attention cost is quadratic in input length, so this is the
   * main throughput lever; the full text stays available via keyword search.
   */
  maxInputTokens?: number;
}

export interface StorageConfig {
  databasePath: string;
}

/** Reserved destination for a future complete private export; never an entity projection. */
export interface PrivateBackupRepositoryConfig {
  id: string;
  purpose: "private-backup";
  path: string;
}

export interface WorkMemoryConfig {
  configPath: string;
  workspaceRoot: string;
  workspace: {
    name: string;
    memoryRoot: string;
    /** The person entity that is the workspace owner, as 'person:<id>'. */
    self?: string;
  };
  storage: StorageConfig;
  privateBackup?: PrivateBackupRepositoryConfig;
  /** @deprecated Ignored by the runtime and omitted from newly saved config. */
  embeddings: EmbeddingsConfig;
  entities: OrganizationEntityConfig[];
  entityLinks: EntityLinkConfig[];
  products: ProductConfig[];
  /** Workspace-editable entity/relation taxonomy, loaded from .work-memory/taxonomy.json. */
  taxonomy: WorkspaceTaxonomy;
}

export interface ActiveContext {
  mode: "global" | "product";
  workspaceRoot: string;
  currentPath: string;
  activeProduct?: ProductConfig;
  activeRepository?: RepositoryConfig;
  scope: ScopeMode;
  includedProductIds: string[];
}

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  label: string;
  description?: string;
  aliases?: string[];
  status: EntityStatus;
  parentId?: string;
  ownerIds?: string[];
  contributorIds?: string[];
  tags?: string[];
  focusLevel?: EntityFocusLevel;
  metadata?: Record<string, unknown>;
  repoPath?: string;
  wikiRoot?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityRelationRecord {
  id: string;
  sourceKind: EntityKind;
  sourceId: string;
  targetKind: EntityKind;
  targetId: string;
  relationType: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureEntityRef {
  entityKind: EntityKind;
  entityId: string;
  relationType: string;
}

export interface CaptureRecord {
  id: string;
  path?: string;
  title: string;
  contentType: ContentType;
  status: CaptureStatus;
  primaryEntityKind: EntityKind;
  primaryEntityId: string;
  relatedEntities: CaptureEntityRef[];
  sourceKind: CaptureSourceKind;
  sourceOrigin: CaptureSourceOrigin;
  ingestionStatus: IngestionStatus;
  curationStatus: CurationStatus;
  curatedAt?: string;
  curationSummary?: string;
  tags?: string[];
  contentHash?: string;
  sourceId?: string;
  lastIngestedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mutable capture metadata. The Markdown body remains the source of truth and is
 * updated by source-intake, which then forces a reingestion of the capture.
 */
export interface CaptureUpdate {
  title?: string;
  contentType?: ContentType;
  primaryEntity?: EntityRef;
  /** An empty array deliberately clears every tag. */
  tags?: string[];
}

export interface RepositorySourceProvenance {
  documentId: string;
  repositoryId: string;
  relativePath: string;
  branch?: string;
  commit?: string;
  contentHash: string;
  contentState: "committed" | "modified" | "untracked" | "unversioned";
  indexedAt: string;
  authority: "external-reference";
  availability: "available" | "missing";
  lastVerifiedAt: string;
  lastAttemptAt: string;
  lastAttemptStatus: "complete" | "failed";
  lastSuccessfulAt?: string;
}

export interface SourceRecord {
  id: string;
  logicalKey?: string;
  repositoryProvenance?: RepositorySourceProvenance;
  revision?: number;
  supersededBy?: string;
  title: string;
  sourceType: SourceType;
  origin: string;
  originUri?: string;
  rawPath?: string;
  contentHash: string;
  capturedAt: string;
  sourceDate?: string;
  language?: string;
  status: string;
}

export interface SourceChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  contentHash: string;
}

export interface StructuredInsight {
  kind: "concept" | "decision" | "question" | "task" | "risk";
  title: string;
  body: string;
  confidence: number;
  targetPath?: string;
}

export interface IngestResult {
  source: SourceRecord;
  chunks: SourceChunk[];
  insights: StructuredInsight[];
  inboxItemIds: string[];
}

export interface SearchResult {
  repositoryProvenance?: RepositorySourceProvenance;
  chunkId: string;
  sourceId: string;
  /** Generic entity scope that made the source eligible, when one is requested. */
  entity?: EntityRef;
  /** @deprecated Migration-only compatibility for older search consumers. */
  productId?: string;
  title: string;
  snippet: string;
  score: number;
  /** Source `updated_at` (ISO), available to ranking and display. */
  updatedAt?: string;
  /** Source lifecycle status, available to ranking and display. */
  status?: string;
  /** Set when a guided context scope topped the results up with out-of-scope hits. */
  outOfScope?: boolean;
}

export interface InboxItem {
  id: string;
  type: InboxItemType;
  title: string;
  body: string;
  status: InboxStatus;
  sourceId?: string;
  productId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEntityDraft {
  kind: EntityKind;
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
  status?: EntityStatus;
  parentId?: string;
  ownerIds?: string[];
  contributorIds?: string[];
  tags?: string[];
  focusLevel?: EntityFocusLevel;
  metadata?: Record<string, unknown>;
  repoPath?: string;
  wikiRoot?: string;
}

export type GraphEntityPatch = Partial<Omit<GraphEntityDraft, "kind" | "id">>;

export type GraphChange =
  | { op: "create_entity"; entity: GraphEntityDraft }
  | { op: "update_entity"; entity: EntityRef; patch: GraphEntityPatch }
  | {
      op: "upsert_relation";
      source: EntityRef;
      target: EntityRef;
      relationType: string;
      description?: string;
      metadata?: Record<string, unknown>;
    };

export interface GraphChangeProposalPayload {
  proposalKind: "graph_change";
  schemaVersion: 1;
  proposalKey: string;
  reason: string;
  evidenceObservationIds: string[];
  changes: GraphChange[];
  decision?: {
    status: "accepted" | "rejected";
    reason?: string;
    decidedAt: string;
  };
}

export interface GraphChangePreviewItem {
  index: number;
  op: GraphChange["op"];
  target: string;
  action: "create" | "update" | "no_op" | "conflict";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  conflicts: string[];
}

export interface GraphChangeProposalPreview {
  proposalId: string;
  status: InboxStatus;
  proposalKey: string;
  reason: string;
  evidenceObservationIds: string[];
  changes: GraphChangePreviewItem[];
  conflicts: string[];
  canAccept: boolean;
  /** True when applying an otherwise valid proposal would expand the active strict graph boundary. */
  boundaryChangeRequired?: boolean;
  /** Human-readable expansion reasons shown before an explicit confirmation. */
  boundaryChangeReasons?: string[];
}

/**
 * A sourced interpretation extracted from raw material. Observations are the
 * review boundary between immutable captures/sources and accepted knowledge.
 */
export interface ObservationRecord {
  id: string;
  packageId: string;
  kind: ObservationKind;
  title: string;
  body: string;
  /** Exact, human-verifiable passage from the source. */
  excerpt: string;
  sourceId: string;
  sourceChunkId?: string;
  captureId?: string;
  /** @deprecated Migration-only compatibility. New observations are scoped by subjectKind/subjectId. */
  productId?: string;
  subjectKind?: EntityKind;
  subjectId?: string;
  validationStatus: ObservationValidationStatus;
  evidenceStatus: ObservationEvidenceStatus;
  /** Present when a human explicitly marked the observation as measured. */
  measurement?: ObservationMeasurement;
  /** Stable, package-scoped key used to make agent proposal retries idempotent. */
  proposalKey?: string;
  confidence: number;
  fingerprint: string;
  polarity: -1 | 0 | 1;
  reviewNote?: string;
  reviewedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ObservationEvidenceRecord {
  id: string;
  observationId: string;
  sourceId: string;
  sourceChunkId?: string;
  captureId?: string;
  excerpt: string;
  stance: ObservationEvidenceStance;
  confidence: number;
  createdAt: string;
}

export interface ObservationRelationRecord {
  id: string;
  sourceObservationId: string;
  targetObservationId: string;
  type: ObservationRelationType;
  status: "proposed" | "accepted" | "rejected";
  confidence: number;
  reason?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface ObservationEventRecord {
  id: string;
  observationId: string;
  action: "created" | "edited" | "accepted" | "rejected" | "reclassified" | "merged" | "superseded" | "evidence_changed";
  actor: "agent" | "human" | "system";
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: string;
}

/** Durable, reviewed placement for an optional wiki synthesis. */
export interface WikiSynthesisTarget {
  subject: EntityRef;
  home: EntityRef;
  /** Markdown page relative to the subject's canonical wiki directory. */
  page: string;
}

export interface CurationPackageRecord {
  id: string;
  captureId?: string;
  sourceId: string;
  /** @deprecated Migration-only compatibility. Packages are source-scoped and observations own their entity subjects. */
  productId?: string;
  title: string;
  summary?: string;
  status: CurationPackageStatus;
  wikiDecision: "not_needed" | "suggested";
  wikiReason?: "multi_source_synthesis" | "specification" | "durable_reference" | "publication_required";
  wikiEvidenceObservationIds: string[];
  wikiTarget?: WikiSynthesisTarget;
  /** Stable identity for this reviewed target + evidence set. */
  wikiSynthesisKey?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptRecord {
  id: string;
  canonicalName: string;
  conceptType: string;
  description?: string;
  status: string;
  mentionCount?: number;
}

export interface ConceptMentionRecord {
  id: string;
  conceptId: string;
  sourceId: string;
  chunkId?: string;
  quote?: string;
  confidence: number;
}

export interface GraphRelationRecord {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  sourceId?: string;
  confidence: number;
  status: string;
}

export type GraphNodeType =
  | "domain"
  | "subdomain"
  | "team"
  | "product"
  | "repository"
  | "project"
  | "discovery"
  | "initiative"
  | "feature"
  | "feature_request"
  | "practice"
  | "mission"
  | "okr"
  | "kpi"
  | "insight"
  | "person"
  | "oneagent"
  | "capture"
  | "concept"
  | "decision"
  | "question"
  | "risk"
  | "task"
  | "source"
  | "wiki_page"
  // Workspace-defined custom entity kinds surface as their own node type so the
  // cockpit can color and filter them; built-in literals keep autocompletion.
  | (string & {});

export type GraphNodeStatus =
  | "accepted"
  | "active"
  | "candidate"
  | "conflicted"
  | "deprecated"
  | "indexed"
  | "open"
  | "pending"
  | "rejected"
  | "reviewed"
  | "superseded"
  | "unknown"
  | "validated";

export interface GraphViewNode {
  id: string;
  label: string;
  type: GraphNodeType;
  status?: GraphNodeStatus;
  productIds?: string[];
  path?: string;
  sourceId?: string;
  confidence?: number;
  provider?: "work-memory" | "graphify" | "fallback" | string;
  meta?: Record<string, unknown>;
}

export interface GraphViewEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  predicate: string;
  status?: GraphNodeStatus;
  confidence?: number;
  sourceId?: string;
  provider?: "work-memory" | "graphify" | "fallback" | string;
  meta?: Record<string, unknown>;
}

export interface GraphViewDiagnostic {
  provider: string;
  status: "ok" | "degraded" | "missing" | "error";
  message: string;
  path?: string;
}

export interface GraphViewModel {
  activeProductId?: string;
  scope: ScopeMode;
  includedProductIds: string[];
  generatedAt: string;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  diagnostics?: GraphViewDiagnostic[];
  /** Present when the model was filtered/annotated by an active agent context scope. */
  contextScope?: {
    mode: AgentContextScopeMode;
    selectedEntities: string[];
    counts: { entities: number; captures: number; sources: number; metadataOnly?: number };
    instruction: string;
  };
}

export interface CountByKey {
  key: string;
  count: number;
}
