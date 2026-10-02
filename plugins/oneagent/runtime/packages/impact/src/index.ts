import {
  normalizeEntityId,
  type EntityRecord,
  type EntityRef,
  type ResolvedContextScope
} from "../../shared/src/index.ts";
import type {
  KpiMeasurementRecord,
  TaskLinkRecord,
  WorkMemoryDatabase
} from "../../storage/src/index.ts";

export type OkrStatus = "draft" | "active" | "at_risk" | "off_track" | "achieved" | "closed";
export type KeyResultStatus = "not_started" | "on_track" | "at_risk" | "off_track" | "achieved";
export type KpiDirection = "increase" | "decrease" | "target" | "range";
export type KpiTrend = "improving" | "worsening" | "stable" | "unknown";

export interface OkrKeyResult {
  id: string;
  title: string;
  status: KeyResultStatus;
  progress?: number;
  baselineValue?: number;
  currentValue?: number;
  targetValue?: number;
  unit?: string;
  dueDate?: string;
  kpiId?: string;
}

export interface OkrDefinition {
  schema: "okr.v1";
  status: OkrStatus;
  periodStart?: string;
  periodEnd?: string;
  keyResults: OkrKeyResult[];
}

export interface KpiDefinition {
  schema: "kpi.v1";
  unit: string;
  direction: KpiDirection;
  targetValue?: number;
  targetMin?: number;
  targetMax?: number;
  staleAfterDays: number;
}

export interface UpsertOkrInput {
  id: string;
  label: string;
  objective?: string;
  /** undefined keeps the current mission, null explicitly detaches it. */
  missionId?: string | null;
  status?: OkrStatus;
  periodStart?: string;
  periodEnd?: string;
  keyResults?: OkrKeyResult[];
  kpiIds?: string[];
}

export interface UpsertKpiInput {
  id: string;
  label: string;
  description?: string;
  unit: string;
  direction: KpiDirection;
  targetValue?: number;
  targetMin?: number;
  targetMax?: number;
  staleAfterDays?: number;
  okrIds?: string[];
}

export interface ContributionInput {
  work: EntityRef;
  okrId: string;
  expectedImpact: string;
  causalHypothesis?: string;
  keyResultIds?: string[];
  confidence?: number;
}

export interface ContributionSummary {
  work: EntityRef & { label: string };
  okrId: string;
  expectedImpact: string;
  causalHypothesis?: string;
  keyResultIds: string[];
  confidence: number;
}

export interface KpiSummary {
  id: string;
  label: string;
  description?: string;
  lifecycleStatus: EntityRecord["status"];
  definition: KpiDefinition;
  measurements: KpiMeasurementRecord[];
  latest?: KpiMeasurementRecord;
  previous?: KpiMeasurementRecord;
  change?: number;
  changePercent?: number;
  trend: KpiTrend;
  targetMet?: boolean;
  stale: boolean;
}

export interface OkrSummary {
  id: string;
  label: string;
  objective?: string;
  mission?: EntityRef & { label: string };
  definition: OkrDefinition;
  keyResults: OkrKeyResult[];
  progress?: number;
  atRisk: boolean;
  riskReasons: string[];
  kpis: KpiSummary[];
  contributions: ContributionSummary[];
}

export interface MissionOutcomeSummary {
  id: string;
  label: string;
  description?: string;
  okrs: OkrSummary[];
  progress?: number;
  atRiskOkrs: number;
}

export interface OutcomeAlert {
  kind: "okr_without_work" | "okr_without_kpi" | "feature_without_measurement" | "kpi_without_data" | "kpi_stale" | "kpi_worsening" | "kpi_off_target";
  severity: "info" | "warning" | "critical";
  entity: EntityRef & { label: string };
  message: string;
}

export interface OutcomeSnapshot {
  generatedAt: string;
  missions: MissionOutcomeSummary[];
  standaloneOkrs: OkrSummary[];
  kpis: KpiSummary[];
  alerts: OutcomeAlert[];
  summary: {
    missions: number;
    okrs: number;
    atRiskOkrs: number;
    kpis: number;
    kpisChanged: number;
    staleKpis: number;
    workWithoutMeasurement: number;
  };
}

export interface OutcomeSnapshotOptions {
  now?: Date;
  contextScope?: ResolvedContextScope;
  entity?: EntityRef;
  measurementLimit?: number;
}

const OKR_STATUSES = new Set<OkrStatus>(["draft", "active", "at_risk", "off_track", "achieved", "closed"]);
const KR_STATUSES = new Set<KeyResultStatus>(["not_started", "on_track", "at_risk", "off_track", "achieved"]);
const KPI_DIRECTIONS = new Set<KpiDirection>(["increase", "decrease", "target", "range"]);
const WORK_KINDS = new Set(["project", "feature", "task"]);

export function upsertOkr(db: WorkMemoryDatabase, input: UpsertOkrInput): OkrSummary {
  const id = requireId(input.id, "OKR");
  const label = requireText(input.label, "OKR label");
  const existing = db.getEntity("okr", id);
  const existingKpiIds = existing
    ? db.listEntityRelations({ kind: "okr", id })
      .filter((candidate) =>
        candidate.relationType === "measured_by"
        && candidate.sourceKind === "okr"
        && candidate.sourceId === id
        && candidate.targetKind === "kpi"
      )
      .map((candidate) => candidate.targetId)
    : [];
  const current = readOkrDefinition(existing);
  const definition: OkrDefinition = {
    schema: "okr.v1",
    status: normalizeOkrStatus(input.status ?? current.status),
    periodStart: normalizeOptionalDate(input.periodStart ?? current.periodStart, "OKR period start"),
    periodEnd: normalizeOptionalDate(input.periodEnd ?? current.periodEnd, "OKR period end"),
    keyResults: input.keyResults === undefined
      ? current.keyResults
      : normalizeKeyResults(input.keyResults)
  };
  if (definition.periodStart && definition.periodEnd && definition.periodStart > definition.periodEnd) {
    throw new Error("OKR period start must not be after period end.");
  }
  if (input.missionId) requireEntity(db, "mission", input.missionId);
  const kpiIds = [...new Set([
    ...(input.kpiIds ?? existingKpiIds),
    ...definition.keyResults.map((item) => item.kpiId).filter((value): value is string => Boolean(value))
  ])];
  for (const kpiId of kpiIds) requireEntity(db, "kpi", kpiId);

  db.runInTransaction(() => {
    db.upsertEntity({
      id,
      kind: "okr",
      label,
      description: input.objective,
      metadata: withOutcomeMetadata(existing, definition)
    });
    if (input.missionId !== undefined) {
      for (const relation of db.listEntityRelations({ kind: "okr", id }).filter((candidate) =>
        candidate.relationType === "has_okr" && candidate.targetKind === "okr" && candidate.targetId === id
      )) {
        if (relation.sourceKind !== "mission" || relation.sourceId !== input.missionId) db.deleteEntityRelation(relation.id);
      }
    }
    if (input.missionId) {
      db.upsertEntityRelation({
        sourceKind: "mission",
        sourceId: input.missionId,
        targetKind: "okr",
        targetId: id,
        relationType: "has_okr"
      });
    }
    if (input.kpiIds !== undefined || input.keyResults !== undefined) {
      for (const relation of db.listEntityRelations({ kind: "okr", id }).filter((candidate) =>
        candidate.relationType === "measured_by"
        && candidate.sourceKind === "okr"
        && candidate.sourceId === id
        && candidate.targetKind === "kpi"
      )) {
        if (!kpiIds.includes(relation.targetId)) db.deleteEntityRelation(relation.id);
      }
    }
    for (const kpiId of kpiIds) {
      db.upsertEntityRelation({
        sourceKind: "okr",
        sourceId: id,
        targetKind: "kpi",
        targetId: kpiId,
        relationType: "measured_by"
      });
    }
  });
  return requireOkrSummary(buildOutcomeSnapshot(db, { entity: { kind: "okr", id } }), id);
}

export function upsertKpi(db: WorkMemoryDatabase, input: UpsertKpiInput): KpiSummary {
  const id = requireId(input.id, "KPI");
  const label = requireText(input.label, "KPI label");
  if (!KPI_DIRECTIONS.has(input.direction)) throw new Error(`Invalid KPI direction: ${input.direction}.`);
  const staleAfterDays = Math.max(1, Math.min(3_650, Math.floor(input.staleAfterDays ?? 30)));
  const definition: KpiDefinition = {
    schema: "kpi.v1",
    unit: requireText(input.unit, "KPI unit"),
    direction: input.direction,
    targetValue: finiteOptional(input.targetValue, "KPI target value"),
    targetMin: finiteOptional(input.targetMin, "KPI target minimum"),
    targetMax: finiteOptional(input.targetMax, "KPI target maximum"),
    staleAfterDays
  };
  validateKpiTarget(definition);
  for (const okrId of input.okrIds ?? []) requireEntity(db, "okr", okrId);
  const existing = db.getEntity("kpi", id);
  if (input.okrIds !== undefined) {
    const requestedOkrIds = new Set(input.okrIds);
    for (const relation of db.listEntityRelations({ kind: "kpi", id }).filter((candidate) =>
      candidate.relationType === "measured_by"
      && candidate.sourceKind === "okr"
      && candidate.targetKind === "kpi"
      && candidate.targetId === id
      && !requestedOkrIds.has(candidate.sourceId)
    )) {
      const okr = db.getEntity("okr", relation.sourceId);
      const referencingKeyResult = readOkrDefinition(okr).keyResults.find((item) => item.kpiId === id);
      if (referencingKeyResult) {
        throw new Error(
          `Cannot detach KPI ${id} from OKR ${relation.sourceId}: key result ${referencingKeyResult.id} still references it. Update the OKR key results first.`
        );
      }
    }
  }
  db.runInTransaction(() => {
    db.upsertEntity({
      id,
      kind: "kpi",
      label,
      description: input.description,
      metadata: withOutcomeMetadata(existing, definition)
    });
    if (input.okrIds !== undefined) {
      const requestedOkrIds = new Set(input.okrIds);
      for (const relation of db.listEntityRelations({ kind: "kpi", id }).filter((candidate) =>
        candidate.relationType === "measured_by"
        && candidate.sourceKind === "okr"
        && candidate.targetKind === "kpi"
        && candidate.targetId === id
      )) {
        if (!requestedOkrIds.has(relation.sourceId)) db.deleteEntityRelation(relation.id);
      }
    }
    for (const okrId of input.okrIds ?? []) {
      db.upsertEntityRelation({
        sourceKind: "okr",
        sourceId: okrId,
        targetKind: "kpi",
        targetId: id,
        relationType: "measured_by"
      });
    }
  });
  return buildKpiSummary(db.getEntity("kpi", id)!, db.listKpiMeasurements(id), new Date());
}

export function recordKpiMeasurement(
  db: WorkMemoryDatabase,
  input: {
    kpiId: string;
    value: number;
    measuredAt?: string;
    sourceId?: string;
    observationId?: string;
    note?: string;
  }
): KpiMeasurementRecord {
  requireEntity(db, "kpi", input.kpiId);
  if (input.sourceId && !db.getSource(input.sourceId)) throw new Error(`Source not found: ${input.sourceId}`);
  if (input.observationId) {
    const observation = db.getObservation(input.observationId);
    if (!observation) throw new Error(`Observation not found: ${input.observationId}`);
    if (observation.validationStatus !== "accepted") {
      throw new Error(`KPI measurement observation must be accepted: ${input.observationId}`);
    }
    if (input.sourceId && observation.sourceId !== input.sourceId) {
      throw new Error("KPI measurement source does not match its accepted observation.");
    }
    input = { ...input, sourceId: input.sourceId ?? observation.sourceId };
  }
  return db.upsertKpiMeasurement({
    kpiId: input.kpiId,
    value: input.value,
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    sourceId: input.sourceId,
    observationId: input.observationId,
    note: input.note
  });
}

export function linkContribution(db: WorkMemoryDatabase, input: ContributionInput): ContributionSummary {
  if (!WORK_KINDS.has(input.work.kind)) {
    throw new Error("A contribution must originate from a project, feature or task.");
  }
  const okr = requireEntity(db, "okr", input.okrId);
  const definition = readOkrDefinition(okr);
  const keyResultIds = [...new Set(input.keyResultIds ?? [])];
  const knownKeyResults = new Set(definition.keyResults.map((item) => item.id));
  for (const id of keyResultIds) {
    if (!knownKeyResults.has(id)) throw new Error(`Unknown key result ${id} on OKR ${input.okrId}.`);
  }
  const expectedImpact = requireText(input.expectedImpact, "expected impact");
  const confidence = finiteOptional(input.confidence ?? 1, "contribution confidence")!;
  if (confidence < 0 || confidence > 1) throw new Error("Contribution confidence must be between 0 and 1.");
  const metadata = {
    outcome: {
      schema: "contribution.v1",
      expectedImpact,
      causalHypothesis: optionalText(input.causalHypothesis),
      keyResultIds,
      confidence
    }
  };
  if (input.work.kind === "task") {
    const task = db.getTask(input.work.id);
    if (!task) throw new Error(`Task not found: ${input.work.id}`);
    db.upsertTaskLink({
      taskId: input.work.id,
      relationType: "contributes_to",
      targetKind: "okr",
      targetId: input.okrId,
      label: expectedImpact,
      metadata
    });
    return contributionFromTaskLink(db.listTaskLinks([input.work.id]).find((link) =>
      link.relationType === "contributes_to" && link.targetKind === "okr" && link.targetId === input.okrId
    )!, task.title);
  }
  const work = requireEntity(db, input.work.kind, input.work.id);
  const relation = db.upsertEntityRelation({
    sourceKind: input.work.kind,
    sourceId: input.work.id,
    targetKind: "okr",
    targetId: input.okrId,
    relationType: "contributes_to",
    description: expectedImpact,
    metadata
  });
  return contributionFromRelation(relation, work.label);
}

export function buildOutcomeSnapshot(db: WorkMemoryDatabase, options: OutcomeSnapshotOptions = {}): OutcomeSnapshot {
  const now = options.now ?? new Date();
  const strict = options.contextScope?.scope.mode === "strict";
  const allowedEntities = strict
    ? new Set(options.contextScope!.entities.map((item) => `${item.kind}:${item.id}`))
    : undefined;
  const allowedTasks = strict ? new Set(options.contextScope!.taskIds) : undefined;
  const allowedRelationTypes = strict && options.contextScope!.scope.allowedRelationTypes
    ? new Set(options.contextScope!.scope.allowedRelationTypes)
    : undefined;
  const allows = (kind: string, id: string): boolean => !allowedEntities || allowedEntities.has(`${kind}:${id}`);
  const relationAllowed = (relationType: string): boolean => !allowedRelationTypes || allowedRelationTypes.has(relationType);
  const scopedOutcomeEntities = strict
    ? db.listEntitiesByRefs(options.contextScope!.entities.filter((item) => item.kind === "mission" || item.kind === "okr" || item.kind === "kpi"))
    : undefined;
  const entitiesForKind = (kind: "mission" | "okr" | "kpi"): EntityRecord[] =>
    (scopedOutcomeEntities ?? db.listEntities(kind)).filter((item) =>
      item.kind === kind
      && allows(kind, item.id)
      && (kind === "kpi" || item.status !== "archived" || (options.entity?.kind === kind && options.entity.id === item.id))
    );
  const missions = entitiesForKind("mission");
  const okrEntities = entitiesForKind("okr");
  const kpiEntities = entitiesForKind("kpi");
  const measurements = groupMeasurements(
    db.listKpiMeasurementsForKpis(kpiEntities.map((item) => item.id), options.measurementLimit ?? 50),
    options.contextScope
  );
  const kpiSummaries = new Map(kpiEntities.map((entity) => [
    entity.id,
    buildKpiSummary(entity, measurements.get(entity.id) ?? [], now)
  ]));
  const relationRefs = [...missions, ...okrEntities, ...kpiEntities].map((item) => ({ kind: item.kind, id: item.id }));
  const relations = db.listEntityRelationsForEntities(relationRefs).filter((relation) =>
    allows(relation.sourceKind, relation.sourceId)
    && allows(relation.targetKind, relation.targetId)
    && relationAllowed(relation.relationType)
  );
  const taskLinks = db.listTaskLinksForTargets(okrEntities.map((item) => ({ kind: "okr", id: item.id })))
    .filter((link) => (!allowedTasks || allowedTasks.has(link.taskId)) && relationAllowed(link.relationType));
  const taskLabels = new Map(db.listTasksByIds(taskLinks.map((link) => link.taskId)).map((task) => [task.id, task.title]));
  const contributionRelations = relations.filter((relation) =>
    relation.relationType === "contributes_to" && relation.targetKind === "okr"
  );
  const contributionLabels = new Map(
    db.listEntitiesByRefs(contributionRelations.map((relation) => ({ kind: relation.sourceKind, id: relation.sourceId })))
      .map((entity) => [`${entity.kind}:${entity.id}`, entity.label])
  );
  const missionById = new Map(missions.map((mission) => [mission.id, mission]));
  const missionByOkr = new Map<string, EntityRecord>();
  const kpisByOkr = new Map<string, KpiSummary[]>();
  const contributionsByOkr = new Map<string, ContributionSummary[]>();
  for (const relation of relations) {
    if (relation.relationType === "has_okr" && relation.sourceKind === "mission" && relation.targetKind === "okr") {
      const mission = missionById.get(relation.sourceId);
      if (mission) missionByOkr.set(relation.targetId, mission);
    }
    if (relation.relationType === "measured_by" && relation.sourceKind === "okr" && relation.targetKind === "kpi") {
      const kpi = kpiSummaries.get(relation.targetId);
      if (kpi) pushMap(kpisByOkr, relation.sourceId, kpi);
    }
    if (relation.relationType === "contributes_to" && relation.targetKind === "okr") {
      const label = contributionLabels.get(`${relation.sourceKind}:${relation.sourceId}`);
      if (label) pushMap(contributionsByOkr, relation.targetId, contributionFromRelation(relation, label));
    }
  }
  for (const link of taskLinks.filter((item) => item.relationType === "contributes_to")) {
    pushMap(contributionsByOkr, link.targetId, contributionFromTaskLink(link, taskLabels.get(link.taskId) ?? link.taskId));
  }

  const okrs = okrEntities.map((entity) => {
    const mission = missionByOkr.get(entity.id);
    return buildOkrSummary(
      entity,
      mission ? { kind: "mission", id: mission.id, label: mission.label } : undefined,
      kpisByOkr.get(entity.id) ?? [],
      contributionsByOkr.get(entity.id) ?? [],
      now,
      Boolean(allowedEntities)
    );
  });
  const filteredOkrs = options.entity ? filterOkrsForEntity(okrs, options.entity) : okrs;
  const visibleOkrIds = new Set(filteredOkrs.map((item) => item.id));
  const missionSummaries = missions.map((mission) => {
    const missionOkrs = filteredOkrs.filter((okr) => okr.mission?.id === mission.id);
    return {
      id: mission.id,
      label: mission.label,
      description: mission.description,
      okrs: missionOkrs,
      progress: averageProgress(missionOkrs.map((item) => item.progress)),
      atRiskOkrs: missionOkrs.filter((item) => item.atRisk).length
    } satisfies MissionOutcomeSummary;
  }).filter((mission) => {
    if (!options.entity) return true;
    if (options.entity.kind === "mission") return options.entity.id === mission.id;
    return mission.okrs.length > 0;
  });
  const standaloneOkrs = filteredOkrs.filter((item) => !item.mission);
  const visibleKpis = [...kpiSummaries.values()].filter((item) => {
    if (options.entity?.kind === "kpi") return item.id === options.entity.id;
    if (item.lifecycleStatus === "archived") return false;
    return !options.entity || filteredOkrs.some((okr) => okr.kpis.some((kpi) => kpi.id === item.id));
  });
  const alerts = buildAlerts(filteredOkrs, visibleKpis);
  return {
    generatedAt: now.toISOString(),
    missions: missionSummaries,
    standaloneOkrs,
    kpis: visibleKpis,
    alerts,
    summary: {
      missions: missionSummaries.length,
      okrs: visibleOkrIds.size,
      atRiskOkrs: filteredOkrs.filter((item) => item.atRisk).length,
      kpis: visibleKpis.length,
      kpisChanged: visibleKpis.filter((item) => item.trend !== "unknown" && item.trend !== "stable").length,
      staleKpis: visibleKpis.filter((item) => item.stale).length,
      workWithoutMeasurement: alerts.filter((item) => item.kind === "feature_without_measurement").length
    }
  };
}

export function compareKpiBeforeAfter(
  db: WorkMemoryDatabase,
  kpiId: string,
  deliveryDate: string,
  options: { contextScope?: ResolvedContextScope } = {}
): {
  kpi: KpiSummary;
  deliveryDate: string;
  before?: KpiMeasurementRecord;
  after?: KpiMeasurementRecord;
  delta?: number;
  deltaPercent?: number;
  assessment: KpiTrend;
  causality: "not_established";
} {
  const entity = requireEntity(db, "kpi", kpiId);
  const cutoff = new Date(deliveryDate);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Delivery date must be a valid ISO date.");
  const measurements = groupMeasurements(db.listKpiMeasurements(kpiId, { limit: 5_000, ascending: true }), options.contextScope).get(kpiId) ?? [];
  const before = [...measurements].reverse().find((item) => Date.parse(item.measuredAt) <= cutoff.getTime());
  const after = measurements.find((item) => Date.parse(item.measuredAt) > cutoff.getTime());
  const kpi = buildKpiSummary(entity, measurements, new Date());
  const delta = before && after ? after.value - before.value : undefined;
  return {
    kpi,
    deliveryDate: cutoff.toISOString(),
    before,
    after,
    delta,
    deltaPercent: delta !== undefined && before?.value ? (delta / Math.abs(before.value)) * 100 : undefined,
    assessment: before && after ? trendFor(readKpiDefinition(entity), before.value, after.value) : "unknown",
    causality: "not_established"
  };
}

export function readOkrDefinition(entity: EntityRecord | undefined): OkrDefinition {
  const raw = outcomeMetadata(entity);
  return {
    schema: "okr.v1",
    status: normalizeOkrStatus(raw.status),
    periodStart: normalizeOptionalDate(raw.periodStart, "OKR period start"),
    periodEnd: normalizeOptionalDate(raw.periodEnd, "OKR period end"),
    keyResults: normalizeKeyResults(Array.isArray(raw.keyResults) ? raw.keyResults as OkrKeyResult[] : [])
  };
}

export function readKpiDefinition(entity: EntityRecord | undefined): KpiDefinition {
  const raw = outcomeMetadata(entity);
  const direction = KPI_DIRECTIONS.has(raw.direction as KpiDirection) ? raw.direction as KpiDirection : "increase";
  const definition: KpiDefinition = {
    schema: "kpi.v1",
    unit: typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : "value",
    direction,
    targetValue: finiteOptional(raw.targetValue, "KPI target value"),
    targetMin: finiteOptional(raw.targetMin, "KPI target minimum"),
    targetMax: finiteOptional(raw.targetMax, "KPI target maximum"),
    staleAfterDays: Math.max(1, Math.min(3_650, Math.floor(Number(raw.staleAfterDays) || 30)))
  };
  validateKpiTarget(definition);
  return definition;
}

function buildOkrSummary(
  entity: EntityRecord,
  mission: OkrSummary["mission"],
  kpis: KpiSummary[],
  contributions: ContributionSummary[],
  now: Date,
  redactUnknownKpiRefs = false
): OkrSummary {
  const definition = readOkrDefinition(entity);
  const byKpi = new Map(kpis.map((item) => [item.id, item]));
  const visibleKeyResults = definition.keyResults.map((item) =>
    redactUnknownKpiRefs && item.kpiId && !byKpi.has(item.kpiId)
      ? { ...item, kpiId: undefined }
      : item
  );
  const visibleDefinition = redactUnknownKpiRefs
    ? { ...definition, keyResults: visibleKeyResults }
    : definition;
  const keyResults = visibleKeyResults.map((item) => {
    const kpi = item.kpiId ? byKpi.get(item.kpiId) : undefined;
    const currentValue = kpi?.latest?.value ?? item.currentValue;
    const progress = item.progress ?? numericProgress(item.baselineValue, currentValue, item.targetValue);
    return { ...item, currentValue, progress };
  });
  const progress = averageProgress(keyResults.map((item) => item.progress));
  const riskReasons: string[] = [];
  if (definition.status === "at_risk" || definition.status === "off_track") riskReasons.push(`OKR status is ${definition.status}.`);
  if (keyResults.some((item) => item.status === "at_risk" || item.status === "off_track")) riskReasons.push("At least one key result is at risk.");
  if (definition.periodEnd && definition.periodEnd < now.toISOString().slice(0, 10) && (progress ?? 0) < 100) riskReasons.push("The OKR period ended before completion.");
  if (kpis.some((item) => item.trend === "worsening")) riskReasons.push("At least one KPI trend is worsening.");
  if (kpis.some((item) => item.stale)) riskReasons.push("At least one KPI is stale.");
  return {
    id: entity.id,
    label: entity.label,
    objective: entity.description,
    mission,
    definition: visibleDefinition,
    keyResults,
    progress,
    atRisk: riskReasons.length > 0,
    riskReasons,
    kpis,
    contributions
  };
}

function buildKpiSummary(entity: EntityRecord, input: KpiMeasurementRecord[], now: Date): KpiSummary {
  const definition = readKpiDefinition(entity);
  const measurements = [...input].sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt));
  const latest = measurements.at(-1);
  const previous = measurements.at(-2);
  const change = latest && previous ? latest.value - previous.value : undefined;
  const changePercent = change !== undefined && previous?.value ? (change / Math.abs(previous.value)) * 100 : undefined;
  return {
    id: entity.id,
    label: entity.label,
    description: entity.description,
    lifecycleStatus: entity.status,
    definition,
    measurements,
    latest,
    previous,
    change,
    changePercent,
    trend: latest && previous ? trendFor(definition, previous.value, latest.value) : "unknown",
    targetMet: latest ? targetMet(definition, latest.value) : undefined,
    stale: !latest || now.getTime() - Date.parse(latest.measuredAt) > definition.staleAfterDays * 86_400_000
  };
}

function buildAlerts(okrs: OkrSummary[], visibleKpis: KpiSummary[]): OutcomeAlert[] {
  const alerts: OutcomeAlert[] = [];
  const operationalOkrs = okrs.filter((okr) =>
    okr.definition.status === "active"
    || okr.definition.status === "at_risk"
    || okr.definition.status === "off_track"
  );
  for (const okr of operationalOkrs) {
    const entity = { kind: "okr", id: okr.id, label: okr.label };
    if (okr.contributions.length === 0) alerts.push({ kind: "okr_without_work", severity: "warning", entity, message: "No project, feature or task contributes to this OKR." });
    if (okr.kpis.length === 0) alerts.push({ kind: "okr_without_kpi", severity: "warning", entity, message: "This OKR has no explicit success KPI." });
    for (const contribution of okr.contributions.filter((item) => item.work.kind === "feature")) {
      if (okr.kpis.length === 0 || okr.kpis.every((kpi) => !kpi.latest)) {
        alerts.push({
          kind: "feature_without_measurement",
          severity: "warning",
          entity: contribution.work,
          message: okr.kpis.length === 0
            ? `Feature contributes to ${okr.label}, but the OKR has no KPI.`
            : `Feature contributes to ${okr.label}, but none of its KPIs has a measurement.`
        });
      }
    }
  }
  const attachedKpiIds = new Set(okrs.flatMap((okr) => okr.kpis.map((kpi) => kpi.id)));
  const operationalKpiIds = new Set(operationalOkrs.flatMap((okr) => okr.kpis.map((kpi) => kpi.id)));
  for (const kpi of visibleKpis.filter((item) =>
    operationalKpiIds.has(item.id) || !attachedKpiIds.has(item.id)
  )) {
    const kpiEntity = { kind: "kpi", id: kpi.id, label: kpi.label };
    if (!kpi.latest) alerts.push({ kind: "kpi_without_data", severity: "critical", entity: kpiEntity, message: "No measurement has been recorded." });
    else if (kpi.stale) alerts.push({ kind: "kpi_stale", severity: "warning", entity: kpiEntity, message: "The latest KPI measurement is stale." });
    if (kpi.trend === "worsening") alerts.push({ kind: "kpi_worsening", severity: "critical", entity: kpiEntity, message: "The latest KPI trend is moving away from the expected direction." });
    else if (kpi.latest && kpi.targetMet === false && (kpi.trend === "stable" || kpi.trend === "unknown")) {
      alerts.push({
        kind: "kpi_off_target",
        severity: "warning",
        entity: kpiEntity,
        message: kpi.trend === "stable"
          ? "The KPI remains off target and is not improving."
          : "The KPI is off target; another measurement is needed to establish its direction."
      });
    }
  }
  return dedupeAlerts(alerts);
}

function filterOkrsForEntity(okrs: OkrSummary[], entity: EntityRef): OkrSummary[] {
  if (entity.kind === "mission") return okrs.filter((item) => item.mission?.id === entity.id);
  if (entity.kind === "okr") return okrs.filter((item) => item.id === entity.id);
  if (entity.kind === "kpi") return okrs.filter((item) => item.kpis.some((kpi) => kpi.id === entity.id));
  return okrs.filter((item) => item.contributions.some((contribution) => contribution.work.kind === entity.kind && contribution.work.id === entity.id));
}

function groupMeasurements(records: KpiMeasurementRecord[], scope?: ResolvedContextScope): Map<string, KpiMeasurementRecord[]> {
  const access = scope?.scope.mode === "strict" ? scope.scope.sourceAccess ?? "full" : "full";
  const allowedSources = scope?.scope.mode === "strict" ? new Set(scope.sourceIds) : undefined;
  const allowedObservations = scope?.scope.mode === "strict" ? new Set(scope.observationIds) : undefined;
  const grouped = new Map<string, KpiMeasurementRecord[]>();
  for (const record of records) {
    if (record.sourceId && allowedSources && !allowedSources.has(record.sourceId)) continue;
    if (record.observationId && allowedObservations && !allowedObservations.has(record.observationId)) continue;
    if (scope?.scope.mode === "strict" && scope.scope.timeRange) {
      const measuredAt = Date.parse(record.measuredAt);
      const from = scope.scope.timeRange.from ? Date.parse(scope.scope.timeRange.from) : undefined;
      const toValue = scope.scope.timeRange.to;
      const to = toValue
        ? Date.parse(toValue) + (/^\d{4}-\d{2}-\d{2}$/.test(toValue) ? 86_400_000 - 1 : 0)
        : undefined;
      if ((from !== undefined && measuredAt < from) || (to !== undefined && measuredAt > to)) continue;
    }
    const sanitized: KpiMeasurementRecord = access === "full"
      ? record
      : {
          ...record,
          note: access === "snippets" ? record.note?.slice(0, 500) : undefined,
          sourceId: access === "none" ? undefined : record.sourceId,
          observationId: access === "none" ? undefined : record.observationId
        };
    pushMap(grouped, record.kpiId, sanitized);
  }
  return grouped;
}

function contributionFromRelation(
  relation: ReturnType<WorkMemoryDatabase["upsertEntityRelation"]>,
  label: string
): ContributionSummary {
  const outcome = nestedOutcome(relation.metadata);
  return {
    work: { kind: relation.sourceKind, id: relation.sourceId, label },
    okrId: relation.targetId,
    expectedImpact: typeof outcome.expectedImpact === "string" ? outcome.expectedImpact : relation.description ?? "Contributes to the OKR",
    causalHypothesis: optionalText(outcome.causalHypothesis),
    keyResultIds: stringArray(outcome.keyResultIds),
    confidence: finiteOptional(outcome.confidence, "contribution confidence") ?? 1
  };
}

function contributionFromTaskLink(link: TaskLinkRecord, label: string): ContributionSummary {
  const outcome = nestedOutcome(link.metadata);
  return {
    work: { kind: "task", id: link.taskId, label },
    okrId: link.targetId,
    expectedImpact: typeof outcome.expectedImpact === "string" ? outcome.expectedImpact : link.label ?? "Contributes to the OKR",
    causalHypothesis: optionalText(outcome.causalHypothesis),
    keyResultIds: stringArray(outcome.keyResultIds),
    confidence: finiteOptional(outcome.confidence, "contribution confidence") ?? 1
  };
}

function nestedOutcome(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = metadata?.outcome;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function outcomeMetadata(entity: EntityRecord | undefined): Record<string, unknown> {
  return nestedOutcome(entity?.metadata);
}

function withOutcomeMetadata(entity: EntityRecord | undefined, outcome: OkrDefinition | KpiDefinition): Record<string, unknown> {
  return { ...(entity?.metadata ?? {}), outcome };
}

function normalizeKeyResults(input: OkrKeyResult[]): OkrKeyResult[] {
  const seen = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Key result ${index + 1} must be an object.`);
    const title = requireText(raw.title, `key result ${index + 1} title`);
    const id = requireId(raw.id || normalizeEntityId(title), `key result ${index + 1}`);
    if (seen.has(id)) throw new Error(`Duplicate key result id: ${id}.`);
    seen.add(id);
    const status = KR_STATUSES.has(raw.status) ? raw.status : "not_started";
    return {
      id,
      title,
      status,
      progress: percentOptional(raw.progress, "key result progress"),
      baselineValue: finiteOptional(raw.baselineValue, "key result baseline"),
      currentValue: finiteOptional(raw.currentValue, "key result current value"),
      targetValue: finiteOptional(raw.targetValue, "key result target"),
      unit: optionalText(raw.unit),
      dueDate: normalizeOptionalDate(raw.dueDate, "key result due date"),
      kpiId: optionalText(raw.kpiId)
    };
  });
}

function normalizeOkrStatus(value: unknown): OkrStatus {
  return OKR_STATUSES.has(value as OkrStatus) ? value as OkrStatus : "active";
}

function validateKpiTarget(definition: KpiDefinition): void {
  if (definition.direction === "target" && definition.targetValue === undefined) {
    throw new Error("A target-direction KPI requires targetValue.");
  }
  if (definition.direction === "range") {
    if (definition.targetMin === undefined || definition.targetMax === undefined) {
      throw new Error("A range-direction KPI requires targetMin and targetMax.");
    }
    if (definition.targetMin > definition.targetMax) throw new Error("KPI targetMin must not exceed targetMax.");
  }
}

function targetMet(definition: KpiDefinition, value: number): boolean | undefined {
  if (definition.direction === "increase") return definition.targetValue === undefined ? undefined : value >= definition.targetValue;
  if (definition.direction === "decrease") return definition.targetValue === undefined ? undefined : value <= definition.targetValue;
  if (definition.direction === "target") return definition.targetValue === undefined ? undefined : value === definition.targetValue;
  return definition.targetMin === undefined || definition.targetMax === undefined ? undefined : value >= definition.targetMin && value <= definition.targetMax;
}

function trendFor(definition: KpiDefinition, previous: number, current: number): KpiTrend {
  const tolerance = Math.max(Math.abs(previous), Math.abs(current), 1) * 0.0001;
  if (Math.abs(current - previous) <= tolerance) return "stable";
  if (definition.direction === "increase") return current > previous ? "improving" : "worsening";
  if (definition.direction === "decrease") return current < previous ? "improving" : "worsening";
  if (definition.direction === "target" && definition.targetValue !== undefined) {
    return trendForDistance(
      Math.abs(previous - definition.targetValue),
      Math.abs(current - definition.targetValue)
    );
  }
  if (definition.direction === "range" && definition.targetMin !== undefined && definition.targetMax !== undefined) {
    return trendForDistance(
      distanceToRange(previous, definition.targetMin, definition.targetMax),
      distanceToRange(current, definition.targetMin, definition.targetMax)
    );
  }
  return "unknown";
}

function numericProgress(baseline: number | undefined, current: number | undefined, target: number | undefined): number | undefined {
  if (current === undefined || target === undefined) return undefined;
  const start = baseline ?? 0;
  if (target === start) return current === target ? 100 : 0;
  return Math.max(0, Math.min(100, ((current - start) / (target - start)) * 100));
}

function averageProgress(values: Array<number | undefined>): number | undefined {
  return values.length
    ? values.reduce<number>((total, value) => total + (value !== undefined && Number.isFinite(value) ? value : 0), 0) / values.length
    : undefined;
}

function distanceToRange(value: number, min: number, max: number): number {
  return value < min ? min - value : value > max ? value - max : 0;
}

function trendForDistance(previousDistance: number, currentDistance: number): KpiTrend {
  const tolerance = Math.max(previousDistance, currentDistance, 1) * 0.0001;
  if (Math.abs(currentDistance - previousDistance) <= tolerance) return "stable";
  return currentDistance < previousDistance ? "improving" : "worsening";
}

function requireEntity(db: WorkMemoryDatabase, kind: string, id: string): EntityRecord {
  const entity = db.getEntity(kind, id);
  if (!entity) throw new Error(`Entity not found: ${kind}:${id}`);
  return entity;
}

function requireOkrSummary(snapshot: OutcomeSnapshot, id: string): OkrSummary {
  const okr = [...snapshot.missions.flatMap((mission) => mission.okrs), ...snapshot.standaloneOkrs].find((item) => item.id === id);
  if (!okr) throw new Error(`OKR not found after update: ${id}`);
  return okr;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireId(value: unknown, label: string): string {
  const normalized = normalizeEntityId(requireText(value, `${label} id`));
  if (!normalized) throw new Error(`${label} id is required.`);
  return normalized;
}

function finiteOptional(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function percentOptional(value: unknown, label: string): number | undefined {
  const number = finiteOptional(value, label);
  if (number !== undefined && (number < 0 || number > 100)) throw new Error(`${label} must be between 0 and 100.`);
  return number;
}

function normalizeOptionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid ISO date.`);
  return value.length === 10 ? value : new Date(value).toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : [];
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const items = map.get(key) ?? [];
  items.push(value);
  map.set(key, items);
}

function dedupeAlerts(alerts: OutcomeAlert[]): OutcomeAlert[] {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    const key = `${alert.kind}:${alert.entity.kind}:${alert.entity.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
