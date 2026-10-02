import { assertEntityKind, createId, resolveEntityKind, sha256, nowIso } from "../../shared/src/index.ts";
import type {
  CaptureRecord,
  CurationPackageRecord,
  EntityKind,
  EntityRef,
  ObservationEvidenceRecord,
  ObservationEventRecord,
  ObservationKind,
  ObservationRecord,
  ObservationRelationRecord,
  WikiSynthesisTarget
} from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";

const OBSERVATION_KINDS = new Set<ObservationKind>([
  "claim", "decision", "question", "task", "risk", "feature_request", "insight", "metric", "relationship"
]);
const WIKI_REASONS = new Set<NonNullable<CurationPackageRecord["wikiReason"]>>([
  "multi_source_synthesis", "specification", "durable_reference", "publication_required"
]);

export interface CurationPackageDetail {
  package: CurationPackageRecord;
  source?: Record<string, unknown>;
  capture?: ReturnType<WorkMemoryDatabase["getCapture"]>;
  observations: Array<ObservationRecord & {
    evidence: ObservationEvidenceRecord[];
    relations: ObservationRelationRecord[];
    events: ObservationEventRecord[];
    staleSourceRevision: boolean;
  }>;
  counts: Record<string, number>;
  wikiAssessment: WikiNeedAssessment;
}

export interface WikiNeedAssessment {
  recommended: boolean;
  reasons: string[];
  acceptedObservations: number;
  distinctSources: number;
}

export interface WikiNeedAssessmentOptions {
  /** Optional hard boundary used by strict agent contexts. */
  allowedObservationIds?: Iterable<string>;
}

export interface ObservationMutationOptions {
  /**
   * Optional hard boundary for agent-triggered mutations. New observations are
   * allowed, but automatic links and evidence recomputations may only touch
   * observations already present in this allowlist.
   */
  allowedObservationIds?: Iterable<string>;
}

export interface WikiSynthesisValidation {
  anchorPackage: CurationPackageRecord;
  evidence: ObservationRecord[];
  target: WikiSynthesisTarget;
  packageIds: string[];
  sourceIds: string[];
  synthesisKey: string;
}

export interface ProposeObservationInput {
  packageId?: string;
  captureId?: string;
  sourceId?: string;
  sourceChunkId?: string;
  kind: ObservationKind;
  title: string;
  body: string;
  excerpt: string;
  subject?: EntityRef;
  /**
   * Explicit proposal path for a subject that does not exist yet. It is kept in
   * metadata for human review and never masquerades as a graph entity reference.
   */
  proposedSubject?: ProposedObservationSubject;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface ProposedObservationSubject {
  kind: EntityKind;
  label: string;
  id?: string;
  reason?: string;
}

export function ensureCurationPackage(
  db: WorkMemoryDatabase,
  input: {
    captureId?: string;
    sourceId?: string;
    title?: string;
    summary?: string;
  }
): CurationPackageRecord {
  const capture = input.captureId ? db.getCapture(input.captureId) : undefined;
  if (input.captureId && !capture) throw new Error(`Capture not found: ${input.captureId}`);
  const sourceId = input.sourceId ?? capture?.sourceId;
  if (!sourceId) throw new Error("A sourceId (or an indexed capture with sourceId) is required for a curation package.");
  const source = db.getSource(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (source.status !== "indexed") {
    throw new Error(`Source ${sourceId} is ${String(source.status ?? "unknown")}; observations require the active indexed revision.`);
  }
  if (capture && capture.sourceId !== sourceId) {
    throw new Error(`Capture ${capture.id} is indexed from ${capture.sourceId ?? "no source"}, not ${sourceId}.`);
  }
  const existing = db.listCurationPackages({ sourceId }).find((candidate) => candidate.status !== "superseded");
  if (existing) {
    if (existing.captureId && capture?.id && existing.captureId !== capture.id) {
      throw new Error(`Source ${sourceId} already belongs to curation package ${existing.id} for capture ${existing.captureId}.`);
    }
    if (input.summary !== undefined || input.title !== undefined) {
      return db.updateCurationPackage(existing.id, { title: input.title ?? existing.title, summary: input.summary });
    }
    return existing;
  }
  return db.createCurationPackage({
    captureId: capture?.id ?? input.captureId,
    sourceId,
    title: input.title?.trim() || capture?.title || String(source.title ?? sourceId),
    summary: input.summary,
    status: "pending",
    wikiDecision: "not_needed",
    wikiEvidenceObservationIds: []
  });
}

export function proposeObservation(
  db: WorkMemoryDatabase,
  input: ProposeObservationInput,
  options: ObservationMutationOptions = {}
): ObservationRecord {
  if (!OBSERVATION_KINDS.has(input.kind)) throw new Error(`Unknown observation kind: ${input.kind}`);
  const title = requiredText(input.title, "observation title");
  const body = requiredText(input.body, "observation statement");
  const requestedExcerpt = requiredText(input.excerpt, "exact source excerpt");
  const packageRecord = input.packageId
    ? requirePackage(db, input.packageId)
    : ensureCurationPackage(db, input);
  const sourceId = input.sourceId ?? packageRecord.sourceId;
  if (sourceId !== packageRecord.sourceId) {
    throw new Error(`Observation source ${sourceId} does not match curation package source ${packageRecord.sourceId}.`);
  }
  requireActiveSource(db, sourceId);
  const scope = validateObservationScope(db, packageRecord, input);
  const capture = scope.captureId ? db.getCapture(scope.captureId) : undefined;
  const subject = resolveObservationSubject(db, sourceId, input.subject, capture);
  const proposedSubject = validateProposedSubject(db, input.proposedSubject ?? input.metadata?.proposedSubject);
  validateSourceEntityScope(db, sourceId, subject, capture);
  const provenance = resolveExactExcerpt(db, sourceId, requestedExcerpt, input.sourceChunkId);
  const confidence = clampConfidence(input.confidence ?? 0.7);
  const fingerprint = observationFingerprint(input.kind, body, subject);
  const polarity = observationPolarity(input.kind, body);
  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    ...(proposedSubject ? { proposedSubject } : {}),
    provenanceVerified: true
  };
  const proposalKey = observationProposalKey({
    kind: input.kind,
    body,
    subject,
    sourceId,
    sourceChunkId: provenance.chunkId,
    excerpt: provenance.excerpt,
    proposedSubject,
    lineageId: typeof metadata.revisesObservationId === "string" ? metadata.revisesObservationId : undefined
  });
  const lineageId = typeof metadata.revisesObservationId === "string" ? metadata.revisesObservationId : undefined;
  return db.runInTransaction(() => {
    const prior = findIdempotentProposal(db, packageRecord.id, proposalKey, {
      kind: input.kind,
      fingerprint,
      polarity,
      sourceId,
      sourceChunkId: provenance.chunkId,
      excerpt: provenance.excerpt,
      lineageId
    });
    if (prior) {
      const allowedObservationIds = observationMutationBoundary(options);
      if (allowedObservationIds && !allowedObservationIds.has(prior.id)) {
        throw new Error("An idempotent observation proposal exists outside the active strict context; expand the boundary before retrying it.");
      }
      db.insertObservationEvent({
        observationId: prior.id,
        action: "evidence_changed",
        actor: "agent",
        reason: "Duplicate observation proposal retry deduplicated."
      });
      return prior;
    }
    const proposedId = createId("observation");
    const created = db.insertObservation({
      id: proposedId,
      packageId: packageRecord.id,
      kind: input.kind,
      title,
      body,
      excerpt: provenance.excerpt,
      sourceId,
      sourceChunkId: provenance.chunkId,
      captureId: scope.captureId,
      subjectKind: subject.kind,
      subjectId: subject.id,
      validationStatus: "proposed",
      evidenceStatus: "standalone",
      proposalKey,
      confidence,
      fingerprint,
      polarity,
      metadata
    });
    if (created.id !== proposedId) {
      db.insertObservationEvent({
        observationId: created.id,
        action: "evidence_changed",
        actor: "agent",
        reason: "Concurrent duplicate observation proposal retry deduplicated."
      });
      return created;
    }
    db.insertObservationEvidence({
      observationId: created.id,
      sourceId,
      sourceChunkId: provenance.chunkId,
      captureId: created.captureId,
      excerpt: provenance.excerpt,
      stance: "neutral",
      confidence
    });
    db.insertObservationEvent({
      observationId: created.id,
      action: "created",
      actor: "agent",
      after: observationSnapshot(created)
    });
    proposeEvidenceLinks(db, created, options);
    refreshPackageStatus(db, packageRecord.id);
    return created;
  });
}

export function getCurationPackageDetail(
  db: WorkMemoryDatabase,
  packageId: string,
  assessmentOptions: WikiNeedAssessmentOptions = {}
): CurationPackageDetail {
  const packageRecord = requirePackage(db, packageId);
  return hydrateCurationPackageDetails(db, [packageRecord], assessmentOptions)[0];
}

export function listCurationPackageDetails(
  db: WorkMemoryDatabase,
  filter: Parameters<WorkMemoryDatabase["listCurationPackages"]>[0] = {},
  assessmentOptions: WikiNeedAssessmentOptions = {}
): CurationPackageDetail[] {
  return hydrateCurationPackageDetails(db, db.listCurationPackages(filter), assessmentOptions);
}

function hydrateCurationPackageDetails(
  db: WorkMemoryDatabase,
  packages: CurationPackageRecord[],
  assessmentOptions: WikiNeedAssessmentOptions
): CurationPackageDetail[] {
  if (packages.length === 0) return [];
  const packageObservations = db.listObservationsForPackages(packages.map((item) => item.id));
  const allowedObservationIds = assessmentOptions.allowedObservationIds
    ? new Set(assessmentOptions.allowedObservationIds)
    : undefined;
  const assessmentUniverse = allowedObservationIds
    ? db.listObservationsByIds([...allowedObservationIds])
    : db.listObservations({ validationStatuses: ["accepted"] });
  const allObservations = [...new Map(
    [...packageObservations, ...assessmentUniverse].map((observation) => [observation.id, observation])
  ).values()];
  const allObservationIds = allObservations.map((observation) => observation.id);
  const evidenceByObservation = groupBy(
    db.listObservationEvidenceForObservations(allObservationIds),
    (evidence) => evidence.observationId
  );
  const detailObservationIds = new Set(packageObservations.map((observation) => observation.id));
  const relationsByObservation = new Map<string, ObservationRelationRecord[]>();
  for (const relation of db.listObservationRelationsForObservations([...detailObservationIds])) {
    if (detailObservationIds.has(relation.sourceObservationId)) {
      pushGrouped(relationsByObservation, relation.sourceObservationId, relation);
    }
    if (relation.targetObservationId !== relation.sourceObservationId && detailObservationIds.has(relation.targetObservationId)) {
      pushGrouped(relationsByObservation, relation.targetObservationId, relation);
    }
  }
  const eventsByObservation = groupBy(
    db.listObservationEventsForObservations([...detailObservationIds]),
    (event) => event.observationId
  );
  const sourcesById = new Map(
    db.listSourcesByIds([
      ...packages.map((item) => item.sourceId),
      ...allObservations.map((observation) => observation.sourceId),
      ...[...evidenceByObservation.values()].flatMap((items) => items.map((evidence) => evidence.sourceId))
    ]).map((source) => [String(source.id), source])
  );
  const capturesById = new Map(
    db.listCapturesByIds(packages.flatMap((item) => item.captureId ? [item.captureId] : []))
      .map((capture) => [capture.id, capture])
  );
  const observationsByPackage = groupBy(packageObservations, (observation) => observation.packageId);

  return packages.map((packageRecord) => {
    const seeds = observationsByPackage.get(packageRecord.id) ?? [];
    const observations = seeds.map((observation) => {
      const evidence = evidenceByObservation.get(observation.id) ?? [];
      return {
        ...observation,
        evidence,
        relations: relationsByObservation.get(observation.id) ?? [],
        events: eventsByObservation.get(observation.id) ?? [],
        staleSourceRevision: observation.metadata.staleSourceRevision === true
          || evidence.some((item) => sourcesById.get(item.sourceId)?.status !== "indexed")
      };
    });
    return {
      package: packageRecord,
      source: sourcesById.get(packageRecord.sourceId),
      capture: packageRecord.captureId ? capturesById.get(packageRecord.captureId) : undefined,
      observations,
      counts: countByValidation(observations),
      wikiAssessment: assessWikiNeedFromSnapshot(
        seeds,
        assessmentUniverse,
        allowedObservationIds,
        evidenceByObservation,
        sourcesById
      )
    };
  });
}

function assessWikiNeedFromSnapshot(
  seed: ObservationRecord[],
  universe: ObservationRecord[],
  allowedObservationIds: Set<string> | undefined,
  evidenceByObservation: Map<string, ObservationEvidenceRecord[]>,
  sourcesById: Map<string, Record<string, unknown>>
): WikiNeedAssessment {
  const isAllowed = (observation: ObservationRecord): boolean =>
    !allowedObservationIds || allowedObservationIds.has(observation.id);
  const isActive = (observation: ObservationRecord): boolean => {
    if (observation.metadata.staleSourceRevision === true) return false;
    if (sourcesById.get(observation.sourceId)?.status !== "indexed") return false;
    return (evidenceByObservation.get(observation.id) ?? []).every((evidence) =>
      sourcesById.get(evidence.sourceId)?.status === "indexed"
    );
  };
  const acceptedSeed = seed.filter((observation) =>
    isAllowed(observation) && observation.validationStatus === "accepted" && isActive(observation)
  );
  const subjectKeys = new Set(acceptedSeed
    .filter((observation) => observation.subjectKind && observation.subjectId)
    .map((observation) => `${observation.subjectKind}:${observation.subjectId}`));
  const relevant = subjectKeys.size === 0
    ? acceptedSeed
    : universe.filter((observation) =>
      isAllowed(observation)
      && observation.validationStatus === "accepted"
      && observation.subjectKind
      && observation.subjectId
      && subjectKeys.has(`${observation.subjectKind}:${observation.subjectId}`)
      && isActive(observation)
    );
  const distinctSources = new Set(relevant.flatMap((observation) => unique([
    observation.sourceId,
    ...(evidenceByObservation.get(observation.id) ?? []).map((evidence) => evidence.sourceId)
  ]).map((sourceId) => {
    const source = sourcesById.get(sourceId)!;
    return logicalSourceKey(source, sourceId);
  }))).size;
  const durable = relevant.filter((observation) => ["decision", "risk", "relationship", "metric"].includes(observation.kind)).length;
  const reasons: string[] = [];
  if (distinctSources >= 2 && relevant.length >= 3) reasons.push("Several source revisions now need a durable synthesis.");
  if (durable >= 3) reasons.push("Several accepted durable findings would benefit from a stable reference.");
  return { recommended: reasons.length > 0, reasons, acceptedObservations: relevant.length, distinctSources };
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) pushGrouped(grouped, keyFor(value), value);
  return grouped;
}

function pushGrouped<T>(grouped: Map<string, T[]>, key: string, value: T): void {
  const current = grouped.get(key) ?? [];
  current.push(value);
  grouped.set(key, current);
}

export function editObservation(
  db: WorkMemoryDatabase,
  observationId: string,
  update: {
    title?: string;
    body?: string;
    kind?: ObservationKind;
    subject?: EntityRef | null;
    confidence?: number;
    reason: string;
  },
  options: ObservationMutationOptions = {}
): ObservationRecord {
  return db.runInTransaction(() => {
    const current = requireObservation(db, observationId);
    assertMutationNeighborhoodInsideBoundary(db, [current.id], options, "Editing this observation");
    const reason = requiredText(update.reason, "edit reason");
    const kind = update.kind ?? current.kind;
    if (!OBSERVATION_KINDS.has(kind)) throw new Error(`Unknown observation kind: ${kind}`);
    const title = update.title === undefined ? current.title : requiredText(update.title, "observation title");
    const body = update.body === undefined ? current.body : requiredText(update.body, "observation statement");
    const requestedSubject = update.subject === undefined
      ? (current.subjectKind && current.subjectId ? { kind: current.subjectKind, id: current.subjectId } : undefined)
      : update.subject ?? undefined;
    const subject = validateExistingSubject(db, requestedSubject);
    const metadata: Record<string, unknown> = { ...current.metadata };
    if (subject) delete metadata.proposedSubject;
    const proposedSubject = subject ? undefined : validateProposedSubject(db, metadata.proposedSubject);
    const terminal = current.validationStatus === "accepted" || current.validationStatus === "rejected" || current.validationStatus === "superseded";
    // Terminal interpretations are immutable. Editing one creates a fresh proposal;
    // only an accepted predecessor gets an explicit, deferred supersession link.
    if (terminal) {
      const replacement = proposeObservation(db, {
        packageId: current.packageId,
        sourceId: current.sourceId,
        sourceChunkId: current.sourceChunkId,
        captureId: current.captureId,
        kind,
        title,
        body,
        excerpt: current.excerpt,
        subject,
        confidence: update.confidence ?? current.confidence,
        metadata: {
          ...metadata,
          revisesObservationId: current.id,
          revisedValidationStatus: current.validationStatus,
          correctionReason: reason
        }
      }, options);
      if (current.validationStatus === "accepted") {
        db.insertObservationRelation({
          sourceObservationId: replacement.id,
          targetObservationId: current.id,
          type: "supersedes",
          status: "proposed",
          confidence: 1,
          reason
        });
      }
      return replacement;
    }
    const affected = evidenceNeighborhood(db, [current.id], options);
    invalidateProposedEvidenceLinks(db, current.id, reason);
    const before = observationSnapshot(current);
    const updated = db.updateObservation(current.id, {
      title,
      body,
      kind,
      subjectKind: subject?.kind,
      subjectId: subject?.id,
      confidence: update.confidence === undefined ? current.confidence : clampConfidence(update.confidence),
      fingerprint: observationFingerprint(kind, body, subject),
      polarity: observationPolarity(kind, body),
      proposalKey: observationProposalKey({
        kind,
        body,
        subject,
        sourceId: current.sourceId,
        sourceChunkId: current.sourceChunkId,
        excerpt: current.excerpt,
        proposedSubject,
        lineageId: typeof current.metadata.revisesObservationId === "string" ? current.metadata.revisesObservationId : undefined
      }),
      validationStatus: "proposed",
      reviewNote: undefined,
      reviewedAt: undefined,
      metadata: { ...metadata, lastEditReason: reason }
    });
    db.insertObservationEvent({
      observationId: updated.id,
      action: kind !== current.kind ? "reclassified" : "edited",
      actor: "human",
      reason,
      before,
      after: observationSnapshot(updated)
    });
    proposeEvidenceLinks(db, updated, options);
    recomputeEvidenceNeighborhood(db, affected, options);
    refreshPackageStatus(db, current.packageId);
    return updated;
  });
}

export function reviewObservation(
  db: WorkMemoryDatabase,
  observationId: string,
  decision: "accepted" | "rejected",
  reason?: string,
  options: ObservationMutationOptions = {}
): ObservationRecord {
  return db.runInTransaction(() => {
    const current = requireObservation(db, observationId);
    if (current.validationStatus === decision) return current;
    assertMutationNeighborhoodInsideBoundary(db, [current.id], options, "Reviewing this observation");
    if (current.validationStatus !== "captured" && current.validationStatus !== "proposed") {
      throw new Error(
        `Observation ${observationId} is ${current.validationStatus}; reviewed observations are immutable. Create a correction instead.`
      );
    }
    if (decision === "accepted") requireObservationEvidenceActive(db, current);
    const affected = evidenceNeighborhood(db, [current.id], options);
    const reviewReason = reason?.trim() || undefined;
    const updated = db.updateObservation(observationId, {
      validationStatus: decision,
      reviewNote: reviewReason,
      reviewedAt: nowIso()
    });
    db.insertObservationEvent({
      observationId,
      action: decision === "accepted" ? "accepted" : "rejected",
      actor: "human",
      reason: reviewReason,
      before: observationSnapshot(current),
      after: observationSnapshot(updated)
    });
    if (decision === "accepted") {
      for (const id of applyAcceptedSupersession(db, updated, options)) affected.add(id);
    }
    recomputeEvidenceNeighborhood(db, affected, options);
    refreshPackageStatus(db, updated.packageId);
    return db.getObservation(updated.id)!;
  });
}

export function reviewCurationPackage(
  db: WorkMemoryDatabase,
  packageId: string,
  input: { acceptObservationIds?: string[]; rejectObservationIds?: string[]; rejectionReason?: string },
  options: ObservationMutationOptions = {}
): CurationPackageDetail {
  const packageRecord = requirePackage(db, packageId);
  const observations = db.listObservations({ packageId });
  const allowed = new Set(observations.map((item) => item.id));
  const accept = unique(input.acceptObservationIds ?? []);
  const reject = unique(input.rejectObservationIds ?? []);
  if (accept.length === 0 && reject.length === 0) throw new Error("Select at least one observation to accept or reject.");
  for (const id of [...accept, ...reject]) {
    if (!allowed.has(id)) throw new Error(`Observation ${id} does not belong to curation package ${packageId}.`);
  }
  if (accept.some((id) => reject.includes(id))) throw new Error("An observation cannot be accepted and rejected in the same review.");
  db.runInTransaction(() => {
    for (const id of accept) reviewObservation(db, id, "accepted", undefined, options);
    for (const id of reject) reviewObservation(db, id, "rejected", input.rejectionReason, options);
    refreshPackageStatus(db, packageRecord.id);
  });
  return getCurationPackageDetail(db, packageRecord.id);
}

export function mergeObservations(
  db: WorkMemoryDatabase,
  observationIds: string[],
  input: { title?: string; body?: string; kind?: ObservationKind; reason: string },
  options: ObservationMutationOptions = {}
): ObservationRecord {
  const ids = unique(observationIds);
  if (ids.length < 2) throw new Error("Select at least two observations to merge.");
  const reason = requiredText(input.reason, "merge reason");
  const originals = ids.map((id) => requireObservation(db, id));
  const primary = originals[0];
  const kind = input.kind ?? primary.kind;
  if (!OBSERVATION_KINDS.has(kind)) throw new Error(`Unknown observation kind: ${kind}`);
  for (const original of originals) requireObservationEvidenceActive(db, original);
  requireMergeScopeCoherent(originals);
  const mergedEvidence = originals.flatMap((original) => db.listObservationEvidence(original.id).map((evidence) => {
    validateCaptureSource(db, evidence.captureId, evidence.sourceId);
    const provenance = resolveExactExcerpt(db, evidence.sourceId, evidence.excerpt, evidence.sourceChunkId);
    return { ...evidence, excerpt: provenance.excerpt, sourceChunkId: provenance.chunkId };
  }));
  const allAccepted = originals.every((item) => item.validationStatus === "accepted");
  return db.runInTransaction(() => {
    assertMutationNeighborhoodInsideBoundary(db, ids, options, "Merging these observations");
    const affected = evidenceNeighborhood(db, ids, options);
    const merged = db.insertObservation({
      packageId: primary.packageId,
      kind,
      title: input.title?.trim() || primary.title,
      body: input.body?.trim() || originals.map((item) => item.body).filter((value, index, values) => values.indexOf(value) === index).join("\n\n"),
      excerpt: primary.excerpt,
      sourceId: primary.sourceId,
      sourceChunkId: primary.sourceChunkId,
      captureId: primary.captureId,
      subjectKind: primary.subjectKind,
      subjectId: primary.subjectId,
      validationStatus: allAccepted ? "accepted" : "proposed",
      evidenceStatus: "standalone",
      confidence: Math.max(...originals.map((item) => item.confidence)),
      fingerprint: observationFingerprint(kind, input.body?.trim() || primary.body, primary.subjectKind && primary.subjectId ? { kind: primary.subjectKind, id: primary.subjectId } : undefined),
      polarity: observationPolarity(kind, input.body?.trim() || primary.body),
      reviewNote: allAccepted ? reason : undefined,
      reviewedAt: allAccepted ? nowIso() : undefined,
      metadata: {
        mergedFrom: ids,
        mergeReason: reason,
        evidenceSourceIds: unique(mergedEvidence.map((item) => item.sourceId))
      }
    });
    for (const evidence of mergedEvidence) {
      db.insertObservationEvidence({ ...evidence, id: undefined, observationId: merged.id });
    }
    for (const original of originals) {
      db.insertObservationRelation({
        sourceObservationId: merged.id,
        targetObservationId: original.id,
        type: "supersedes",
        status: allAccepted ? "accepted" : "proposed",
        confidence: 1,
        reason,
        reviewedAt: allAccepted ? nowIso() : undefined
      });
      if (allAccepted) {
        const superseded = db.updateObservation(original.id, {
          validationStatus: "superseded",
          reviewNote: reason,
          reviewedAt: nowIso()
        });
        db.insertObservationEvent({
          observationId: original.id,
          action: "superseded",
          actor: "human",
          reason,
          before: observationSnapshot(original),
          after: observationSnapshot(superseded)
        });
      }
    }
    db.insertObservationEvent({ observationId: merged.id, action: "merged", actor: "human", reason, after: observationSnapshot(merged) });
    affected.add(merged.id);
    recomputeEvidenceNeighborhood(db, affected, options);
    for (const packageId of unique(originals.map((item) => item.packageId))) refreshPackageStatus(db, packageId);
    return db.getObservation(merged.id)!;
  });
}

export function reviewObservationRelation(
  db: WorkMemoryDatabase,
  input: { sourceObservationId: string; targetObservationId: string; type: ObservationRelationRecord["type"]; decision: "accepted" | "rejected"; reason?: string },
  options: ObservationMutationOptions = {}
): ObservationRelationRecord {
  return db.runInTransaction(() => {
    const source = requireObservation(db, input.sourceObservationId);
    const target = requireObservation(db, input.targetObservationId);
    assertMutationNeighborhoodInsideBoundary(
      db,
      [source.id, target.id],
      options,
      "Reviewing this observation evidence link"
    );
    const existing = db.listObservationRelations(input.sourceObservationId).find((relation) =>
      relation.sourceObservationId === input.sourceObservationId && relation.targetObservationId === input.targetObservationId && relation.type === input.type
    );
    if (!existing) throw new Error("Observation evidence link not found.");
    if (existing.status === input.decision) return existing;
    if (existing.status !== "proposed") {
      throw new Error(`Observation evidence link is already ${existing.status}; reviewed links are immutable.`);
    }
    if (source.validationStatus !== "accepted" || target.validationStatus !== "accepted") {
      throw new Error("Both observations must be accepted before reviewing their evidence link.");
    }
    requireObservationEvidenceActive(db, source);
    requireObservationEvidenceActive(db, target);
    if (input.decision === "rejected" && !input.reason?.trim()) throw new Error("A rejection reason is required.");
    const updated = db.insertObservationRelation({
      ...existing,
      id: existing.id,
      status: input.decision,
      reason: input.reason?.trim() || existing.reason,
      reviewedAt: nowIso()
    });
    recomputeEvidenceStatus(db, input.sourceObservationId);
    recomputeEvidenceStatus(db, input.targetObservationId);
    db.insertObservationEvent({
      observationId: source.id,
      action: "evidence_changed",
      actor: "human",
      reason: `Evidence link ${input.type} ${input.decision}.`
    });
    db.insertObservationEvent({
      observationId: target.id,
      action: "evidence_changed",
      actor: "human",
      reason: `Evidence link ${input.type} ${input.decision}.`
    });
    return updated;
  });
}

export function markObservationMeasured(db: WorkMemoryDatabase, observationId: string, reason: string): ObservationRecord {
  return db.runInTransaction(() => {
    const current = requireObservation(db, observationId);
    if (current.validationStatus !== "accepted") throw new Error("Only an accepted observation can be marked measured.");
    requireObservationEvidenceActive(db, current);
    const note = requiredText(reason, "measurement note");
    const updated = db.updateObservation(observationId, {
      measurement: { note, measuredAt: nowIso() }
    });
    db.insertObservationEvent({ observationId, action: "evidence_changed", actor: "human", reason: note, before: observationSnapshot(current), after: observationSnapshot(updated) });
    return updated;
  });
}

export function setPackageWikiDecision(
  db: WorkMemoryDatabase,
  packageId: string,
  input: {
    decision: "not_needed" | "suggested";
    reason?: CurationPackageRecord["wikiReason"];
    evidenceObservationIds?: string[];
    target?: WikiSynthesisTarget;
  }
): CurationPackageRecord {
  const packageRecord = requirePackage(db, packageId);
  if (input.decision === "not_needed") {
    if (
      packageRecord.wikiDecision === "not_needed" &&
      !packageRecord.wikiReason &&
      packageRecord.wikiEvidenceObservationIds.length === 0 &&
      !packageRecord.wikiTarget &&
      !packageRecord.wikiSynthesisKey
    ) return packageRecord;
    return db.updateCurationPackage(packageId, {
      wikiDecision: "not_needed",
      wikiReason: null,
      wikiEvidenceObservationIds: [],
      wikiTarget: null,
      wikiSynthesisKey: null
    });
  }
  const validated = validateWikiSynthesis(db, packageId, {
    reason: input.reason,
    evidenceObservationIds: input.evidenceObservationIds,
    target: input.target
  });
  const duplicate = db.listCurationPackages().find((candidate) =>
    candidate.id !== packageId && candidate.wikiSynthesisKey === validated.synthesisKey
  );
  if (duplicate) {
    throw new Error(`The same wiki synthesis is already controlled by curation package ${duplicate.id}.`);
  }
  const unchanged = packageRecord.wikiDecision === "suggested" &&
    packageRecord.wikiReason === input.reason &&
    packageRecord.wikiSynthesisKey === validated.synthesisKey &&
    JSON.stringify(packageRecord.wikiTarget) === JSON.stringify(validated.target) &&
    sameStringSet(packageRecord.wikiEvidenceObservationIds, validated.evidence.map((item) => item.id));
  if (unchanged) return packageRecord;
  return db.updateCurationPackage(packageRecord.id, {
    wikiDecision: "suggested",
    wikiReason: input.reason,
    wikiEvidenceObservationIds: validated.evidence.map((item) => item.id),
    wikiTarget: validated.target,
    wikiSynthesisKey: validated.synthesisKey
  });
}

export function validateWikiSynthesis(
  db: WorkMemoryDatabase,
  packageId: string,
  input: {
    reason?: CurationPackageRecord["wikiReason"];
    evidenceObservationIds?: string[];
    target?: WikiSynthesisTarget;
  }
): WikiSynthesisValidation {
  const anchorPackage = requirePackage(db, packageId);
  requireActiveSource(db, anchorPackage.sourceId);
  if (!input.reason || !WIKI_REASONS.has(input.reason)) {
    throw new Error("A supported documentation reason is required before suggesting a wiki page.");
  }
  const evidenceIds = unique(input.evidenceObservationIds ?? []).sort();
  if (evidenceIds.length === 0) throw new Error("At least one accepted observation must justify a wiki suggestion.");
  if (!input.target) throw new Error("A durable wiki target (subject, home and page) is required.");
  const evidence = evidenceIds.map((id) => {
    const observation = requireObservation(db, id);
    if (observation.validationStatus !== "accepted") throw new Error(`Wiki evidence observation must be accepted first: ${id}`);
    requireObservationEvidenceActive(db, observation);
    return observation;
  });
  if (!evidence.some((observation) => observation.packageId === anchorPackage.id)) {
    throw new Error(`At least one wiki evidence observation must belong to anchor package ${anchorPackage.id}.`);
  }
  const target = normalizeWikiSynthesisTarget(db, input.target);
  for (const observation of evidence) {
    if (observation.subjectKind !== target.subject.kind || observation.subjectId !== target.subject.id) {
      throw new Error(
        `Wiki evidence observation ${observation.id} targets ${observation.subjectKind ?? "no subject"}:${observation.subjectId ?? "none"}, not ${target.subject.kind}:${target.subject.id}.`
      );
    }
  }
  const packageIds = unique(evidence.map((item) => item.packageId)).sort();
  if (input.reason === "multi_source_synthesis" && (evidence.length < 2 || packageIds.length < 2)) {
    throw new Error("A multi-source wiki synthesis requires at least two accepted observations from two curation packages.");
  }
  const sourceIds = unique(evidence.flatMap((item) => [
    item.sourceId,
    ...db.listObservationEvidence(item.id).map((record) => record.sourceId)
  ])).sort();
  const synthesisKey = sha256(JSON.stringify({
    reason: input.reason,
    target,
    evidenceObservationIds: evidenceIds
  }));
  return { anchorPackage, evidence, target, packageIds, sourceIds, synthesisKey };
}

/**
 * Retire curation that was reviewed against a capture's previous entity/type
 * classification. Accepted observations remain immutable audit records, but
 * become stale (and therefore unavailable to active context/retrieval);
 * unreviewed proposals are superseded outright.
 *
 * The caller may already own a database transaction. Nested transactions use a
 * savepoint, so a later Markdown write failure rolls this entire change back.
 */
export function invalidateCaptureClassificationCuration(
  db: WorkMemoryDatabase,
  previous: CaptureRecord,
  replacement: CaptureRecord
): number {
  return db.runInTransaction(() => {
    const changedAt = nowIso();
    const beforeClassification = captureClassificationSnapshot(previous);
    const afterClassification = captureClassificationSnapshot(replacement);
    const reason = `Capture classification changed from ${classificationLabel(previous)} to ${classificationLabel(replacement)}.`;
    const affectedObservationIds = new Set<string>();
    let changed = 0;
    const packages = [...new Map([
      ...db.listCurationPackages({ captureId: previous.id }),
      ...(previous.sourceId ? db.listCurationPackages({ sourceId: previous.sourceId }) : [])
    ].map((packageRecord) => [packageRecord.id, packageRecord])).values()];

    for (const packageRecord of packages) {
      if (packageRecord.status === "superseded") continue;
      const observations = db.listObservations({ packageId: packageRecord.id });
      for (const observation of observations) {
        if (observation.validationStatus === "captured" || observation.validationStatus === "proposed") {
          const updated = db.updateObservation(observation.id, {
            validationStatus: "superseded",
            reviewNote: reason,
            reviewedAt: changedAt,
            metadata: {
              ...observation.metadata,
              staleSourceRevision: true,
              staleCaptureClassification: true,
              classificationInvalidation: {
                at: changedAt,
                before: beforeClassification,
                after: afterClassification
              }
            }
          });
          db.insertObservationEvent({
            observationId: observation.id,
            action: "superseded",
            actor: "system",
            reason,
            before: observationSnapshot(observation),
            after: observationSnapshot(updated)
          });
          affectedObservationIds.add(observation.id);
          changed += 1;
          continue;
        }
        if (observation.validationStatus === "accepted" && observation.metadata.staleCaptureClassification !== true) {
          const updated = db.updateObservation(observation.id, {
            metadata: {
              ...observation.metadata,
              staleSourceRevision: true,
              staleCaptureClassification: true,
              classificationInvalidation: {
                at: changedAt,
                before: beforeClassification,
                after: afterClassification
              }
            }
          });
          db.insertObservationEvent({
            observationId: observation.id,
            action: "evidence_changed",
            actor: "system",
            reason,
            before: observationSnapshot(observation),
            after: observationSnapshot(updated)
          });
          affectedObservationIds.add(observation.id);
          changed += 1;
        }
      }
      db.updateCurationPackage(packageRecord.id, {
        status: "superseded",
        reviewedAt: changedAt,
        wikiDecision: "not_needed",
        wikiReason: null,
        wikiEvidenceObservationIds: [],
        wikiTarget: null,
        wikiSynthesisKey: null
      });
    }

    recomputeEvidenceNeighborhood(db, affectedObservationIds);
    return changed;
  });
}

export function markStaleSourceRevisions(db: WorkMemoryDatabase): number {
  return db.runInTransaction(() => {
    let changed = 0;
    const affectedPackages = new Set<string>();
    const directlyAffectedEvidence = new Set<string>();
    const candidates = db.listObservationsWithSupersededSources();
    const evidenceByObservation = groupBy(
      db.listObservationEvidenceForObservations(candidates.map((observation) => observation.id)),
      (evidence) => evidence.observationId
    );
    const sourcesById = new Map(
      db.listSourcesByIds(candidates.flatMap((observation) => [
        observation.sourceId,
        ...(evidenceByObservation.get(observation.id) ?? []).map((evidence) => evidence.sourceId)
      ])).map((source) => [String(source.id), source])
    );
    for (const observation of candidates) {
      const staleSourceIds = unique([
        observation.sourceId,
        ...(evidenceByObservation.get(observation.id) ?? []).map((evidence) => evidence.sourceId)
      ]).filter((sourceId) => ["superseded", "missing"].includes(String(sourcesById.get(sourceId)?.status)));
      if (staleSourceIds.length === 0) continue;
      affectedPackages.add(observation.packageId);
      if (observation.validationStatus === "captured" || observation.validationStatus === "proposed") {
        const updated = db.updateObservation(observation.id, {
          validationStatus: "superseded",
          reviewNote: "Source revision superseded before validation.",
          reviewedAt: nowIso(),
          metadata: { ...observation.metadata, staleSourceRevision: true, staleSourceIds }
        });
        db.insertObservationEvent({
          observationId: observation.id,
          action: "superseded",
          actor: "system",
          reason: "Source revision superseded.",
          before: observationSnapshot(observation),
          after: observationSnapshot(updated)
        });
        changed += 1;
      } else if (observation.validationStatus === "accepted" && !observation.metadata.staleSourceRevision) {
        const updated = db.updateObservation(observation.id, {
          metadata: { ...observation.metadata, staleSourceRevision: true, staleSourceIds }
        });
        db.insertObservationEvent({
          observationId: observation.id,
          action: "evidence_changed",
          actor: "system",
          reason: "Accepted evidence now cites a superseded or missing source revision.",
          before: observationSnapshot(observation),
          after: observationSnapshot(updated)
        });
        directlyAffectedEvidence.add(observation.id);
        changed += 1;
      }
    }
    const affectedEvidence = new Set(directlyAffectedEvidence);
    for (const relation of db.listObservationRelationsForObservations([...directlyAffectedEvidence])) {
      affectedEvidence.add(relation.sourceObservationId);
      affectedEvidence.add(relation.targetObservationId);
    }
    for (const observationId of affectedEvidence) recomputeEvidenceStatus(db, observationId);
    for (const packageRecord of db.listCurationPackagesForStaleRefresh()) {
      affectedPackages.add(packageRecord.id);
    }
    for (const packageId of affectedPackages) refreshPackageStatus(db, packageId);
    return changed;
  });
}

function captureClassificationSnapshot(capture: CaptureRecord): Record<string, unknown> {
  return {
    contentType: capture.contentType,
    primaryEntity: {
      kind: capture.primaryEntityKind,
      id: capture.primaryEntityId
    }
  };
}

function classificationLabel(capture: CaptureRecord): string {
  return `${capture.contentType} at ${capture.primaryEntityKind}:${capture.primaryEntityId}`;
}

export function assessWikiNeed(
  db: WorkMemoryDatabase,
  seed?: ObservationRecord[],
  options: WikiNeedAssessmentOptions = {}
): WikiNeedAssessment {
  const allowedObservationIds = options.allowedObservationIds
    ? new Set(options.allowedObservationIds)
    : undefined;
  const isAllowed = (observation: ObservationRecord): boolean =>
    !allowedObservationIds || allowedObservationIds.has(observation.id);
  const boundedObservations = allowedObservationIds
    ? [...allowedObservationIds].map((id) => db.getObservation(id)).filter((item): item is ObservationRecord => Boolean(item))
    : undefined;
  const acceptedSeed = (seed ?? boundedObservations ?? db.listObservations()).filter((item) =>
    isAllowed(item) && item.validationStatus === "accepted" && observationEvidenceIsActive(db, item)
  );
  const subjectKeys = new Set(acceptedSeed.filter((item) => item.subjectKind && item.subjectId).map((item) => `${item.subjectKind}:${item.subjectId}`));
  const relevant = subjectKeys.size === 0
    ? acceptedSeed
    : (boundedObservations ?? db.listObservations({ validationStatuses: ["accepted"] })).filter((item) =>
        isAllowed(item) && item.subjectKind && item.subjectId &&
        item.validationStatus === "accepted" &&
        subjectKeys.has(`${item.subjectKind}:${item.subjectId}`) &&
        observationEvidenceIsActive(db, item)
      );
  const distinctSources = new Set(relevant.flatMap((item) => activeLogicalSourceKeys(db, item))).size;
  const durable = relevant.filter((item) => ["decision", "risk", "relationship", "metric"].includes(item.kind)).length;
  const reasons: string[] = [];
  if (distinctSources >= 2 && relevant.length >= 3) reasons.push("Several source revisions now need a durable synthesis.");
  if (durable >= 3) reasons.push("Several accepted durable findings would benefit from a stable reference.");
  return { recommended: reasons.length > 0, reasons, acceptedObservations: relevant.length, distinctSources };
}

function proposeEvidenceLinks(
  db: WorkMemoryDatabase,
  observation: ObservationRecord,
  options: ObservationMutationOptions = {}
): void {
  const sourceLogicalKey = logicalSourceKey(requireActiveSource(db, observation.sourceId), observation.sourceId);
  const allowedObservationIds = observationMutationBoundary(options);
  const candidates = allowedObservationIds
    ? [...allowedObservationIds].map((id) => db.getObservation(id)).filter((item): item is ObservationRecord => Boolean(item))
    : db.listObservations();
  const peers = candidates.filter((candidate) =>
    candidate.id !== observation.id &&
    candidate.fingerprint === observation.fingerprint &&
    candidate.validationStatus !== "rejected" &&
    candidate.validationStatus !== "superseded" &&
    observationEvidenceIsActive(db, candidate) &&
    logicalSourceKey(requireActiveSource(db, candidate.sourceId), candidate.sourceId) !== sourceLogicalKey
  );
  for (const peer of peers) {
    const contradicts = observation.polarity !== 0 && peer.polarity !== 0 && observation.polarity !== peer.polarity;
    db.insertObservationRelation({
      sourceObservationId: observation.id,
      targetObservationId: peer.id,
      type: contradicts ? "contradicts" : "supports",
      status: "proposed",
      confidence: Math.min(observation.confidence, peer.confidence),
      reason: contradicts
        ? "Same normalized claim with opposite polarity; requires human review."
        : "Same normalized claim found in a different source; requires human review."
    });
  }
}

function invalidateProposedEvidenceLinks(db: WorkMemoryDatabase, observationId: string, reason: string): void {
  for (const relation of db.listObservationRelations(observationId)) {
    if (relation.status !== "proposed" || relation.type === "supersedes") continue;
    db.insertObservationRelation({
      ...relation,
      status: "rejected",
      reason: `Invalidated by observation edit: ${reason}`,
      reviewedAt: nowIso()
    });
  }
}

function recomputeEvidenceStatus(db: WorkMemoryDatabase, observationId: string): void {
  const observation = requireObservation(db, observationId);
  const accepted = observationEvidenceIsActive(db, observation)
    ? db.listObservationRelations(observationId).filter((relation) => {
        if (relation.status !== "accepted" || (relation.type !== "supports" && relation.type !== "contradicts")) {
          return false;
        }
        const peerId = relation.sourceObservationId === observationId
          ? relation.targetObservationId
          : relation.sourceObservationId;
        const peer = db.getObservation(peerId);
        return peer?.validationStatus === "accepted" && observationEvidenceIsActive(db, peer);
      })
    : [];
  const next = accepted.some((relation) => relation.type === "contradicts")
    ? "contradicted"
    : accepted.some((relation) => relation.type === "supports")
      ? "corroborated"
      : "standalone";
  if (next !== observation.evidenceStatus) {
    db.updateObservation(observationId, { evidenceStatus: next });
    db.insertObservationEvent({ observationId, action: "evidence_changed", actor: "system", reason: `Evidence status recomputed as ${next}.` });
  }
}

function evidenceNeighborhood(
  db: WorkMemoryDatabase,
  observationIds: Iterable<string>,
  options: ObservationMutationOptions = {}
): Set<string> {
  const affected = new Set(observationIds);
  const allowedObservationIds = observationMutationBoundary(options);
  for (const observationId of [...affected]) {
    for (const relation of db.listObservationRelations(observationId)) {
      if (!allowedObservationIds || allowedObservationIds.has(relation.sourceObservationId)) {
        affected.add(relation.sourceObservationId);
      }
      if (!allowedObservationIds || allowedObservationIds.has(relation.targetObservationId)) {
        affected.add(relation.targetObservationId);
      }
    }
  }
  return affected;
}

function recomputeEvidenceNeighborhood(
  db: WorkMemoryDatabase,
  observationIds: Iterable<string>,
  options: ObservationMutationOptions = {}
): void {
  for (const observationId of evidenceNeighborhood(db, observationIds, options)) {
    if (db.getObservation(observationId)) recomputeEvidenceStatus(db, observationId);
  }
}

function applyAcceptedSupersession(
  db: WorkMemoryDatabase,
  replacement: ObservationRecord,
  options: ObservationMutationOptions = {}
): Set<string> {
  const affected = evidenceNeighborhood(db, [replacement.id], options);
  for (const relation of db.listObservationRelations(replacement.id)) {
    if (
      relation.sourceObservationId !== replacement.id ||
      relation.type !== "supersedes" ||
      relation.status !== "proposed"
    ) continue;
    const previous = db.getObservation(relation.targetObservationId);
    if (
      !previous ||
      (previous.validationStatus !== "accepted" &&
        previous.validationStatus !== "captured" &&
        previous.validationStatus !== "proposed")
    ) continue;
    for (const id of evidenceNeighborhood(db, [previous.id], options)) affected.add(id);
    db.insertObservationRelation({ ...relation, status: "accepted", confidence: 1, reviewedAt: nowIso() });
    const superseded = db.updateObservation(previous.id, {
      validationStatus: "superseded",
      reviewNote: relation.reason,
      reviewedAt: nowIso()
    });
    db.insertObservationEvent({
      observationId: previous.id,
      action: "superseded",
      actor: "human",
      reason: relation.reason,
      before: observationSnapshot(previous),
      after: observationSnapshot(superseded)
    });
    refreshPackageStatus(db, previous.packageId);
  }
  return affected;
}

function observationMutationBoundary(options: ObservationMutationOptions): Set<string> | undefined {
  return options.allowedObservationIds ? new Set(options.allowedObservationIds) : undefined;
}

function assertMutationNeighborhoodInsideBoundary(
  db: WorkMemoryDatabase,
  observationIds: Iterable<string>,
  options: ObservationMutationOptions,
  action: string
): void {
  const allowedObservationIds = observationMutationBoundary(options);
  if (!allowedObservationIds) return;
  const pending = [...observationIds];
  const inspected = new Set<string>();
  while (pending.length > 0) {
    const observationId = pending.pop()!;
    if (inspected.has(observationId)) continue;
    inspected.add(observationId);
    if (!allowedObservationIds.has(observationId)) {
      throw new Error(`${action} is outside the active strict observation boundary.`);
    }
    for (const relation of db.listObservationRelations(observationId)) {
      if (relation.status === "rejected") continue;
      const peerId = relation.sourceObservationId === observationId
        ? relation.targetObservationId
        : relation.sourceObservationId;
      if (!allowedObservationIds.has(peerId)) {
        throw new Error(`${action} depends on an observation outside the active strict context; expand the boundary first.`);
      }
      pending.push(peerId);
    }
  }
}

function refreshPackageStatus(db: WorkMemoryDatabase, packageId: string): CurationPackageRecord {
  const packageRecord = requirePackage(db, packageId);
  const observations = db.listObservations({ packageId });
  if (db.getSource(packageRecord.sourceId)?.status === "superseded") {
    return db.updateCurationPackage(packageId, {
      status: "superseded",
      reviewedAt: nowIso(),
      wikiDecision: "not_needed",
      wikiReason: null,
      wikiEvidenceObservationIds: [],
      wikiTarget: null,
      wikiSynthesisKey: null
    });
  }
  let invalidWikiEvidence = false;
  if (packageRecord.wikiDecision === "suggested") {
    try {
      const validated = validateWikiSynthesis(db, packageRecord.id, {
        reason: packageRecord.wikiReason,
        evidenceObservationIds: packageRecord.wikiEvidenceObservationIds,
        target: packageRecord.wikiTarget
      });
      invalidWikiEvidence = validated.synthesisKey !== packageRecord.wikiSynthesisKey;
    } catch {
      invalidWikiEvidence = true;
    }
  }
  const wikiUpdate = invalidWikiEvidence
    ? {
        wikiDecision: "not_needed" as const,
        wikiReason: null,
        wikiEvidenceObservationIds: [],
        wikiTarget: null,
        wikiSynthesisKey: null
      }
    : {};
  if (observations.length === 0) {
    return invalidWikiEvidence ? db.updateCurationPackage(packageId, wikiUpdate) : packageRecord;
  }
  const revisedRejectedIds = new Set(
    observations
      .filter((item) => item.validationStatus !== "rejected" && item.validationStatus !== "superseded")
      .map((item) => item.metadata.revisesObservationId)
      .filter((id): id is string => typeof id === "string")
      .filter((id) => observations.some((item) => item.id === id && item.validationStatus === "rejected"))
  );
  const active = observations.filter((item) =>
    item.validationStatus !== "superseded" && !revisedRejectedIds.has(item.id)
  );
  const accepted = active.filter((item) => item.validationStatus === "accepted").length;
  const rejected = active.filter((item) => item.validationStatus === "rejected").length;
  const pending = active.filter((item) => item.validationStatus === "captured" || item.validationStatus === "proposed").length;
  const status = pending > 0
    ? (accepted > 0 || rejected > 0 ? "partially_accepted" : "pending")
    : accepted > 0 && rejected > 0
      ? "partially_accepted"
      : accepted > 0
        ? "accepted"
        : rejected > 0
          ? "rejected"
          : "accepted";
  return db.updateCurationPackage(packageId, {
    status,
    reviewedAt: pending === 0 ? nowIso() : null,
    ...wikiUpdate
  });
}

function requireActiveSource(db: WorkMemoryDatabase, sourceId: string): Record<string, unknown> {
  const source = db.getSource(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (source.status !== "indexed") {
    throw new Error(
      `Source ${sourceId} is ${String(source.status ?? "unknown")}; use the active indexed revision instead.`
    );
  }
  return source;
}

function logicalSourceKey(source: Record<string, unknown>, fallbackId: string): string {
  return typeof source.logicalKey === "string" && source.logicalKey.trim()
    ? source.logicalKey
    : fallbackId;
}

function observationEvidenceIsActive(db: WorkMemoryDatabase, observation: ObservationRecord): boolean {
  if (observation.metadata.staleSourceRevision) return false;
  if (db.getSource(observation.sourceId)?.status !== "indexed") return false;
  return db.listObservationEvidence(observation.id).every((evidence) =>
    db.getSource(evidence.sourceId)?.status === "indexed"
  );
}

function requireObservationEvidenceActive(db: WorkMemoryDatabase, observation: ObservationRecord): void {
  if (!observationEvidenceIsActive(db, observation)) {
    throw new Error(
      `Observation ${observation.id} cites inactive or superseded evidence and must be re-extracted from active source revisions.`
    );
  }
  const packageRecord = requirePackage(db, observation.packageId);
  if (packageRecord.sourceId !== observation.sourceId) {
    throw new Error(`Observation ${observation.id} source does not match its curation package.`);
  }
  validateCaptureSource(db, observation.captureId, observation.sourceId);
  const capture = observation.captureId ? db.getCapture(observation.captureId) : undefined;
  if (!observation.subjectKind || !observation.subjectId) {
    throw new Error(`Observation ${observation.id} has an incomplete subject reference.`);
  }
  const subject = validateExistingSubject(db, {
    kind: observation.subjectKind,
    id: observation.subjectId
  })!;
  validateSourceEntityScope(db, observation.sourceId, subject, capture);
  const primary = resolveExactExcerpt(db, observation.sourceId, observation.excerpt, observation.sourceChunkId);
  if (primary.excerpt !== observation.excerpt) {
    throw new Error(`Observation ${observation.id} does not store the canonical exact source excerpt and must be re-extracted.`);
  }
  const evidence = db.listObservationEvidence(observation.id);
  if (evidence.length === 0) throw new Error(`Observation ${observation.id} has no source evidence.`);
  for (const item of evidence) {
    validateCaptureSource(db, item.captureId, item.sourceId);
    const evidenceCapture = item.captureId ? db.getCapture(item.captureId) : undefined;
    validateSourceEntityScope(db, item.sourceId, subject, evidenceCapture);
    const provenance = resolveExactExcerpt(db, item.sourceId, item.excerpt, item.sourceChunkId);
    if (provenance.excerpt !== item.excerpt) {
      throw new Error(`Observation evidence ${item.id} does not store the canonical exact source excerpt and must be re-extracted.`);
    }
  }
}

function activeLogicalSourceKeys(db: WorkMemoryDatabase, observation: ObservationRecord): string[] {
  if (!observationEvidenceIsActive(db, observation)) return [];
  const sourceIds = unique([
    observation.sourceId,
    ...db.listObservationEvidence(observation.id).map((evidence) => evidence.sourceId)
  ]);
  return unique(sourceIds.map((sourceId) => {
    const source = requireActiveSource(db, sourceId);
    return logicalSourceKey(source, sourceId);
  }));
}

function validateObservationScope(
  db: WorkMemoryDatabase,
  packageRecord: CurationPackageRecord,
  input: Pick<ProposeObservationInput, "captureId">
): { captureId?: string } {
  const packageCapture = packageRecord.captureId ? db.getCapture(packageRecord.captureId) : undefined;
  if (packageRecord.captureId && !packageCapture) {
    throw new Error(`Curation package capture not found: ${packageRecord.captureId}`);
  }
  if (input.captureId && packageRecord.captureId && input.captureId !== packageRecord.captureId) {
    throw new Error(`Observation capture ${input.captureId} does not match curation package capture ${packageRecord.captureId}.`);
  }
  const captureId = input.captureId ?? packageRecord.captureId;
  const capture = captureId ? db.getCapture(captureId) : undefined;
  if (captureId && !capture) throw new Error(`Capture not found: ${captureId}`);
  validateCaptureSource(db, captureId, packageRecord.sourceId);

  return { captureId };
}

function validateCaptureSource(db: WorkMemoryDatabase, captureId: string | undefined, sourceId: string): void {
  if (!captureId) return;
  const capture = db.getCapture(captureId);
  if (!capture) throw new Error(`Capture not found: ${captureId}`);
  if (capture.sourceId !== sourceId) {
    throw new Error(`Capture ${captureId} is indexed from ${capture.sourceId ?? "no source"}, not ${sourceId}.`);
  }
}

function validateSourceEntityScope(
  db: WorkMemoryDatabase,
  sourceId: string,
  subject: EntityRef,
  capture?: ReturnType<WorkMemoryDatabase["getCapture"]>
): void {
  const sourceEntities = db.listEntityRefsForSource(sourceId);
  if (!sourceEntities.some((entity) => entity.kind === subject.kind && entity.id === subject.id)) {
    throw new Error(`Source ${sourceId} is not linked to entity ${subject.kind}:${subject.id}.`);
  }
  if (capture) {
    const captureEntities = [
      { kind: capture.primaryEntityKind, id: capture.primaryEntityId },
      ...capture.relatedEntities.map((entity) => ({ kind: entity.entityKind, id: entity.entityId }))
    ];
    if (!captureEntities.some((entity) => entity.kind === subject.kind && entity.id === subject.id)) {
      throw new Error(`Capture ${capture.id} is not linked to entity ${subject.kind}:${subject.id}.`);
    }
  }
}

function resolveObservationSubject(
  db: WorkMemoryDatabase,
  sourceId: string,
  requested: EntityRef | undefined,
  capture?: ReturnType<WorkMemoryDatabase["getCapture"]>
): EntityRef {
  const explicit = validateExistingSubject(db, requested);
  if (explicit) return explicit;
  if (capture) {
    return { kind: capture.primaryEntityKind, id: capture.primaryEntityId };
  }
  const linked = db.listEntityRefsForSource(sourceId);
  if (linked.length === 1) return linked[0];
  throw new Error(
    `Observation subject is required because source ${sourceId} is linked to ${linked.length} entities. `
    + "Provide subjectEntity as kind:id."
  );
}

function validateExistingSubject(db: WorkMemoryDatabase, subject?: EntityRef): EntityRef | undefined {
  if (!subject) return undefined;
  const kind = resolveEntityKind(subject.kind);
  const id = requiredText(subject.id, "observation subject id");
  if (!db.getEntity(kind, id)) {
    throw new Error(
      `Observation subject does not exist: ${kind}:${id}. Omit subject and use metadata.proposedSubject for an entity candidate.`
    );
  }
  return { kind, id };
}

function validateProposedSubject(db: WorkMemoryDatabase, value: unknown): ProposedObservationSubject | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata.proposedSubject must be an object with kind and label.");
  }
  const candidate = value as Record<string, unknown>;
  const kind = resolveEntityKind(assertEntityKind(candidate.kind));
  const label = requiredText(candidate.label, "proposed subject label");
  const id = candidate.id === undefined ? undefined : requiredText(candidate.id, "proposed subject id");
  const reason = candidate.reason === undefined ? undefined : requiredText(candidate.reason, "proposed subject reason");
  if (id && db.getEntity(kind, id)) {
    throw new Error(`Proposed subject ${kind}:${id} already exists; use it as the observation subject instead.`);
  }
  return { kind, label, ...(id ? { id } : {}), ...(reason ? { reason } : {}) };
}

function normalizeWikiSynthesisTarget(db: WorkMemoryDatabase, target: WikiSynthesisTarget): WikiSynthesisTarget {
  const subject = validateExistingSubject(db, target.subject);
  const home = validateExistingSubject(db, target.home);
  if (!subject || !home) throw new Error("Wiki target subject and home are required.");
  const page = normalizeWikiPage(target.page);
  return { subject, home, page };
}

function normalizeWikiPage(value: string): string {
  const page = requiredText(value, "wiki target page").replace(/\\/g, "/");
  if (
    page.startsWith("/") ||
    /[\u0000-\u001f<>:"|?*]/.test(page) ||
    page.split("/").some((segment) => segment === ".." || segment === "." || !segment)
  ) {
    throw new Error("Wiki target page must be a safe relative path inside the subject directory.");
  }
  if (!page.toLowerCase().endsWith(".md")) throw new Error("Wiki target page must be a Markdown file.");
  return page;
}

function requireMergeScopeCoherent(observations: ObservationRecord[]): void {
  const subjects = unique(observations.map((item) =>
    item.subjectKind && item.subjectId ? `${item.subjectKind}:${item.subjectId}` : "__none__"
  ));
  if (subjects.length > 1) {
    throw new Error("Observations with different subjects cannot be merged without an explicit synthesis subject.");
  }
}

function resolveExactExcerpt(
  db: WorkMemoryDatabase,
  sourceId: string,
  excerpt: string,
  requestedChunkId?: string
): { chunkId: string; excerpt: string } {
  const locate = (content: string): string | undefined => {
    if (content.includes(excerpt)) return excerpt;
    // Agents often flatten line breaks. Accept that formatting-only variation,
    // but persist the exact original substring from the immutable source.
    const tokens = excerpt.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return undefined;
    const match = content.match(new RegExp(tokens.map(escapeRegExp).join("\\s+")));
    return match?.[0];
  };
  if (requestedChunkId) {
    const chunk = db.getChunk(requestedChunkId);
    if (!chunk) throw new Error(`Source chunk not found: ${requestedChunkId}`);
    if (chunk.sourceId !== sourceId) throw new Error(`Chunk ${requestedChunkId} does not belong to source ${sourceId}.`);
    const canonicalExcerpt = locate(String(chunk.content ?? ""));
    if (!canonicalExcerpt) {
      throw new Error("The supplied excerpt is not present in the referenced source chunk.");
    }
    return { chunkId: requestedChunkId, excerpt: canonicalExcerpt };
  }
  for (const chunk of db.listChunksForSource(sourceId)) {
    const canonicalExcerpt = locate(String(chunk.content ?? ""));
    if (canonicalExcerpt && typeof chunk.id === "string") {
      return { chunkId: chunk.id, excerpt: canonicalExcerpt };
    }
  }
  {
    throw new Error("The supplied excerpt is not present in the indexed source. Provide an exact passage, not a paraphrase.");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function observationProposalKey(input: {
  kind: ObservationKind;
  body: string;
  subject?: EntityRef;
  sourceId: string;
  sourceChunkId?: string;
  excerpt: string;
  proposedSubject?: ProposedObservationSubject;
  lineageId?: string;
}): string {
  return sha256([
    input.kind,
    normalizeWhitespace(input.body).normalize("NFKC").toLowerCase(),
    input.subject
      ? `${input.subject.kind}:${input.subject.id}`
      : input.proposedSubject
        ? `proposed:${input.proposedSubject.kind}:${input.proposedSubject.id ?? input.proposedSubject.label}`
        : "global",
    input.sourceId,
    input.sourceChunkId ?? "",
    input.excerpt,
    input.lineageId ?? "root"
  ].join("|"));
}

function findIdempotentProposal(
  db: WorkMemoryDatabase,
  packageId: string,
  proposalKey: string,
  match: Pick<ObservationRecord, "kind" | "fingerprint" | "polarity" | "sourceId" | "excerpt"> & {
    sourceChunkId?: string;
    lineageId?: string;
  }
): ObservationRecord | undefined {
  const keyed = db.getObservationByProposalKey(packageId, proposalKey);
  if (keyed) return keyed;
  // Adopt a matching pre-migration row so the first retry after upgrade is also
  // idempotent. No historical rows are deleted or merged automatically.
  const legacy = match.lineageId
    ? undefined
    : db.listObservations({ packageId }).find((candidate) =>
        !candidate.proposalKey &&
        candidate.kind === match.kind &&
        candidate.fingerprint === match.fingerprint &&
        candidate.polarity === match.polarity &&
        candidate.sourceId === match.sourceId &&
        candidate.sourceChunkId === match.sourceChunkId &&
        candidate.excerpt === match.excerpt
      );
  return legacy ? db.updateObservation(legacy.id, { proposalKey }) : undefined;
}

function observationFingerprint(kind: ObservationKind, body: string, subject?: EntityRef): string {
  const normalized = normalizeWhitespace(body)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(no|not|never|without|isn't|aren't|doesn't|pas|jamais|aucun|aucune|sans|n'est|ne)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return sha256(`${kind}|${subject ? `${subject.kind}:${subject.id}` : "global"}|${normalized}`);
}

function observationPolarity(kind: ObservationKind, body: string): -1 | 0 | 1 {
  if (kind === "question") return 0;
  return /\b(no|not|never|without|isn't|aren't|doesn't|pas|jamais|aucun|aucune|sans|n'est|ne)\b/i.test(body) ? -1 : 1;
}

function countByValidation(observations: ObservationRecord[]): Record<string, number> {
  const counts: Record<string, number> = { total: observations.length };
  for (const observation of observations) {
    counts[observation.validationStatus] = (counts[observation.validationStatus] ?? 0) + 1;
    counts[observation.evidenceStatus] = (counts[observation.evidenceStatus] ?? 0) + 1;
    if (observation.measurement) counts.measured = (counts.measured ?? 0) + 1;
  }
  return counts;
}

function observationSnapshot(observation: ObservationRecord): Record<string, unknown> {
  return {
    id: observation.id,
    kind: observation.kind,
    title: observation.title,
    body: observation.body,
    subject: observation.subjectKind && observation.subjectId ? `${observation.subjectKind}:${observation.subjectId}` : undefined,
    validationStatus: observation.validationStatus,
    evidenceStatus: observation.evidenceStatus,
    measurement: observation.measurement,
    confidence: observation.confidence
  };
}

function requirePackage(db: WorkMemoryDatabase, id: string): CurationPackageRecord {
  const value = db.getCurationPackage(id);
  if (!value) throw new Error(`Curation package not found: ${id}`);
  return value;
}

function requireObservation(db: WorkMemoryDatabase, id: string): ObservationRecord {
  const value = db.getObservation(id);
  if (!value) throw new Error(`Observation not found: ${id}`);
  return value;
}

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}.`);
  return text;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Observation confidence must be a number between 0 and 1.");
  return Math.max(0, Math.min(1, value));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

function sameStringSet(left: string[], right: string[]): boolean {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
