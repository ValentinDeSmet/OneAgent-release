import {
  assertEntityKind,
  assertRelationType,
  createStableId,
  isBuiltinEntityKind,
  isEntityFocusLevel,
  isEntityStatus,
  normalizeEntityId,
  nowIso,
  resolveEntityKind,
  resolveRelationType
} from "../../shared/src/index.ts";
import type {
  EntityRecord,
  EntityRef,
  GraphChange,
  GraphChangePreviewItem,
  GraphChangeProposalPayload,
  GraphChangeProposalPreview,
  GraphEntityDraft,
  GraphEntityPatch,
  InboxItem,
  ObservationRecord
} from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";

export interface ProposeGraphChangeInput {
  title?: string;
  reason: string;
  evidenceObservationIds: string[];
  changes: GraphChange[];
}

export interface GraphChangeProposalResult {
  item: InboxItem;
  payload: GraphChangeProposalPayload;
  preview: GraphChangeProposalPreview;
}

export interface GraphChangeBoundaryOptions {
  /** Exact hard boundary supplied by a strict agent context. */
  allowedEntityRefs?: Iterable<string>;
  allowedObservationIds?: Iterable<string>;
  allowedRelationTypes?: Iterable<string>;
  /** Explicit human confirmation to apply a proposal that creates new nodes. */
  allowBoundaryChange?: boolean;
}

/**
 * Create one reviewable, idempotent graph mutation proposal. The graph is never
 * touched here: accepted observations are evidence, not authorization to write.
 */
export function proposeGraphChange(
  db: WorkMemoryDatabase,
  input: ProposeGraphChangeInput,
  boundary: GraphChangeBoundaryOptions = {}
): GraphChangeProposalResult {
  const reason = requiredText(input.reason, "graph change reason");
  assertEvidenceInsideGraphBoundary(input.evidenceObservationIds, boundary);
  const evidence = requireAcceptedEvidence(db, input.evidenceObservationIds);
  const changes = normalizeGraphChanges(input.changes);
  if (changes.length === 0) throw new Error("At least one graph change is required.");
  inspectGraphChangeBoundary(db, changes, boundary);
  const evidenceObservationIds = evidence.map((item) => item.id).sort();
  const proposalKey = createStableId("gcpkey", [stableJson({ schemaVersion: 1, reason, changes, evidenceObservationIds })]);
  const id = createStableId("inbox_gcp", [proposalKey]);
  const existing = db.getInboxItem(id);
  if (existing) {
    const payload = graphChangePayload(existing);
    return { item: existing, payload, preview: previewGraphChangeProposal(db, id, boundary) };
  }

  const payload: GraphChangeProposalPayload = {
    proposalKind: "graph_change",
    schemaVersion: 1,
    proposalKey,
    reason,
    evidenceObservationIds,
    changes
  };
  const sourceIds = unique(evidence.map((item) => item.sourceId));
  const productIds = unique(evidence.map((item) => item.productId).filter((id): id is string => Boolean(id)));
  const title = input.title?.trim() || graphChangeTitle(changes);
  db.insertInboxItem({
    id,
    type: "graph_change_proposal",
    title,
    body: [
      reason,
      `Evidence: ${evidenceObservationIds.join(", ")}`,
      ...changes.map((change, index) => `${index + 1}. ${graphChangeSummary(change)}`),
      `Proposal key: ${proposalKey}`
    ].join("\n"),
    status: "pending",
    sourceId: sourceIds.length === 1 ? sourceIds[0] : undefined,
    productId: productIds.length === 1 ? productIds[0] : undefined,
    payload: payload as unknown as Record<string, unknown>
  });
  const item = db.getInboxItem(id);
  if (!item) throw new Error(`Unable to persist graph change proposal: ${id}`);
  return { item, payload, preview: previewGraphChangeProposal(db, id, boundary) };
}

export function getGraphChangeProposal(
  db: WorkMemoryDatabase,
  id: string,
  boundary: GraphChangeBoundaryOptions = {}
): GraphChangeProposalResult {
  const item = requireGraphChangeItem(db, id);
  return { item, payload: graphChangePayload(item), preview: previewGraphChangeProposal(db, id, boundary) };
}

export function previewGraphChangeProposal(
  db: WorkMemoryDatabase,
  id: string,
  boundary: GraphChangeBoundaryOptions = {}
): GraphChangeProposalPreview {
  const item = requireGraphChangeItem(db, id);
  const payload = graphChangePayload(item);
  assertEvidenceInsideGraphBoundary(payload.evidenceObservationIds, boundary);
  const boundaryAnalysis = inspectGraphChangeBoundary(db, payload.changes, boundary);
  const conflicts: string[] = [];
  try {
    requireAcceptedEvidence(db, payload.evidenceObservationIds);
  } catch (error) {
    conflicts.push(error instanceof Error ? error.message : String(error));
  }
  const changes = previewChanges(db, id, payload);
  for (const change of changes) conflicts.push(...change.conflicts.map((message) => `Change ${change.index + 1}: ${message}`));
  return {
    proposalId: id,
    status: item.status,
    proposalKey: payload.proposalKey,
    reason: payload.reason,
    evidenceObservationIds: payload.evidenceObservationIds,
    changes,
    conflicts: unique(conflicts),
    canAccept: item.status === "pending" && conflicts.length === 0,
    ...(boundaryAnalysis.active
      ? {
          boundaryChangeRequired: boundaryAnalysis.reasons.length > 0,
          boundaryChangeReasons: boundaryAnalysis.reasons
        }
      : {})
  };
}

/** Apply every proposed change and close its Inbox item in one transaction. */
export function acceptGraphChangeProposal(
  db: WorkMemoryDatabase,
  id: string,
  boundary: GraphChangeBoundaryOptions = {}
): GraphChangeProposalPreview {
  const current = requireGraphChangeItem(db, id);
  if (current.status === "accepted") return previewGraphChangeProposal(db, id, boundary);
  if (current.status !== "pending") throw new Error(`Graph change proposal ${id} is already ${current.status}.`);

  let appliedPreview: GraphChangeProposalPreview | undefined;
  db.runInTransaction(() => {
    const item = requireGraphChangeItem(db, id);
    if (item.status !== "pending") throw new Error(`Graph change proposal ${id} is already ${item.status}.`);
    const payload = graphChangePayload(item);
    assertEvidenceInsideGraphBoundary(payload.evidenceObservationIds, boundary);
    requireAcceptedEvidence(db, payload.evidenceObservationIds);
    const preview = previewGraphChangeProposal(db, id, boundary);
    if (!preview.canAccept) {
      throw new Error(`Graph change proposal ${id} cannot be accepted: ${preview.conflicts.join("; ") || "invalid state"}`);
    }
    if (preview.boundaryChangeRequired && boundary.allowBoundaryChange !== true) {
      throw new Error(
        `Graph change proposal ${id} expands the active strict context boundary and requires an explicitly confirmed boundary change: `
        + (preview.boundaryChangeReasons?.join("; ") || "new graph entities")
      );
    }
    for (const change of payload.changes) applyGraphChange(db, id, payload.evidenceObservationIds, change);
    const decidedAt = nowIso();
    db.updateInboxPayload(id, {
      ...payload,
      decision: { status: "accepted", decidedAt }
    });
    db.updateInboxStatus(id, "accepted");
    appliedPreview = { ...preview, status: "accepted", canAccept: false };
  });
  return appliedPreview!;
}

export function rejectGraphChangeProposal(
  db: WorkMemoryDatabase,
  id: string,
  reason: string,
  boundary: GraphChangeBoundaryOptions = {}
): GraphChangeProposalPreview {
  const rejectionReason = requiredText(reason, "rejection reason");
  const current = requireGraphChangeItem(db, id);
  if (current.status === "rejected") return previewGraphChangeProposal(db, id, boundary);
  if (current.status !== "pending") throw new Error(`Graph change proposal ${id} is already ${current.status}.`);
  const safePreview = previewGraphChangeProposal(db, id, boundary);
  db.runInTransaction(() => {
    const item = requireGraphChangeItem(db, id);
    if (item.status !== "pending") throw new Error(`Graph change proposal ${id} is already ${item.status}.`);
    const payload = graphChangePayload(item);
    db.updateInboxPayload(id, {
      ...payload,
      decision: { status: "rejected", reason: rejectionReason, decidedAt: nowIso() }
    });
    db.updateInboxStatus(id, "rejected");
  });
  return { ...safePreview, status: "rejected", canAccept: false };
}

function assertEvidenceInsideGraphBoundary(ids: string[], boundary: GraphChangeBoundaryOptions): void {
  if (!boundary.allowedObservationIds) return;
  const allowed = new Set(boundary.allowedObservationIds);
  const outside = unique(Array.isArray(ids) ? ids.map(String).filter(Boolean) : []).find((id) => !allowed.has(id));
  if (outside) throw new Error(`Graph change evidence is outside the active strict context scope: ${outside}`);
}

function inspectGraphChangeBoundary(
  db: WorkMemoryDatabase,
  changes: GraphChange[],
  boundary: GraphChangeBoundaryOptions
): { active: boolean; reasons: string[] } {
  if (!boundary.allowedEntityRefs) return { active: false, reasons: [] };
  const allowed = new Set(boundary.allowedEntityRefs);
  const allowedIds = new Set([...allowed].map((ref) => ref.slice(ref.indexOf(":") + 1)));
  const allowedRelations = boundary.allowedRelationTypes ? new Set(boundary.allowedRelationTypes) : undefined;
  const createdRefs = new Set<string>();
  const createdIds = new Set<string>();
  const reasons: string[] = [];

  // Collision checks happen before previewChanges builds its global maps. A
  // create operation may introduce a genuinely new ref, but it must never be
  // used to inspect or overwrite an existing entity hidden outside the scope.
  for (const change of changes) {
    if (change.op !== "create_entity") continue;
    const ref = entityKey(change.entity);
    const existing = db.getEntity(change.entity.kind, change.entity.id);
    if (existing && !allowed.has(ref)) {
      throw new Error(`Graph change create target collides with an entity outside the active strict context scope: ${ref}`);
    }
    createdRefs.add(ref);
    createdIds.add(change.entity.id);
    if (!existing && !allowed.has(ref)) reasons.push(`Create new graph entity ${ref}.`);
  }

  const assertExistingRefAllowed = (ref: EntityRef, label: string): void => {
    const key = entityKey(ref);
    if (!allowed.has(key) && !createdRefs.has(key)) {
      throw new Error(`Graph change ${label} is outside the active strict context scope: ${key}`);
    }
  };
  const assertDraftReferencesAllowed = (
    draft: Pick<GraphEntityDraft, "parentId" | "ownerIds" | "contributorIds"> | GraphEntityPatch,
    entityId: string
  ): void => {
    if (draft.parentId && draft.parentId !== entityId && !allowedIds.has(draft.parentId) && !createdIds.has(draft.parentId)) {
      throw new Error(`Graph change parent is outside the active strict context scope: ${draft.parentId}`);
    }
    for (const [label, ids] of [["owner", draft.ownerIds], ["contributor", draft.contributorIds]] as const) {
      for (const id of ids ?? []) {
        if (!allowed.has(`person:${id}`) && !createdRefs.has(`person:${id}`)) {
          throw new Error(`Graph change ${label} is outside the active strict context scope: person:${id}`);
        }
      }
    }
  };

  for (const change of changes) {
    if (change.op === "update_entity") {
      assertExistingRefAllowed(change.entity, "entity");
      assertDraftReferencesAllowed(change.patch, change.entity.id);
      continue;
    }
    if (change.op === "create_entity") {
      assertDraftReferencesAllowed(change.entity, change.entity.id);
      continue;
    }
    if (allowedRelations && !allowedRelations.has(change.relationType)) {
      throw new Error(`Relation type is outside the active strict context policy: ${change.relationType}`);
    }
    assertExistingRefAllowed(change.source, "relation endpoint");
    assertExistingRefAllowed(change.target, "relation endpoint");
  }
  return { active: true, reasons: unique(reasons) };
}

function previewChanges(
  db: WorkMemoryDatabase,
  proposalId: string,
  payload: GraphChangeProposalPayload
): GraphChangePreviewItem[] {
  const entities = new Map(db.listEntities().map((entity) => [entityKey(entity), entity]));
  const plannedEntities = payload.changes
    .filter((change): change is Extract<GraphChange, { op: "create_entity" }> => change.op === "create_entity")
    .map((change) => change.entity);
  const knownEntityIds = new Set([...entities.values()].map((entity) => entity.id).concat(plannedEntities.map((entity) => entity.id)));
  const knownEntityRefs = new Set([...entities.keys(), ...plannedEntities.map(entityKey)]);
  const relations = new Map<string, RelationShape>(db.listEntityRelations().map((relation) => [relationKey(relation), {
    source: { kind: relation.sourceKind, id: relation.sourceId },
    target: { kind: relation.targetKind, id: relation.targetId },
    relationType: relation.relationType,
    description: relation.description,
    metadata: relation.metadata
  }]));
  const output: GraphChangePreviewItem[] = [];
  for (const [index, change] of payload.changes.entries()) {
    const conflicts: string[] = [];
    if (change.op === "create_entity") {
      const key = entityKey(change.entity);
      const before = entities.get(key);
      const after = entityAfter(before, change.entity, proposalId, payload.evidenceObservationIds);
      conflicts.push(...entityReferenceConflicts(change.entity, key, knownEntityIds, knownEntityRefs));
      const action = conflicts.length > 0 ? "conflict" : before ? (sameEntityFields(before, after) ? "no_op" : "conflict") : "create";
      if (before && action === "conflict") conflicts.push(`Entity already exists with different fields: ${key}`);
      if (!before && conflicts.length === 0) entities.set(key, after);
      output.push({ index, op: change.op, target: key, action, before: record(before), after: record(after), conflicts });
      continue;
    }
    if (change.op === "update_entity") {
      const key = entityKey(change.entity);
      const before = entities.get(key);
      if (!before) {
        conflicts.push(`Entity does not exist: ${key}`);
        output.push({ index, op: change.op, target: key, action: "conflict", conflicts });
        continue;
      }
      const after = entityAfter(before, { ...before, ...change.patch }, proposalId, payload.evidenceObservationIds, true);
      conflicts.push(...entityReferenceConflicts(change.patch, key, knownEntityIds, knownEntityRefs));
      const action = conflicts.length > 0 ? "conflict" : sameEntityFields(before, after) ? "no_op" : "update";
      if (conflicts.length === 0) entities.set(key, after);
      output.push({ index, op: change.op, target: key, action, before: record(before), after: record(after), conflicts });
      continue;
    }
    const relation = canonicalRelation(change);
    const key = relationKey(relation);
    if (entityKey(relation.source) === entityKey(relation.target)) conflicts.push("Self-relations are not allowed.");
    if (!entities.has(entityKey(relation.source))) conflicts.push(`Source entity does not exist: ${entityKey(relation.source)}`);
    if (!entities.has(entityKey(relation.target))) conflicts.push(`Target entity does not exist: ${entityKey(relation.target)}`);
    const before = relations.get(key);
    const after = {
      ...relation,
      description: relation.description ?? before?.description,
      metadata: evidenceMetadata({ ...(before?.metadata ?? {}), ...(relation.metadata ?? {}) }, proposalId, payload.evidenceObservationIds)
    };
    const action = conflicts.length > 0 ? "conflict" : before && sameRelationFields(before, after) ? "no_op" : before ? "update" : "create";
    if (conflicts.length === 0) relations.set(key, after);
    output.push({ index, op: change.op, target: key, action, before: record(before), after: record(after), conflicts });
  }
  return output;
}

function applyGraphChange(
  db: WorkMemoryDatabase,
  proposalId: string,
  evidenceObservationIds: string[],
  change: GraphChange
): void {
  if (change.op === "create_entity") {
    const existing = db.getEntity(change.entity.kind, change.entity.id);
    const next = entityAfter(existing, change.entity, proposalId, evidenceObservationIds);
    if (existing && !sameEntityFields(existing, next)) throw new Error(`Entity already exists: ${entityKey(change.entity)}`);
    if (!existing) db.upsertEntity(next);
    return;
  }
  if (change.op === "update_entity") {
    const existing = db.getEntity(change.entity.kind, change.entity.id);
    if (!existing) throw new Error(`Entity does not exist: ${entityKey(change.entity)}`);
    db.upsertEntity(entityAfter(existing, { ...existing, ...change.patch }, proposalId, evidenceObservationIds, true));
    return;
  }
  const relation = canonicalRelation(change);
  if (!db.getEntity(relation.source.kind, relation.source.id)) throw new Error(`Source entity does not exist: ${entityKey(relation.source)}`);
  if (!db.getEntity(relation.target.kind, relation.target.id)) throw new Error(`Target entity does not exist: ${entityKey(relation.target)}`);
  const existing = db.listEntityRelations(relation.source).find((candidate) => relationKey(candidate) === relationKey(relation));
  db.upsertEntityRelation({
    sourceKind: relation.source.kind,
    sourceId: relation.source.id,
    targetKind: relation.target.kind,
    targetId: relation.target.id,
    relationType: relation.relationType,
    description: relation.description ?? existing?.description,
    metadata: evidenceMetadata({ ...(existing?.metadata ?? {}), ...(relation.metadata ?? {}) }, proposalId, evidenceObservationIds)
  });
}

function normalizeGraphChanges(input: unknown): GraphChange[] {
  if (!Array.isArray(input)) throw new Error("Graph changes must be an array.");
  return input.map((raw, index) => normalizeGraphChange(raw, index));
}

function normalizeGraphChange(input: unknown, index: number): GraphChange {
  if (!plainObject(input)) throw new Error(`Graph change ${index + 1} must be an object.`);
  const op = String(input.op ?? "");
  if (op === "create_entity") {
    if (!plainObject(input.entity)) throw new Error(`Graph change ${index + 1} requires entity.`);
    const entity = normalizeEntityDraft(input.entity);
    assertGraphChangeMutableKind(entity.kind);
    return { op, entity };
  }
  if (op === "update_entity") {
    if (!plainObject(input.entity) || !plainObject(input.patch)) throw new Error(`Graph change ${index + 1} requires entity and patch.`);
    const entity = normalizeEntityRef(input.entity);
    assertGraphChangeMutableKind(entity.kind);
    const patch = normalizeEntityPatch(input.patch);
    if (Object.keys(patch).length === 0) throw new Error(`Graph change ${index + 1} has an empty entity patch.`);
    return { op, entity, patch };
  }
  if (op === "upsert_relation") {
    const source = normalizeEntityRef(input.source);
    const target = normalizeEntityRef(input.target);
    const relationType = assertRelationType(requiredText(input.relationType, `graph change ${index + 1} relation type`));
    if (entityKey(source) === entityKey(target)) throw new Error(`Graph change ${index + 1} cannot create a self-relation.`);
    return {
      op,
      source,
      target,
      relationType,
      description: optionalText(input.description),
      metadata: normalizeMetadata(input.metadata)
    };
  }
  throw new Error(`Unknown graph change operation at index ${index}: ${op || "missing"}.`);
}

function normalizeEntityDraft(input: Record<string, unknown>): GraphEntityDraft {
  const kind = resolveEntityKind(assertEntityKind(input.kind));
  const label = requiredText(input.label, "entity label");
  const id = optionalText(input.id) || normalizeEntityId(label);
  if (!id) throw new Error("Entity id cannot be derived from its label.");
  const status = input.status === undefined ? undefined : String(input.status);
  if (status && !isEntityStatus(status)) throw new Error(`Invalid entity status: ${status}`);
  const focusLevel = input.focusLevel === undefined ? undefined : String(input.focusLevel);
  if (focusLevel && !isEntityFocusLevel(focusLevel)) throw new Error(`Invalid entity focus level: ${focusLevel}`);
  return compact({
    kind,
    id,
    label,
    description: optionalText(input.description),
    aliases: normalizeStrings(input.aliases),
    status,
    parentId: optionalText(input.parentId),
    ownerIds: normalizeStrings(input.ownerIds),
    contributorIds: normalizeStrings(input.contributorIds),
    tags: normalizeStrings(input.tags),
    focusLevel,
    metadata: normalizeMetadata(input.metadata),
    repoPath: optionalText(input.repoPath),
    wikiRoot: optionalText(input.wikiRoot)
  }) as GraphEntityDraft;
}

function normalizeEntityPatch(input: Record<string, unknown>): GraphEntityPatch {
  const draft = normalizeEntityDraft({ ...input, kind: "oneagent", id: "patch", label: input.label ?? "patch" });
  const patch = { ...draft } as Record<string, unknown>;
  delete patch.kind;
  delete patch.id;
  if (input.label === undefined) delete patch.label;
  return patch as GraphEntityPatch;
}

function normalizeEntityRef(input: unknown): EntityRef {
  if (!plainObject(input)) throw new Error("Entity reference must contain kind and id.");
  return {
    kind: resolveEntityKind(assertEntityKind(input.kind)),
    id: requiredText(input.id, "entity id")
  };
}

function requireAcceptedEvidence(db: WorkMemoryDatabase, ids: string[]): ObservationRecord[] {
  const uniqueIds = unique(Array.isArray(ids) ? ids.map(String).filter(Boolean) : []);
  if (uniqueIds.length === 0) throw new Error("At least one accepted observation is required as graph change evidence.");
  return uniqueIds.map((id) => {
    const observation = db.getObservation(id);
    if (!observation) throw new Error(`Evidence observation not found: ${id}`);
    if (observation.validationStatus !== "accepted") {
      throw new Error(`Evidence observation must be accepted: ${id} is ${observation.validationStatus}.`);
    }
    if (observation.metadata.staleSourceRevision === true) {
      throw new Error(`Evidence observation is stale and must be re-extracted from the active source revision: ${id}.`);
    }
    const primarySource = db.getSource(observation.sourceId);
    if (primarySource?.status !== "indexed") {
      throw new Error(
        `Evidence observation ${id} cites a non-indexed primary source: ${observation.sourceId} is ${String(primarySource?.status ?? "missing")}.`
      );
    }
    for (const evidence of db.listObservationEvidence(observation.id)) {
      const source = db.getSource(evidence.sourceId);
      if (source?.status !== "indexed") {
        throw new Error(
          `Evidence observation ${id} cites a non-indexed secondary source: ${evidence.sourceId} is ${String(source?.status ?? "missing")}.`
        );
      }
    }
    return observation;
  });
}

const GRAPH_CHANGE_MUTABLE_BUILTIN_KINDS = new Set([
  "product",
  "repository",
  "project",
  "discovery",
  "feature",
  "feature_request",
  "practice",
  "mission",
  "insight",
  "person"
]);

/**
 * Organization hierarchy kinds keep going through their explicit config flow.
 * Products and repositories may also exist as ordinary graph entities, while
 * configured portfolio products/repositories remain mirrored into the graph.
 */
function assertGraphChangeMutableKind(kind: string): void {
  if (kind === "okr" || kind === "kpi") {
    throw new Error(
      `Graph change proposals cannot create or update outcome entity kind "${kind}" without its structured schema. `
      + `Use the explicit ${kind.toUpperCase()} outcome workflow instead.`
    );
  }
  if (!isBuiltinEntityKind(kind) || GRAPH_CHANGE_MUTABLE_BUILTIN_KINDS.has(kind)) return;
  throw new Error(
    `Graph change proposals cannot create or update configured/structural entity kind "${kind}". `
    + "Use the explicit Organization/configuration flow instead."
  );
}

function requireGraphChangeItem(db: WorkMemoryDatabase, id: string): InboxItem {
  const item = db.getInboxItem(id);
  if (!item) throw new Error(`Graph change proposal not found: ${id}`);
  if (item.type !== "graph_change_proposal") throw new Error(`Inbox item is not a graph change proposal: ${id}`);
  graphChangePayload(item);
  return item;
}

function graphChangePayload(item: InboxItem): GraphChangeProposalPayload {
  const payload = item.payload;
  if (payload.proposalKind !== "graph_change" || Number(payload.schemaVersion) !== 1) {
    throw new Error(`Invalid graph change proposal payload: ${item.id}`);
  }
  const reason = requiredText(payload.reason, "graph change reason");
  const changes = normalizeGraphChanges(payload.changes);
  const evidenceObservationIds = unique(Array.isArray(payload.evidenceObservationIds) ? payload.evidenceObservationIds.map(String) : []).sort();
  const proposalKey = requiredText(payload.proposalKey, "graph change proposal key");
  const decision = plainObject(payload.decision) && (payload.decision.status === "accepted" || payload.decision.status === "rejected")
    ? {
        status: payload.decision.status,
        reason: optionalText(payload.decision.reason),
        decidedAt: requiredText(payload.decision.decidedAt, "graph change decision timestamp")
      }
    : undefined;
  return compact({ proposalKind: "graph_change", schemaVersion: 1, proposalKey, reason, evidenceObservationIds, changes, decision }) as GraphChangeProposalPayload;
}

function entityAfter(
  before: EntityRecord | undefined,
  draft: GraphEntityDraft | (EntityRecord & GraphEntityPatch),
  proposalId: string,
  evidenceObservationIds: string[],
  mergeMetadata = false
): EntityRecord {
  const now = nowIso();
  const metadata = mergeMetadata
    ? { ...(before?.metadata ?? {}), ...(draft.metadata ?? {}) }
    : draft.metadata ?? before?.metadata;
  return {
    id: draft.id,
    kind: draft.kind,
    label: draft.label || before?.label || draft.id,
    description: draft.description,
    aliases: draft.aliases,
    status: draft.status ?? before?.status ?? "active",
    parentId: draft.parentId,
    ownerIds: draft.ownerIds,
    contributorIds: draft.contributorIds,
    tags: draft.tags,
    focusLevel: draft.focusLevel,
    metadata: evidenceMetadata(metadata, proposalId, evidenceObservationIds),
    repoPath: draft.repoPath,
    wikiRoot: draft.wikiRoot,
    createdAt: before?.createdAt ?? now,
    updatedAt: now
  };
}

function entityReferenceConflicts(
  draft: Pick<GraphEntityDraft, "parentId" | "ownerIds" | "contributorIds"> | GraphEntityPatch,
  entityRef: string,
  knownEntityIds: Set<string>,
  knownEntityRefs: Set<string>
): string[] {
  const conflicts: string[] = [];
  if (draft.parentId) {
    if (entityRef.endsWith(`:${draft.parentId}`)) conflicts.push(`Entity cannot be its own parent: ${draft.parentId}`);
    else if (!knownEntityIds.has(draft.parentId)) conflicts.push(`Parent entity does not exist: ${draft.parentId}`);
  }
  for (const [label, ids] of [["Owner", draft.ownerIds], ["Contributor", draft.contributorIds]] as const) {
    for (const id of ids ?? []) {
      if (!knownEntityRefs.has(`person:${id}`)) conflicts.push(`${label} person does not exist: person:${id}`);
    }
  }
  return conflicts;
}

function evidenceMetadata(
  metadata: Record<string, unknown> | undefined,
  proposalId: string,
  evidenceObservationIds: string[]
): Record<string, unknown> {
  const currentProposalIds = Array.isArray(metadata?.graphChangeProposalIds) ? metadata.graphChangeProposalIds.map(String) : [];
  const currentEvidence = Array.isArray(metadata?.evidenceObservationIds) ? metadata.evidenceObservationIds.map(String) : [];
  return {
    ...(metadata ?? {}),
    graphChangeProposalIds: unique([...currentProposalIds, proposalId]).sort(),
    evidenceObservationIds: unique([...currentEvidence, ...evidenceObservationIds]).sort()
  };
}

function canonicalRelation(change: Extract<GraphChange, { op: "upsert_relation" }>) {
  const resolved = resolveRelationType(change.relationType);
  return {
    source: resolved.swapDirection ? change.target : change.source,
    target: resolved.swapDirection ? change.source : change.target,
    relationType: resolved.type,
    description: change.description,
    metadata: change.metadata
  };
}

interface RelationShape {
  source: EntityRef;
  target: EntityRef;
  relationType: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

function entityKey(ref: { kind: string; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

function relationKey(relation: {
  source?: EntityRef;
  target?: EntityRef;
  sourceKind?: string;
  sourceId?: string;
  targetKind?: string;
  targetId?: string;
  relationType: string;
}): string {
  const source = relation.source ?? { kind: relation.sourceKind!, id: relation.sourceId! };
  const target = relation.target ?? { kind: relation.targetKind!, id: relation.targetId! };
  return `${entityKey(source)} --${relation.relationType}--> ${entityKey(target)}`;
}

function sameEntityFields(left: EntityRecord, right: EntityRecord): boolean {
  return stableJson(record(left, ["updatedAt", "createdAt"])) === stableJson(record(right, ["updatedAt", "createdAt"]));
}

function sameRelationFields(left: { description?: string; metadata?: Record<string, unknown> }, right: { description?: string; metadata?: Record<string, unknown> }): boolean {
  return stableJson({ description: left.description, metadata: left.metadata }) === stableJson({ description: right.description, metadata: right.metadata });
}

function graphChangeTitle(changes: GraphChange[]): string {
  return changes.length === 1 ? `Review graph change: ${graphChangeSummary(changes[0])}` : `Review ${changes.length} graph changes`;
}

function graphChangeSummary(change: GraphChange): string {
  if (change.op === "create_entity") return `create ${entityKey(change.entity)} (${change.entity.label})`;
  if (change.op === "update_entity") return `update ${entityKey(change.entity)}`;
  return `upsert ${entityKey(change.source)} --${change.relationType}--> ${entityKey(change.target)}`;
}

function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`A ${label} is required.`);
  return text;
}

function optionalText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = unique(value.map(String).map((item) => item.trim()).filter(Boolean));
  return values.length > 0 ? values : [];
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  return plainObject(value) ? structuredClone(value) : undefined;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function record(value: unknown, excludedKeys: string[] = []): Record<string, unknown> | undefined {
  if (!plainObject(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excludedKeys.includes(key)));
}
