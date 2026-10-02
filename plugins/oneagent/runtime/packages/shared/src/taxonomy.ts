// Controlled vocabularies for the generic OneAgent entity taxonomy.
// See docs spec "OneAgent Entity Taxonomy Evolution".

export const ENTITY_KINDS = [
  "oneagent",
  "domain",
  "subdomain",
  "team",
  "product",
  "repository",
  "project",
  // A time-bounded research effort that reduces uncertainty and concludes with
  // an evidence-backed outcome. Unlike a project, its primary output is learning,
  // not delivery. Captures such as interviews are attached to the discovery.
  "discovery",
  "initiative",
  "feature",
  // A user/stakeholder ask. Distinct from "feature" (built or planned capability):
  // requests can be rejected, or converge into one feature via feature implements
  // feature_request. Typically status candidate + requested_by the person.
  "feature_request",
  "practice",
  "mission",
  // An OKR is one aggregate graph entity. Its key results remain structured
  // children in the entity metadata; they are deliberately not graph nodes.
  "okr",
  // A measurable outcome. Time-series values live in kpi_measurements rather
  // than being duplicated as graph nodes.
  "kpi",
  // A learning or user verbatim worth keeping (reported_by the person, informs
  // the product/feature it is about). Not a durable domain concept.
  "insight",
  "person"
] as const;

// Widened so workspace-defined custom kinds (see WorkspaceTaxonomy) type-check
// everywhere an EntityKind flows; built-in literals keep autocompletion.
export type EntityKind = (typeof ENTITY_KINDS)[number] | (string & {});

// Core kinds carry pipeline semantics (product scoping, related people, workspace
// config, wiki roots) and can never be merged away or deleted. The remaining
// built-ins are "vocabulary": mergeable into another kind via an alias.
export const CORE_ENTITY_KINDS = ["oneagent", "domain", "subdomain", "team", "product", "repository", "discovery", "person"] as const;

export const DISCOVERY_PHASES = ["framing", "planning", "collecting", "synthesizing", "concluded"] as const;
export type DiscoveryPhase = (typeof DISCOVERY_PHASES)[number];

export const DISCOVERY_OUTCOMES = ["validated", "invalidated", "inconclusive", "pivoted", "cancelled"] as const;
export type DiscoveryOutcome = (typeof DISCOVERY_OUTCOMES)[number];

export interface DiscoveryMetadata {
  schemaVersion: 1;
  phase: DiscoveryPhase;
  outcome?: DiscoveryOutcome;
  startedAt?: string;
  targetEndAt?: string;
  concludedAt?: string;
  conclusionCriteria?: string[];
}

export interface DiscoveryEntityMetadata extends Record<string, unknown> {
  discovery: DiscoveryMetadata;
}

export interface CustomEntityKindConfig {
  id: string;
  label: string;
  /** Node color (hex). The cockpit derives a readable variant per theme. */
  color?: string;
  /** "When to use" — injected into the curation prompt so the agent classifies into it. */
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export type RelationCategory = "structural" | "work" | "people" | "practice_mission";

export interface CustomRelationTypeConfig {
  type: string;
  category: RelationCategory;
  /** How to read the relation, e.g. "A informed_by B reads: A is informed by B". */
  reading?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RelationTypeAlias {
  into: string;
  /** The aliased type is the semantic inverse of the target: swap source and target on remap. */
  swapDirection?: boolean;
}

/** Workspace-editable taxonomy stored in .work-memory/taxonomy.json. */
export interface WorkspaceTaxonomy {
  customEntityKinds: CustomEntityKindConfig[];
  /** Merged-away kinds: any read or write of the key kind resolves to the value kind. */
  entityKindAliases: Record<string, string>;
  customRelationTypes: CustomRelationTypeConfig[];
  relationTypeAliases: Record<string, RelationTypeAlias>;
}

export function emptyWorkspaceTaxonomy(): WorkspaceTaxonomy {
  return { customEntityKinds: [], entityKindAliases: {}, customRelationTypes: [], relationTypeAliases: {} };
}

export const ENTITY_STATUSES = ["active", "inactive", "candidate", "archived"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ENTITY_FOCUS_LEVELS = ["primary", "supporting", "informational"] as const;
export type EntityFocusLevel = (typeof ENTITY_FOCUS_LEVELS)[number];

export const CONTENT_TYPES = [
  "document",
  "note",
  "meeting",
  "user_interview",
  "one_to_one",
  "monthly_update",
  "mission_review",
  "feedback",
  "development_plan",
  "idea",
  "feature_idea",
  "feature_request",
  "insight",
  "research",
  "strategy",
  "okr",
  "guide",
  "best_practice",
  "decision",
  "risk",
  "question",
  "flow",
  "raw_input"
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CAPTURE_STATUSES = ["captured", "reviewed", "archived", "superseded"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CAPTURE_SOURCE_KINDS = ["paste", "file", "clipboard", "copilot", "manual", "import"] as const;
export type CaptureSourceKind = (typeof CAPTURE_SOURCE_KINDS)[number];

export const CAPTURE_SOURCE_ORIGINS = [
  "cockpit",
  "cli",
  "copilot_tool",
  "vscode_command",
  "external_import"
] as const;
export type CaptureSourceOrigin = (typeof CAPTURE_SOURCE_ORIGINS)[number];

export const INGESTION_STATUSES = [
  "not_ingested",
  "queued",
  "indexing",
  "indexed",
  "failed",
  "stale"
] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

// Curation turns a raw capture into classified, related knowledge. A wiki synthesis is optional.
export const CURATION_STATUSES = ["pending", "curating", "curated", "failed"] as const;
export type CurationStatus = (typeof CURATION_STATUSES)[number];

// Relation types grouped per the spec; flattened into a single controlled set.
export const STRUCTURAL_RELATIONS = [
  "contains",
  "part_of",
  "owns",
  "owned_by",
  "scoped_to",
  "depends_on",
  "related_to"
] as const;

export const WORK_RELATIONS = [
  "drives",
  "supports",
  "contributes_to",
  "blocks",
  "impacts",
  "informs",
  "implements",
  "validates",
  "supersedes"
] as const;

export const PERSON_RELATIONS = [
  "subject",
  "owner",
  "reviewer",
  "manager",
  "stakeholder_of",
  "requested_by",
  "reported_by",
  "contact_for",
  "expert_on",
  "decision_maker_for",
  "contributor_to"
] as const;

export const PRACTICE_MISSION_RELATIONS = [
  "has_okr",
  "applies_practice",
  "development_area",
  "measured_by",
  "informs_mission",
  "tracks_progress_for",
  "discussed_in"
] as const;

export const RELATION_TYPES = [
  ...STRUCTURAL_RELATIONS,
  ...WORK_RELATIONS,
  ...PERSON_RELATIONS,
  ...PRACTICE_MISSION_RELATIONS
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const DEFAULT_ENTITY_KIND: EntityKind = "oneagent";
export const DEFAULT_ENTITY_ID = "oneagent";
export const DEFAULT_ENTITY_LABEL = "OneAgent";
export const DEFAULT_RELATION_TYPE: RelationType = "related_to";

// The taxonomy is per-workspace: loadConfig() calls configureTaxonomy() once the
// workspace's taxonomy.json is read, extending the controlled vocabularies for
// the lifetime of the process. Deterministic: one workspace per process.
let activeTaxonomy: WorkspaceTaxonomy = emptyWorkspaceTaxonomy();
const CUSTOM_ENTITY_KIND_SET = new Set<string>();
const CUSTOM_RELATION_TYPE_SET = new Set<string>();

export function configureTaxonomy(taxonomy: WorkspaceTaxonomy | undefined): void {
  activeTaxonomy = taxonomy ?? emptyWorkspaceTaxonomy();
  CUSTOM_ENTITY_KIND_SET.clear();
  for (const kind of activeTaxonomy.customEntityKinds) {
    CUSTOM_ENTITY_KIND_SET.add(kind.id);
  }
  for (const alias of Object.keys(activeTaxonomy.entityKindAliases)) {
    CUSTOM_ENTITY_KIND_SET.add(alias);
  }
  CUSTOM_RELATION_TYPE_SET.clear();
  for (const relation of activeTaxonomy.customRelationTypes) {
    CUSTOM_RELATION_TYPE_SET.add(relation.type);
  }
  for (const alias of Object.keys(activeTaxonomy.relationTypeAliases)) {
    CUSTOM_RELATION_TYPE_SET.add(alias);
  }
}

export function activeWorkspaceTaxonomy(): WorkspaceTaxonomy {
  return activeTaxonomy;
}

export function isCoreEntityKind(kind: string): boolean {
  return (CORE_ENTITY_KINDS as readonly string[]).includes(kind);
}

export function isBuiltinEntityKind(kind: string): boolean {
  return (ENTITY_KINDS as readonly string[]).includes(kind);
}

/** Follow entity-kind aliases (bounded, cycle-safe) to the effective kind. */
export function resolveEntityKind(kind: string): string {
  let current = kind;
  for (let hop = 0; hop < 5; hop += 1) {
    const next = activeTaxonomy.entityKindAliases[current];
    if (!next || next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

/** Follow relation-type aliases; swapDirection composes across hops (XOR). */
export function resolveRelationType(type: string): { type: string; swapDirection: boolean } {
  let current = type;
  let swap = false;
  for (let hop = 0; hop < 5; hop += 1) {
    const alias = activeTaxonomy.relationTypeAliases[current];
    if (!alias || alias.into === current) {
      return { type: current, swapDirection: swap };
    }
    swap = alias.swapDirection ? !swap : swap;
    current = alias.into;
  }
  return { type: current, swapDirection: swap };
}

const ENTITY_KIND_SET = new Set<string>(ENTITY_KINDS);
const ENTITY_STATUS_SET = new Set<string>(ENTITY_STATUSES);
const ENTITY_FOCUS_LEVEL_SET = new Set<string>(ENTITY_FOCUS_LEVELS);
const DISCOVERY_PHASE_SET = new Set<string>(DISCOVERY_PHASES);
const DISCOVERY_OUTCOME_SET = new Set<string>(DISCOVERY_OUTCOMES);
const CONTENT_TYPE_SET = new Set<string>(CONTENT_TYPES);
const CAPTURE_STATUS_SET = new Set<string>(CAPTURE_STATUSES);
const CAPTURE_SOURCE_KIND_SET = new Set<string>(CAPTURE_SOURCE_KINDS);
const CAPTURE_SOURCE_ORIGIN_SET = new Set<string>(CAPTURE_SOURCE_ORIGINS);
const INGESTION_STATUS_SET = new Set<string>(INGESTION_STATUSES);
const CURATION_STATUS_SET = new Set<string>(CURATION_STATUSES);
const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KIND_SET.has(value) || CUSTOM_ENTITY_KIND_SET.has(value));
}

export function isContentType(value: unknown): value is ContentType {
  return typeof value === "string" && CONTENT_TYPE_SET.has(value);
}

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && (RELATION_TYPE_SET.has(value) || CUSTOM_RELATION_TYPE_SET.has(value));
}

export function isCaptureStatus(value: unknown): value is CaptureStatus {
  return typeof value === "string" && CAPTURE_STATUS_SET.has(value);
}

export function isCaptureSourceKind(value: unknown): value is CaptureSourceKind {
  return typeof value === "string" && CAPTURE_SOURCE_KIND_SET.has(value);
}

export function isCaptureSourceOrigin(value: unknown): value is CaptureSourceOrigin {
  return typeof value === "string" && CAPTURE_SOURCE_ORIGIN_SET.has(value);
}

export function isIngestionStatus(value: unknown): value is IngestionStatus {
  return typeof value === "string" && INGESTION_STATUS_SET.has(value);
}

export function isCurationStatus(value: unknown): value is CurationStatus {
  return typeof value === "string" && CURATION_STATUS_SET.has(value);
}

export function assertCurationStatus(value: unknown): CurationStatus {
  if (!isCurationStatus(value)) {
    throw new Error(`Unknown curation status: ${String(value)}. Allowed: ${CURATION_STATUSES.join(", ")}.`);
  }
  return value;
}

export function isEntityStatus(value: unknown): value is EntityStatus {
  return typeof value === "string" && ENTITY_STATUS_SET.has(value);
}

export function isEntityFocusLevel(value: unknown): value is EntityFocusLevel {
  return typeof value === "string" && ENTITY_FOCUS_LEVEL_SET.has(value);
}

export function isDiscoveryPhase(value: unknown): value is DiscoveryPhase {
  return typeof value === "string" && DISCOVERY_PHASE_SET.has(value);
}

export function isDiscoveryOutcome(value: unknown): value is DiscoveryOutcome {
  return typeof value === "string" && DISCOVERY_OUTCOME_SET.has(value);
}

/**
 * Validate and normalize the structured part of discovery entity metadata.
 * Unknown top-level metadata is preserved so generic entity capabilities remain
 * composable, while the discovery lifecycle itself stays a controlled contract.
 */
export function normalizeDiscoveryEntityMetadata(
  metadata: Record<string, unknown> | undefined
): DiscoveryEntityMetadata {
  const root = metadata ?? {};
  const raw = root.discovery;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("Discovery metadata must contain a discovery object.");
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const phase = input.phase ?? "framing";
  if (!isDiscoveryPhase(phase)) {
    throw new Error(`Unknown discovery phase: ${String(phase)}. Allowed: ${DISCOVERY_PHASES.join(", ")}.`);
  }
  const outcome = input.outcome;
  if (outcome !== undefined && outcome !== null && !isDiscoveryOutcome(outcome)) {
    throw new Error(`Unknown discovery outcome: ${String(outcome)}. Allowed: ${DISCOVERY_OUTCOMES.join(", ")}.`);
  }
  if (phase === "concluded" && !outcome) {
    throw new Error("A concluded discovery requires an outcome.");
  }
  if (phase !== "concluded" && outcome) {
    throw new Error("A discovery outcome can only be set when phase is concluded.");
  }
  const conclusionCriteria = input.conclusionCriteria;
  if (conclusionCriteria !== undefined && (
    !Array.isArray(conclusionCriteria)
    || conclusionCriteria.some((criterion) => typeof criterion !== "string" || !criterion.trim())
  )) {
    throw new Error("Discovery conclusionCriteria must be an array of non-empty strings.");
  }
  for (const key of ["startedAt", "targetEndAt", "concludedAt"] as const) {
    const value = input[key];
    if (value !== undefined && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) {
      throw new Error(`Discovery ${key} must be an ISO date or date-time string.`);
    }
  }
  return {
    ...root,
    discovery: {
      schemaVersion: 1,
      phase,
      ...(outcome ? { outcome } : {}),
      ...(typeof input.startedAt === "string" ? { startedAt: input.startedAt } : {}),
      ...(typeof input.targetEndAt === "string" ? { targetEndAt: input.targetEndAt } : {}),
      ...(typeof input.concludedAt === "string" ? { concludedAt: input.concludedAt } : {}),
      ...(Array.isArray(conclusionCriteria) ? { conclusionCriteria: conclusionCriteria.map((criterion) => criterion.trim()) } : {})
    }
  };
}

export function assertEntityKind(value: unknown): EntityKind {
  if (!isEntityKind(value)) {
    const custom = [...CUSTOM_ENTITY_KIND_SET];
    const allowed = [...ENTITY_KINDS, ...custom].join(", ");
    throw new Error(`Unknown entity kind: ${String(value)}. Allowed: ${allowed}.`);
  }
  return value;
}

export function assertContentType(value: unknown): ContentType {
  if (!isContentType(value)) {
    throw new Error(`Unknown content type: ${String(value)}. Allowed: ${CONTENT_TYPES.join(", ")}.`);
  }
  return value;
}

export function assertCaptureStatus(value: unknown): CaptureStatus {
  if (!isCaptureStatus(value)) {
    throw new Error(`Unknown capture status: ${String(value)}. Allowed: ${CAPTURE_STATUSES.join(", ")}.`);
  }
  return value;
}

// Relations may be custom when explicitly prefixed with "custom:" per the spec.
export function isCustomRelation(value: string): boolean {
  return value.startsWith("custom:");
}

export function assertRelationType(value: unknown): string {
  if (typeof value === "string" && (isRelationType(value) || isCustomRelation(value))) {
    return value;
  }
  throw new Error(
    `Unknown relation type: ${String(value)}. Use a known relation or prefix a custom one with "custom:".`
  );
}

/** Normalize a free-form id into lowercase kebab-case (letters, numbers, dashes). */
export function normalizeEntityId(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface RelatedEntityRef extends EntityRef {
  relation: string;
}

/** Parse a "kind:id" entity reference, validating the kind and resolving merged-away kinds. */
export function parseEntityRef(value: string): EntityRef {
  const [kind, ...idParts] = value.split(":");
  const id = idParts.join(":");
  if (!kind || !id) {
    throw new Error(`Invalid entity reference "${value}". Expected "kind:id".`);
  }
  return { kind: resolveEntityKind(assertEntityKind(kind)), id };
}

/** Parse a "kind:id:relation" related-entity reference, validating kind + relation. */
export function parseRelatedEntityRef(value: string): RelatedEntityRef {
  const parts = value.split(":");
  if (parts.length < 3) {
    throw new Error(`Invalid related entity reference "${value}". Expected "kind:id:relation".`);
  }
  const relation = parts[parts.length - 1];
  const kind = parts[0];
  const id = parts.slice(1, parts.length - 1).join(":");
  if (!kind || !id || !relation) {
    throw new Error(`Invalid related entity reference "${value}". Expected "kind:id:relation".`);
  }
  return {
    kind: resolveEntityKind(assertEntityKind(kind)),
    id,
    relation: resolveRelationType(assertRelationType(relation)).type
  };
}
