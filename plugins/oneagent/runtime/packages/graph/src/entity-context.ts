import { resolveScope } from "../../registry/src/index.ts";
import { buildOutcomeSnapshot, type OutcomeSnapshot } from "../../impact/src/index.ts";
import { listTaskReadModel, listTaskReadModelForContext, type TaskReadModelItem } from "../../tasks/src/index.ts";
import type {
  ActiveContext,
  CaptureRecord,
  ContextRelationLabel,
  CurationPackageRecord,
  DiscoveryMetadata,
  EntityRecord,
  EntityRelationRecord,
  GraphViewModel,
  InboxItem,
  ObservationRecord,
  ResolvedContextScope,
  WorkMemoryConfig
} from "../../shared/src/index.ts";
import {
  isMetadataOnlyEntityRef,
  sanitizeEntityForResolvedContext,
  sanitizeRelationForResolvedContext
} from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { buildGraphViewModel } from "./view-model.ts";
import { applyContextScopeToGraphView } from "./context-scope.ts";

const OBJECTIVE_CONTENT_TYPES = new Set(["okr", "strategy", "development_plan", "mission_review"]);

export interface EntityContextInput {
  config: WorkMemoryConfig;
  context: ActiveContext;
  db: WorkMemoryDatabase;
  kind: string;
  id: string;
  include?: string[];
  relation?: string;
  contextScope?: ResolvedContextScope;
  maxNodes?: number;
  maxEdges?: number;
}

export interface EntityContextRelatedEntity {
  kind: string;
  id: string;
  label?: string;
  relation?: string;
  direction?: "outgoing" | "incoming" | "capture";
}

export interface EntityContextObservation extends ObservationRecord {
  sourceTitle?: string;
  sourceRevision?: number;
  staleSourceRevision: boolean;
}

export interface DiscoveryContextModel {
  lifecycle: DiscoveryMetadata;
  interviews: CaptureRecord[];
  evidence: CaptureRecord[];
  insights: EntityContextRelatedEntity[];
  featureRequests: EntityContextRelatedEntity[];
  products: EntityContextRelatedEntity[];
  projects: EntityContextRelatedEntity[];
  people: EntityContextRelatedEntity[];
}

export interface EntityContextModel {
  generatedAt: string;
  entity: { kind: string; id: string; label: string; description?: string; status?: string; focusLevel?: string; ownerIds?: string[]; contributorIds?: string[]; metadata?: Record<string, unknown> };
  summary: {
    tasks: number;
    openTasks: number;
    blockedTasks: number;
    captures: number;
    sources: number;
    inboxPending: number;
    observations: number;
    acceptedObservations: number;
    proposedObservations: number;
    contradictedObservations: number;
    curationPackages: number;
    decisions: number;
    openQuestions: number;
    risks: number;
    objectives: number;
    okrs: number;
    kpis: number;
    relatedEntities: number;
    relatedPeople: number;
  };
  tasks: TaskReadModelItem[];
  captures: CaptureRecord[];
  sources: Array<Record<string, unknown>>;
  inbox: InboxItem[];
  observations: EntityContextObservation[];
  curationPackages: CurationPackageRecord[];
  objectives: CaptureRecord[];
  outcomes: OutcomeSnapshot;
  decisions: CaptureRecord[];
  questions: CaptureRecord[];
  risks: CaptureRecord[];
  relatedEntities: EntityContextRelatedEntity[];
  relations: Array<EntityRelationRecord | ContextRelationLabel>;
  relatedPeople: EntityContextRelatedEntity[];
  discovery?: DiscoveryContextModel;
  graphSlice: GraphViewModel;
  notes: string[];
}

/**
 * Aggregate everything OneAgent knows around a single entity: sourced observations,
 * curation packages, captures, typed relations, objectives/decisions/questions/risks,
 * a focused graph slice, and — for product entities — product-scoped tasks/sources/inbox.
 */
export function buildEntityContext(input: EntityContextInput): EntityContextModel {
  const { db, kind, id } = input;
  const sourceAccess = input.contextScope?.scope.mode === "strict"
    ? input.contextScope.scope.sourceAccess ?? "full"
    : "full";
  const metadataOnlyFocus = isMetadataOnlyEntityRef(input.contextScope, { kind, id });
  const contentPlaneAllowed = sourceAccess !== "none" && !metadataOnlyFocus;
  const include = input.include && input.include.length > 0 ? new Set(input.include) : undefined;
  const want = (section: string): boolean => !include || include.has(section);
  const notes: string[] = [];
  const allowedEntities = input.contextScope
    ? new Set(input.contextScope.entities.map((ref) => `${ref.kind}:${ref.id}`))
    : undefined;
  const allowedCaptures = input.contextScope ? new Set(input.contextScope.captureIds) : undefined;
  const allowedSources = input.contextScope ? new Set(input.contextScope.sourceIds) : undefined;
  const allowedTasks = input.contextScope ? new Set(input.contextScope.taskIds) : undefined;
  const allowedInbox = input.contextScope ? new Set(input.contextScope.inboxItemIds) : undefined;
  const allowedObservations = input.contextScope ? new Set(input.contextScope.observationIds) : undefined;
  const allowedPackages = input.contextScope ? new Set(input.contextScope.curationPackageIds) : undefined;
  const allowedRelations = input.contextScope?.scope.allowedRelationTypes
    ? new Set(input.contextScope.scope.allowedRelationTypes)
    : undefined;

  const entity = sanitizeEntityForResolvedContext(input.contextScope, resolveEntity(input));
  if (metadataOnlyFocus) {
    notes.push("This entity is a metadata-only graph boundary; only its identity and label are available.");
  }

  const allCaptures = contentPlaneAllowed
    ? db.listCapturesForEntity(kind, id).filter((capture) => !allowedCaptures || allowedCaptures.has(capture.id))
    : [];
  const byContentType = (predicate: (type: string) => boolean): CaptureRecord[] =>
    allCaptures.filter((capture) => predicate(capture.contentType));
  const objectives = byContentType((type) => OBJECTIVE_CONTENT_TYPES.has(type));
  const decisions = byContentType((type) => type === "decision");
  // A resolved question is represented by an archived question capture (plus a
  // `resolved` tag for the UI). Historical questions remain in `captures`, but
  // must no longer inflate the actionable open-question count.
  const questions = byContentType((type) => type === "question")
    .filter((capture) => capture.status !== "archived" && capture.status !== "superseded");
  const risks = byContentType((type) => type === "risk");
  const captureIds = new Set(allCaptures.map((capture) => capture.id));
  const observationCandidates = contentPlaneAllowed && want("observations")
    ? (input.contextScope?.scope.mode === "strict"
      ? db.listObservationsByIds(input.contextScope.observationIds)
      : db.listObservationContextCandidates({
          entityRefs: [{ kind, id }]
        }))
      .filter((observation) =>
        observation.subjectKind === kind && observation.subjectId === id
      )
      .filter((observation) => !allowedObservations || allowedObservations.has(observation.id))
    : [];
  const observationSources = new Map(
    db.listSourcesByIds(observationCandidates.map((observation) => observation.sourceId))
      .map((source) => [String(source.id), source])
  );
  const observations = observationCandidates
      .map((observation): EntityContextObservation => {
        const source = observationSources.get(observation.sourceId);
        return sanitizeObservation({
          ...observation,
          sourceTitle: typeof source?.title === "string" ? source.title : undefined,
          sourceRevision: Number.isFinite(Number(source?.revision)) ? Number(source?.revision) : undefined,
          staleSourceRevision: source?.status !== "indexed" || observation.metadata.staleSourceRevision === true
        }, sourceAccess);
      });
  const curationPackages = want("curationPackages")
    ? [...new Set(observations.map((observation) => observation.packageId))]
      .map((packageId) => db.getCurationPackage(packageId))
      .filter((packageRecord): packageRecord is CurationPackageRecord => Boolean(packageRecord))
      .filter((packageRecord) => !allowedPackages || allowedPackages.has(packageRecord.id))
      .map((packageRecord) => sanitizeCurationPackage(packageRecord, sourceAccess))
    : [];

  const rawRelations = metadataOnlyFocus ? [] : db.listEntityRelations({ kind, id }).filter((relation) =>
    (!input.relation || relation.relationType === input.relation) &&
    (!allowedRelations || allowedRelations.has(relation.relationType)) &&
    (!allowedEntities || (
      allowedEntities.has(`${relation.sourceKind}:${relation.sourceId}`) &&
      allowedEntities.has(`${relation.targetKind}:${relation.targetId}`)
    ))
  );
  const relations = rawRelations.map((relation) => sanitizeRelationForResolvedContext(input.contextScope, relation));
  const relatedEntities = collectRelatedEntities(db, kind, id, rawRelations, allCaptures, input.relation, allowedRelations)
    .filter((related) => !allowedEntities || allowedEntities.has(`${related.kind}:${related.id}`))
    .map((related): EntityContextRelatedEntity => {
      if (!isMetadataOnlyEntityRef(input.contextScope, related)) return related;
      return { kind: related.kind, id: related.id, label: related.label ?? related.id };
    });
  const relatedPeople = relatedEntities.filter((related) => related.kind === "person");
  const discovery = kind === "discovery" && !metadataOnlyFocus
    ? buildDiscoveryContext(entity, allCaptures, relatedEntities, sourceAccess)
    : undefined;

  const outcomes = metadataOnlyFocus
    ? emptyOutcomeSnapshot()
    : buildOutcomeSnapshot(db, {
        entity: { kind, id },
        contextScope: input.contextScope
      });
  const outcomeRefs = new Set<string>([`${kind}:${id}`]);
  for (const mission of outcomes.missions) {
    outcomeRefs.add(`mission:${mission.id}`);
    for (const okr of mission.okrs) {
      outcomeRefs.add(`okr:${okr.id}`);
      for (const kpi of okr.kpis) outcomeRefs.add(`kpi:${kpi.id}`);
      for (const contribution of okr.contributions) outcomeRefs.add(`${contribution.work.kind}:${contribution.work.id}`);
    }
  }
  for (const okr of outcomes.standaloneOkrs) {
    outcomeRefs.add(`okr:${okr.id}`);
    for (const kpi of okr.kpis) outcomeRefs.add(`kpi:${kpi.id}`);
    for (const contribution of okr.contributions) outcomeRefs.add(`${contribution.work.kind}:${contribution.work.id}`);
  }

  let tasks: TaskReadModelItem[] = [];
  let sources: Array<Record<string, unknown>> = [];
  let inbox: InboxItem[] = [];
  if (want("tasks") && !metadataOnlyFocus) {
    const entityRefs = [...outcomeRefs].map((ref) => {
      const separator = ref.indexOf(":");
      return { kind: ref.slice(0, separator), id: ref.slice(separator + 1) };
    });
    const boundedTasks = kind !== "product" || input.contextScope?.scope.mode === "strict";
    tasks = (boundedTasks
      ? listTaskReadModelForContext(db, {
          productIds: kind === "product" ? [id] : undefined,
          sourceIds: input.contextScope?.sourceIds,
          entityRefs,
          taskIds: input.contextScope?.scope.mode === "strict" ? input.contextScope.taskIds : undefined
        })
      : listTaskReadModel(db, [id]))
      .filter((task) => !allowedTasks || allowedTasks.has(task.id))
      .filter((task) =>
        (kind === "product" && task.productId === id)
        || task.links.some((link) => outcomeRefs.has(`${link.targetKind}:${link.targetId}`))
      )
      .map((task) => !allowedEntities && !allowedSources
        ? task
        : {
            ...task,
            productId: !allowedEntities || allowedEntities.has(`product:${task.productId}`) ? task.productId : undefined,
            sourceId: sourceAccess === "none"
              ? undefined
              : !allowedSources || (task.sourceId && allowedSources.has(task.sourceId)) ? task.sourceId : undefined,
            links: task.links.filter((link) =>
              (!allowedEntities || allowedEntities.has(`${link.targetKind}:${link.targetId}`))
              && (!allowedRelations || allowedRelations.has(link.relationType))
            )
          });
  }
  if (want("sources") && contentPlaneAllowed) {
    const entitySourceIds = [...new Set([
      ...db.listSourceIdsForEntities([{ kind, id }], ["indexed"]),
      ...allCaptures.map((capture) => capture.sourceId).filter((value): value is string => Boolean(value)),
      ...observations.map((observation) => observation.sourceId)
    ])];
    sources = db.listSourcesByIds(entitySourceIds)
      .filter((source) => !allowedSources || allowedSources.has(String(source.id)))
      .map((source) => sanitizeSourceMetadata(source, sourceAccess));
  }
  if (want("inbox") && contentPlaneAllowed) {
    const inboxCandidates = db.listInboxContextCandidates({
      entityRefs: [...outcomeRefs],
      captureIds: allCaptures.map((capture) => capture.id),
      sourceIds: sources.map((source) => String(source.id)),
      observationIds: observations.map((observation) => observation.id)
    }).filter((item) => item.status === "pending" && (!allowedInbox || allowedInbox.has(item.id)));
    if (inboxCandidates.length > 50) notes.push("Inbox results are limited to the 50 newest in-scope items.");
    inbox = inboxCandidates.slice(0, 50).map((item) => sanitizeInboxItem(item, sourceAccess));
  }

  const unscopedGraphSlice = want("graph") && !metadataOnlyFocus
    ? buildGraphViewModel({
        config: input.config,
        context: input.context,
        db,
        scope: "portfolio",
        includeGraphify: false,
        maxNodes: input.maxNodes ?? 60,
        maxEdges: input.maxEdges ?? 120,
        focus: { kind, id },
        contextScope: input.contextScope
      })
    : emptyGraph(input);
  const graphSlice = input.contextScope
    ? applyContextScopeToGraphView(unscopedGraphSlice, input.contextScope)
    : unscopedGraphSlice;

  return {
    generatedAt: new Date().toISOString(),
    entity,
    summary: {
      tasks: tasks.length,
      openTasks: tasks.filter((task) => task.status === "open" || task.status === "in_progress" || task.status === "ready").length,
      blockedTasks: tasks.filter((task) => task.status === "blocked").length,
      captures: allCaptures.length,
      sources: sources.length,
      inboxPending: inbox.length,
      observations: observations.length,
      acceptedObservations: observations.filter((observation) => observation.validationStatus === "accepted").length,
      proposedObservations: observations.filter((observation) => observation.validationStatus === "captured" || observation.validationStatus === "proposed").length,
      contradictedObservations: observations.filter((observation) => observation.evidenceStatus === "contradicted").length,
      curationPackages: curationPackages.length,
      decisions: decisions.length,
      openQuestions: questions.length,
      risks: risks.length,
      objectives: objectives.length,
      okrs: outcomes.summary.okrs,
      kpis: outcomes.summary.kpis,
      relatedEntities: relatedEntities.length,
      relatedPeople: relatedPeople.length
    },
    tasks,
    captures: want("captures") ? allCaptures.map((capture) => sanitizeCapture(capture, sourceAccess)) : [],
    sources,
    inbox,
    observations,
    curationPackages,
    objectives: objectives.map((capture) => sanitizeCapture(capture, sourceAccess)),
    outcomes,
    decisions: decisions.map((capture) => sanitizeCapture(capture, sourceAccess)),
    questions: questions.map((capture) => sanitizeCapture(capture, sourceAccess)),
    risks: risks.map((capture) => sanitizeCapture(capture, sourceAccess)),
    relatedEntities,
    relations,
    relatedPeople,
    discovery,
    graphSlice,
    notes
  };
}

function emptyOutcomeSnapshot(): OutcomeSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    missions: [],
    standaloneOkrs: [],
    kpis: [],
    alerts: [],
    summary: { missions: 0, okrs: 0, atRiskOkrs: 0, kpis: 0, kpisChanged: 0, staleKpis: 0, workWithoutMeasurement: 0 }
  };
}

type EntityContextSourceAccess = "none" | "metadata" | "snippets" | "full";

function sanitizeCapture(capture: CaptureRecord, access: EntityContextSourceAccess): CaptureRecord {
  if (access === "full") return capture;
  const sanitized = { ...capture } as CaptureRecord & Record<string, unknown>;
  delete sanitized.path;
  delete sanitized.contentHash;
  delete sanitized.error;
  if (access === "metadata") {
    delete sanitized.curationSummary;
  } else if (sanitized.curationSummary) {
    sanitized.curationSummary = sanitized.curationSummary.slice(0, 2_000);
  }
  return sanitized;
}

function sanitizeObservation(
  observation: EntityContextObservation,
  access: EntityContextSourceAccess
): EntityContextObservation {
  if (access === "full") return observation;
  const sanitized: Record<string, unknown> = { ...observation };
  if (access === "metadata") {
    delete sanitized.body;
    delete sanitized.excerpt;
    delete sanitized.reviewNote;
    delete sanitized.metadata;
    const measurement = observation.measurement;
    if (measurement) sanitized.measurement = { ...measurement, note: "" };
  } else {
    sanitized.title = observation.title.slice(0, 500);
    sanitized.body = observation.body.slice(0, 2_000);
    sanitized.excerpt = observation.excerpt.slice(0, 1_000);
    sanitized.reviewNote = observation.reviewNote?.slice(0, 1_000);
    sanitized.metadata = boundedObject(observation.metadata, 1_000);
    if (observation.measurement) {
      sanitized.measurement = { ...observation.measurement, note: observation.measurement.note.slice(0, 1_000) };
    }
  }
  return sanitized as unknown as EntityContextObservation;
}

function sanitizeCurationPackage(
  packageRecord: CurationPackageRecord,
  access: EntityContextSourceAccess
): CurationPackageRecord {
  if (access === "full") return packageRecord;
  const sanitized = { ...packageRecord } as CurationPackageRecord & Record<string, unknown>;
  if (access === "metadata") delete sanitized.summary;
  else if (sanitized.summary) sanitized.summary = sanitized.summary.slice(0, 2_000);
  return sanitized;
}

function sanitizeInboxItem(item: InboxItem, access: EntityContextSourceAccess): InboxItem {
  if (access === "full") return item;
  const sanitized: Record<string, unknown> = { ...item };
  if (access === "metadata") {
    delete sanitized.body;
    sanitized.payload = inboxMetadata(item.payload);
  } else {
    sanitized.body = item.body.slice(0, 2_000);
    sanitized.payload = boundedObject(item.payload, 1_000);
  }
  return sanitized as unknown as InboxItem;
}

function inboxMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "proposalKind", "schemaVersion", "proposalKey", "curationPackageId", "observationIds",
    "captureId", "sourceId", "productId", "wikiSubject", "wikiHome", "wikiPage", "wikiSynthesisKey"
  ];
  return Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
}

function sanitizeSourceMetadata(
  source: Record<string, unknown>,
  access: EntityContextSourceAccess
): Record<string, unknown> {
  if (access === "full") return source;
  const allowed = ["id", "title", "sourceType", "origin", "status", "capturedAt", "updatedAt", "language", "chunkCount"];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function boundedObject(
  value: Record<string, unknown>,
  stringLimit: number,
  budget: { remaining: number } = { remaining: 4_000 }
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).slice(0, 50).flatMap(([key, item]) => {
      if (budget.remaining <= 0) return [];
      return [[key, boundedValue(item, stringLimit, budget)]];
    })
  );
}

function boundedValue(value: unknown, stringLimit: number, budget: { remaining: number } = { remaining: 4_000 }): unknown {
  if (typeof value === "string") {
    const bounded = value.slice(0, Math.min(stringLimit, budget.remaining));
    budget.remaining -= bounded.length;
    return bounded;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => boundedValue(item, stringLimit, budget));
  if (value && typeof value === "object") return boundedObject(value as Record<string, unknown>, stringLimit, budget);
  return value;
}

function resolveEntity(input: EntityContextInput): EntityContextModel["entity"] {
  const dbEntity: EntityRecord | undefined = input.db.getEntity(input.kind, input.id);
  if (dbEntity) {
    return {
      kind: dbEntity.kind,
      id: dbEntity.id,
      label: dbEntity.label,
      description: dbEntity.description,
      status: dbEntity.status,
      focusLevel: dbEntity.focusLevel,
      ownerIds: dbEntity.ownerIds,
      contributorIds: dbEntity.contributorIds,
      metadata: dbEntity.metadata
    };
  }
  if (input.kind === "product") {
    const product = input.config.products.find((candidate) => candidate.id === input.id);
    if (product) {
      return { kind: "product", id: product.id, label: product.label, description: product.description, status: "active" };
    }
  }
  const orgEntity = (input.config.entities ?? []).find((candidate) => candidate.id === input.id && candidate.kind === input.kind);
  if (orgEntity) {
    return { kind: orgEntity.kind, id: orgEntity.id, label: orgEntity.label, description: orgEntity.description, status: "active" };
  }
  return { kind: input.kind, id: input.id, label: input.id, status: "unknown" };
}

function buildDiscoveryContext(
  entity: EntityContextModel["entity"],
  captures: CaptureRecord[],
  relatedEntities: EntityContextRelatedEntity[],
  sourceAccess: EntityContextSourceAccess
): DiscoveryContextModel {
  const metadata = entity.metadata?.discovery;
  const lifecycle: DiscoveryMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as DiscoveryMetadata
    : { schemaVersion: 1, phase: "framing" };
  const interviews = captures
    .filter((capture) => capture.contentType === "user_interview")
    .map((capture) => sanitizeCapture(capture, sourceAccess));
  const evidence = captures
    .filter((capture) => !["decision", "risk", "question", "user_interview"].includes(capture.contentType))
    .map((capture) => sanitizeCapture(capture, sourceAccess));
  const byKind = (kind: string): EntityContextRelatedEntity[] => relatedEntities.filter((entity) => entity.kind === kind);
  return {
    lifecycle,
    interviews,
    evidence,
    insights: byKind("insight"),
    featureRequests: byKind("feature_request"),
    products: byKind("product"),
    projects: byKind("project"),
    people: byKind("person")
  };
}

function collectRelatedEntities(
  db: WorkMemoryDatabase,
  kind: string,
  id: string,
  relations: EntityRelationRecord[],
  captures: CaptureRecord[],
  relationFilter?: string,
  allowedRelations?: Set<string>
): EntityContextRelatedEntity[] {
  const seen = new Map<string, EntityContextRelatedEntity>();
  const add = (entry: EntityContextRelatedEntity): void => {
    const key = `${entry.kind}:${entry.id}:${entry.relation}:${entry.direction}`;
    if (!seen.has(key)) {
      seen.set(key, { ...entry, label: db.getEntity(entry.kind, entry.id)?.label });
    }
  };

  for (const relation of relations) {
    if (relation.sourceKind === kind && relation.sourceId === id) {
      add({ kind: relation.targetKind, id: relation.targetId, relation: relation.relationType, direction: "outgoing" });
    } else if (relation.targetKind === kind && relation.targetId === id) {
      add({ kind: relation.sourceKind, id: relation.sourceId, relation: relation.relationType, direction: "incoming" });
    }
  }

  for (const capture of captures) {
    const isPrimary = capture.primaryEntityKind === kind && capture.primaryEntityId === id;
    for (const related of capture.relatedEntities) {
      if (allowedRelations && !allowedRelations.has(related.relationType)) {
        continue;
      }
      if (relationFilter && related.relationType !== relationFilter) {
        continue;
      }
      if (isPrimary) {
        add({ kind: related.entityKind, id: related.entityId, relation: related.relationType, direction: "capture" });
      } else if (related.entityKind === kind && related.entityId === id) {
        add({ kind: capture.primaryEntityKind, id: capture.primaryEntityId, relation: related.relationType, direction: "capture" });
      }
    }
  }

  return [...seen.values()];
}

function emptyGraph(input: EntityContextInput): GraphViewModel {
  const scope = resolveScope(input.config, input.context, { scope: "portfolio" });
  return {
    scope: scope.scope,
    includedProductIds: scope.includedProductIds,
    generatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
    diagnostics: []
  };
}
