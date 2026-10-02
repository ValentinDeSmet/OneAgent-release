import type { EntityKind, EntityRef } from "./taxonomy.ts";

export const AGENT_CONTEXT_SCOPE_UI_KEY = "agentContextScope";
export const ACTIVE_CONTEXT_VIEW_UI_KEY = "activeContextView";
export const LEGACY_GRAPH_VIEWS_UI_KEY = "graphViewPresets";
export const DEFAULT_CONTEXT_SCOPE_DEPTH = 1;
export const MAX_CONTEXT_SCOPE_DEPTH = 3;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 64_000;
export const MAX_CONTEXT_TOKEN_BUDGET = 1_000_000;

export type AgentContextScopeMode = "strict" | "guided" | "disabled";
export type ContextNodeRole = "pinned" | "included" | "proposed" | "exploratory" | "excluded";
export type ContextRefreshPolicy = "frozen" | "monitored" | "dynamic";
export type ContextSourceAccessPolicy = "none" | "metadata" | "snippets" | "full";
export type ContextObservationMeasurementFilter = "any" | "measured" | "unmeasured";

export interface ContextNodeSelection {
  entity: EntityRef;
  role: ContextNodeRole;
  reason?: string;
  confidence?: number;
  estimatedTokens?: number;
  proposedAt?: string;
}

export interface ContextTimeRange {
  from?: string;
  to?: string;
}

export interface AgentContextScope {
  /** Active roots kept for backwards compatibility with pre-P1 clients. */
  selectedEntities: EntityRef[];
  depth: number;
  includedTypes?: EntityKind[];
  mode: AgentContextScopeMode;
  nodeSelections?: ContextNodeSelection[];
  excludedEntities?: EntityRef[];
  allowedRelationTypes?: string[];
  timeRange?: ContextTimeRange;
  validationStatuses?: string[];
  /** Optional P2-specific filters. `validationStatuses` remains a compatibility alias for observation statuses. */
  entityStatuses?: string[];
  sourceStatuses?: string[];
  observationValidationStatuses?: string[];
  observationEvidenceStatuses?: string[];
  /** Measurement is orthogonal to evidence corroboration/contradiction. */
  observationMeasurement?: ContextObservationMeasurementFilter;
  sourceAccess?: ContextSourceAccessPolicy;
  tokenBudget?: number;
  refreshPolicy?: ContextRefreshPolicy;
  viewId?: string;
  viewVersion?: number;
  updatedAt?: string;
}

export interface ResolvedContextScope {
  scope: AgentContextScope;
  entities: EntityRef[];
  roles: Record<string, ContextNodeRole>;
  /** Graph-visible boundary nodes whose content plane must not be injected. */
  metadataOnlyEntityRefs?: string[];
  sourceIds: string[];
  captureIds: string[];
  taskIds: string[];
  inboxItemIds: string[];
  observationIds: string[];
  curationPackageIds: string[];
  counts: { entities: number; captures: number; sources: number; tasks: number; inbox: number; observations: number; curationPackages: number };
}

/** Public identity retained for a graph boundary node whose content belongs to another product. */
export interface ContextEntityLabel {
  kind: EntityKind;
  id: string;
  label: string;
}

/** Minimal structural relation retained when one of its endpoints is metadata-only. */
export interface ContextRelationLabel {
  id: string;
  sourceKind: EntityKind;
  sourceId: string;
  targetKind: EntityKind;
  targetId: string;
  relationType: string;
}

export function isMetadataOnlyEntityRef(
  resolved: Pick<ResolvedContextScope, "metadataOnlyEntityRefs"> | undefined,
  ref: Pick<EntityRef, "kind" | "id">
): boolean {
  return Boolean(resolved?.metadataOnlyEntityRefs?.includes(`${ref.kind}:${ref.id}`));
}

/**
 * Never hydrate a metadata-only graph leaf into a complete entity record.
 * Consumers may still show its stable identity and label for graph readability.
 */
export function sanitizeEntityForResolvedContext<T extends { kind: EntityKind; id: string; label?: string }>(
  resolved: Pick<ResolvedContextScope, "metadataOnlyEntityRefs"> | undefined,
  entity: T
): T | ContextEntityLabel {
  if (!isMetadataOnlyEntityRef(resolved, entity)) return entity;
  return { kind: entity.kind, id: entity.id, label: entity.label ?? entity.id };
}

/** Strip provenance, descriptions, metadata and timestamps from boundary relations. */
export function sanitizeRelationForResolvedContext<T extends {
  id: string;
  sourceKind: EntityKind;
  sourceId: string;
  targetKind: EntityKind;
  targetId: string;
  relationType: string;
}>(
  resolved: Pick<ResolvedContextScope, "metadataOnlyEntityRefs"> | undefined,
  relation: T
): T | ContextRelationLabel {
  if (
    !isMetadataOnlyEntityRef(resolved, { kind: relation.sourceKind, id: relation.sourceId })
    && !isMetadataOnlyEntityRef(resolved, { kind: relation.targetKind, id: relation.targetId })
  ) return relation;
  return {
    id: relation.id,
    sourceKind: relation.sourceKind,
    sourceId: relation.sourceId,
    targetKind: relation.targetKind,
    targetId: relation.targetId,
    relationType: relation.relationType
  };
}

export interface ContextViewRecord {
  id: string;
  name: string;
  version: number;
  visualState: Record<string, unknown>;
  context: AgentContextScope;
  refreshPolicy: ContextRefreshPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface ContextPreviewItem {
  ref: string;
  label: string;
  role: ContextNodeRole;
  reason?: string;
  confidence?: number;
  estimatedTokens: number;
  updatedAt?: string;
}

export interface ContextPreview {
  scope: AgentContextScope;
  resolved: ResolvedContextScope;
  included: ContextPreviewItem[];
  proposed: ContextPreviewItem[];
  excluded: Array<{ ref: string; label?: string; reason: string }>;
  stale: ContextPreviewItem[];
  outOfScope: Array<{ ref: string; label?: string; reason: string }>;
  estimatedTokens: number;
  budget: number;
  overBudget: boolean;
}

export interface ContextSuggestion extends ContextNodeSelection {
  entity: EntityRef;
  label: string;
  score: number;
}

export interface ContextPackEntry {
  kind: "entity" | "source" | "task" | "inbox" | "observation";
  ref: string;
  title: string;
  role: ContextNodeRole;
  content: string;
  tokenCount: number;
  provenance: string[];
  citations?: Array<{ observationId?: string; sourceId: string; sourceRevision?: number; chunkId?: string; excerpt?: string }>;
}

export interface ContextPack {
  id: string;
  version: number;
  viewId?: string;
  viewVersion?: number;
  sessionId?: string;
  request: string;
  scope: AgentContextScope;
  resolvedEntities: EntityRef[];
  entries: ContextPackEntry[];
  exclusions: Array<{ ref: string; reason: string }>;
  provenance: Array<{ sourceId: string; title?: string; status?: string; revision?: number; supersededBy?: string; repositoryProvenance?: import("./types.ts").RepositorySourceProvenance }>;
  estimatedTokens: number;
  actualTokens: number;
  budget: number;
  truncated: boolean;
  createdAt: string;
}

/** Lightweight history representation that deliberately omits hydrated pack entries. */
export interface ContextPackSummary {
  id: string;
  version: number;
  viewId?: string;
  viewVersion?: number;
  sessionId?: string;
  request: string;
  scope: AgentContextScope;
  entryCount: number;
  provenance: ContextPack["provenance"];
  estimatedTokens: number;
  actualTokens: number;
  budget: number;
  truncated: boolean;
  createdAt: string;
}

/**
 * Context Pack history is bounded automatically after each compile. Limits are
 * evaluated per persistent view scope (including the global/unscoped scope).
 */
export interface ContextPackRetentionPolicy {
  maxPacksPerView: number;
  maxPacksPerSession: number;
  maxAgeDays: number;
  /** Always at least one so pruning cannot reset the next version to 1. */
  preserveLatestPerView: number;
}

export const DEFAULT_CONTEXT_PACK_RETENTION_POLICY: ContextPackRetentionPolicy = {
  maxPacksPerView: 100,
  maxPacksPerSession: 20,
  maxAgeDays: 90,
  preserveLatestPerView: 3
};

export type ContextPackPruneReason = "age" | "view_limit" | "session_limit";

export interface ContextPackPruneResult {
  dryRun: boolean;
  scanned: number;
  deleted: number;
  retained: number;
  protected: number;
  candidateIds: string[];
  byReason: Record<ContextPackPruneReason, number>;
  policy: ContextPackRetentionPolicy;
}

export interface ContextViewComparison {
  leftId: string;
  rightId: string;
  added: string[];
  removed: string[];
  roleChanges: Array<{ ref: string; from: ContextNodeRole; to: ContextNodeRole }>;
  policyChanges: string[];
}

/**
 * Instruction line surfaced to agents whenever a context scope is active, so a
 * model that never calls the scoped tools still learns the boundary exists.
 */
export function contextScopeInstruction(scope: AgentContextScope): string {
  const entities = scope.selectedEntities.map((ref) => `${ref.kind}:${ref.id}`).join(", ");
  const view = scope.viewId ? ` View ${scope.viewId}${scope.viewVersion ? ` v${scope.viewVersion}` : ""}.` : "";
  if (scope.mode === "strict") {
    return `An agent context scope is active (mode strict) on: ${entities}.${view} Answer ONLY from OneAgent content inside this scope. Do not read or search other workspace files or documents; if the scoped content is insufficient, say exactly what is missing instead of looking elsewhere.`;
  }
  return `An agent context scope is active (mode guided) on: ${entities}.${view} Prefer OneAgent content inside this scope; if you rely on anything outside it (including workspace files), explicitly flag it as outside the selected context.`;
}

/**
 * Coerce partial/persisted input into a valid scope. Depth is bounded so a
 * scope can never trigger unbounded graph expansion; the default mode is
 * "guided" (prefer scope, flag what is outside) which is the safe agent default.
 */
export function normalizeContextScope(input: Partial<AgentContextScope> | undefined): AgentContextScope {
  const selectedEntities = dedupeRefs(Array.isArray(input?.selectedEntities) ? input.selectedEntities : []);
  const nodeSelections = normalizeNodeSelections(input?.nodeSelections, selectedEntities);
  const excludedEntities = dedupeRefs([
    ...(Array.isArray(input?.excludedEntities) ? input.excludedEntities : []),
    ...nodeSelections.filter((selection) => selection.role === "excluded").map((selection) => selection.entity)
  ]);
  const excluded = new Set(excludedEntities.map(refKey));
  const activeSelections = nodeSelections.filter((selection) =>
    selection.role !== "proposed" && selection.role !== "excluded" && !excluded.has(refKey(selection.entity))
  );
  const activeEntities = dedupeRefs(activeSelections.map((selection) => selection.entity));
  const depthRaw = Number(input?.depth);
  const depth = Number.isFinite(depthRaw)
    ? Math.max(0, Math.min(MAX_CONTEXT_SCOPE_DEPTH, Math.round(depthRaw)))
    : DEFAULT_CONTEXT_SCOPE_DEPTH;
  const mode: AgentContextScopeMode =
    input?.mode === "strict" || input?.mode === "disabled" ? input.mode : "guided";
  const includedTypes =
    Array.isArray(input?.includedTypes) && input.includedTypes.length > 0 ? input.includedTypes : undefined;
  const allowedRelationTypes = normalizeStrings(input?.allowedRelationTypes);
  const validationStatuses = normalizeStrings(input?.validationStatuses);
  const entityStatuses = normalizeStrings(input?.entityStatuses);
  const sourceStatuses = normalizeStrings(input?.sourceStatuses);
  const observationValidationStatuses = normalizeStrings(input?.observationValidationStatuses);
  const rawObservationEvidenceStatuses = normalizeStrings(input?.observationEvidenceStatuses);
  // Saved P2 views may still carry the former overloaded `measured` evidence
  // state. Preserve their intent while migrating to the independent dimension.
  const legacyMeasuredFilter = rawObservationEvidenceStatuses?.includes("measured") === true;
  const observationEvidenceStatuses = rawObservationEvidenceStatuses?.filter((status) => status !== "measured");
  const observationMeasurement: ContextObservationMeasurementFilter =
    input?.observationMeasurement === "measured" || input?.observationMeasurement === "unmeasured"
      ? input.observationMeasurement
      : legacyMeasuredFilter
        ? "measured"
        : "any";
  const sourceAccess: ContextSourceAccessPolicy =
    input?.sourceAccess === "none" || input?.sourceAccess === "metadata" || input?.sourceAccess === "snippets"
      ? input.sourceAccess
      : "full";
  const refreshPolicy: ContextRefreshPolicy =
    input?.refreshPolicy === "frozen" || input?.refreshPolicy === "dynamic" ? input.refreshPolicy : "monitored";
  const budgetRaw = Number(input?.tokenBudget);
  const tokenBudget = Number.isFinite(budgetRaw)
    ? Math.max(1, Math.min(MAX_CONTEXT_TOKEN_BUDGET, Math.round(budgetRaw)))
    : DEFAULT_CONTEXT_TOKEN_BUDGET;
  const timeRange = normalizeTimeRange(input?.timeRange);
  return {
    selectedEntities: activeEntities,
    depth,
    includedTypes,
    mode,
    nodeSelections,
    excludedEntities: excludedEntities.length > 0 ? excludedEntities : undefined,
    allowedRelationTypes,
    timeRange,
    validationStatuses,
    entityStatuses,
    sourceStatuses,
    observationValidationStatuses,
    observationEvidenceStatuses: observationEvidenceStatuses?.length ? observationEvidenceStatuses : undefined,
    observationMeasurement,
    sourceAccess,
    tokenBudget,
    refreshPolicy,
    viewId: input?.viewId,
    viewVersion: Number.isFinite(Number(input?.viewVersion)) ? Math.max(1, Math.round(Number(input?.viewVersion))) : undefined,
    updatedAt: input?.updatedAt
  };
}

export function contextSelectionRole(scope: AgentContextScope, ref: EntityRef): ContextNodeRole | undefined {
  return scope.nodeSelections?.find((selection) => refKey(selection.entity) === refKey(ref))?.role;
}

function normalizeNodeSelections(
  input: ContextNodeSelection[] | undefined,
  legacySelected: EntityRef[]
): ContextNodeSelection[] {
  const byRef = new Map<string, ContextNodeSelection>();
  for (const selection of Array.isArray(input) ? input : []) {
    if (!selection?.entity?.kind || !selection.entity.id || !isContextNodeRole(selection.role)) continue;
    const confidence = Number(selection.confidence);
    const estimatedTokens = Number(selection.estimatedTokens);
    byRef.set(refKey(selection.entity), {
      entity: { kind: selection.entity.kind, id: selection.entity.id },
      role: selection.role,
      reason: normalizeOptionalString(selection.reason),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
      estimatedTokens: Number.isFinite(estimatedTokens) ? Math.max(0, Math.round(estimatedTokens)) : undefined,
      proposedAt: normalizeOptionalString(selection.proposedAt)
    });
  }
  for (const entity of legacySelected) {
    if (!byRef.has(refKey(entity))) {
      byRef.set(refKey(entity), { entity, role: "included" });
    }
  }
  return [...byRef.values()];
}

function isContextNodeRole(value: unknown): value is ContextNodeRole {
  return value === "pinned" || value === "included" || value === "proposed" || value === "exploratory" || value === "excluded";
}

function dedupeRefs(refs: Array<Partial<EntityRef> | undefined>): EntityRef[] {
  const byRef = new Map<string, EntityRef>();
  for (const ref of refs) {
    if (!ref?.kind || !ref.id) continue;
    byRef.set(`${ref.kind}:${ref.id}`, { kind: ref.kind, id: ref.id });
  }
  return [...byRef.values()];
}

function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

function normalizeStrings(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function normalizeTimeRange(value: ContextTimeRange | undefined): ContextTimeRange | undefined {
  if (!value || typeof value !== "object") return undefined;
  const from = normalizeOptionalString(value.from);
  const to = normalizeOptionalString(value.to);
  return from || to ? { from, to } : undefined;
}
