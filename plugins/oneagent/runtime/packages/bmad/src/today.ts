import { resolveScope } from "../../registry/src/index.ts";
import { buildOutcomeSnapshot, type OutcomeSnapshot } from "../../impact/src/index.ts";
import { listTaskReadModel, listTaskReadModelForContext, type TaskReadModelItem } from "../../tasks/src/index.ts";
import type { ActiveContext, CaptureRecord, InboxItem, ResolvedContextScope, WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";

const OBJECTIVE_CONTENT_TYPES = new Set(["okr", "strategy", "development_plan", "mission_review"]);
const REVIEW_CONTENT_TYPES = new Set(["one_to_one", "mission_review", "development_plan", "okr"]);

export interface TodayItem {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  assignee?: string;
  deadline?: string;
  productId?: string;
  entity?: { kind: string; id: string; label: string };
  score: number;
  reasons: string[];
}

export interface TodayGroup {
  entity: { kind: string; id: string; label: string };
  items: TodayItem[];
}

export interface TodayCaptureItem {
  id: string;
  title: string;
  contentType: string;
  primaryEntity: { kind: string; id: string; label: string };
  updatedAt: string;
}

export interface TodayContradictionItem {
  id: string;
  title: string;
  validationStatus: string;
  subject?: { kind: string; id: string; label: string };
  sourceId: string;
  updatedAt: string;
}

export interface TodayContextViewItem {
  id: string;
  name: string;
  proposedNodes: number;
  updatedAt: string;
}

export interface TodayModel {
  generatedAt: string;
  scope: { entity?: { kind: string; id: string }; productIds: string[] };
  summary: {
    dueSoon: number;
    overdue: number;
    blocked: number;
    inboxPending: number;
    agentTasks: number;
    objectives: number;
    upcomingReviews: number;
    missions: number;
    okrs: number;
    atRiskOkrs: number;
    kpis: number;
    kpisChanged: number;
    staleKpis: number;
    workWithoutMeasurement: number;
    contradictions: number;
    contextViewsToReview: number;
  };
  dueSoon: TodayItem[];
  activeWork: TodayGroup[];
  blocked: TodayItem[];
  objectives: TodayCaptureItem[];
  inbox: Array<{ id: string; type: string; title: string; body?: string; productId?: string }>;
  agentQueue: TodayItem[];
  upcomingReviews: TodayCaptureItem[];
  contradictions: TodayContradictionItem[];
  contextViewsToReview: TodayContextViewItem[];
  outcomes: OutcomeSnapshot;
  notes: string[];
}

export interface TodayInput {
  config: WorkMemoryConfig;
  context: ActiveContext;
  db: WorkMemoryDatabase;
  entity?: { kind: string; id: string };
  assignee?: string;
  dueWindowDays?: number;
  includeAgent?: boolean;
  section?: string;
  now?: Date;
  contextScope?: ResolvedContextScope;
}

/**
 * Deterministic daily read model: what to look at first today. Aggregated from tasks (deadlines,
 * priority, status, assignee), inbox and captures (objectives + upcoming reviews).
 * Every section follows the same product/entity/context boundary, including
 * mission- and OKR-linked tasks that do not carry a product id themselves.
 */
export function buildTodayModel(input: TodayInput): TodayModel {
  const now = input.now ?? new Date();
  const today = isoDate(now);
  const windowDays = input.dueWindowDays ?? 7;
  const horizon = isoDate(addDays(now, windowDays));
  const includeAgent = input.includeAgent !== false;
  const notes: string[] = [];
  const sourceAccess = input.contextScope?.scope.mode === "strict"
    ? input.contextScope.scope.sourceAccess ?? "full"
    : "full";
  const contentPlaneAllowed = sourceAccess !== "none";

  const productIds = resolveProductIds(input);
  const entityLabels = entityLabelMap(input.db, input.contextScope?.entities);
  const outcomes = buildOutcomeSnapshot(input.db, {
    now,
    entity: input.entity,
    contextScope: input.contextScope
  });

  const allowedTasks = input.contextScope ? new Set(input.contextScope.taskIds) : undefined;
  const taskRefs = relevantTaskEntityRefs(input.entity, outcomes);
  const taskEntityRefs = [...taskRefs].map((ref) => {
    const separator = ref.indexOf(":");
    return { kind: ref.slice(0, separator), id: ref.slice(separator + 1) };
  });
  const boundedTasks = input.contextScope?.scope.mode === "strict" || Boolean(input.entity && input.entity.kind !== "product");
  const tasks = (boundedTasks
    ? listTaskReadModelForContext(input.db, {
        productIds,
        sourceIds: input.contextScope?.sourceIds,
        entityRefs: taskEntityRefs,
        taskIds: input.contextScope?.scope.mode === "strict" ? input.contextScope.taskIds : undefined
      })
    : listTaskReadModel(input.db, productIds))
    .filter((task) => !allowedTasks || allowedTasks.has(task.id))
    .filter((task) => taskMatchesEntityFocus(task, input.entity, taskRefs));
  const scored = tasks
    .filter((task) => task.status !== "done")
    .filter((task) => !input.assignee || task.assignee === input.assignee)
    .filter((task) => includeAgent || task.assignee !== "agent")
    .map((task) => scoreTask(task, today, horizon, entityLabels));

  const overdue = scored.filter((task) => task.deadline && task.deadline < today);
  const dueSoon = scored
    .filter((task) => task.deadline && task.deadline <= horizon)
    .sort((left, right) => right.score - left.score);
  const blocked = scored.filter((task) => task.status === "blocked").sort((left, right) => right.score - left.score);
  const agentQueue = scored.filter((task) => task.assignee === "agent").sort((left, right) => right.score - left.score);
  const activeWork = groupByEntity(
    scored.filter((task) => task.status === "open" || task.status === "in_progress" || task.status === "ready" || task.status === "pending" || task.status === "candidate")
  );

  const allowedCaptures = input.contextScope ? new Set(input.contextScope.captureIds) : undefined;
  const captures = contentPlaneAllowed
    ? filterCapturesForScope(
        input,
        input.contextScope
          ? input.db.listCapturesByIds(input.contextScope.captureIds)
          : input.entity
            ? input.db.listCapturesForEntity(input.entity.kind, input.entity.id)
            : input.db.listCaptures({})
      )
      .filter((capture) => !allowedCaptures || allowedCaptures.has(capture.id))
    : [];
  const objectives = captures
    .filter((capture) => OBJECTIVE_CONTENT_TYPES.has(capture.contentType))
    .map((capture) => toCaptureItem(capture, entityLabels));
  const upcomingReviews = captures
    .filter((capture) => REVIEW_CONTENT_TYPES.has(capture.contentType))
    .map((capture) => toCaptureItem(capture, entityLabels));

  const contradictionCandidates = !contentPlaneAllowed
    ? []
    : input.contextScope?.scope.mode === "strict"
      ? input.db.listObservationsByIds(input.contextScope.observationIds)
      : input.db.listObservationContextCandidates({
          productIds: productIds.length > 0 ? productIds : undefined,
          entityRefs: input.entity ? [input.entity] : undefined,
          evidenceStatuses: ["contradicted"]
        });
  const contradictions = contradictionCandidates
    .filter((observation) => observation.evidenceStatus === "contradicted")
    .slice(0, 20)
    .map((observation): TodayContradictionItem => ({
      id: observation.id,
      title: observation.title,
      validationStatus: observation.validationStatus,
      subject: observation.subjectKind && observation.subjectId
        ? {
            kind: observation.subjectKind,
            id: observation.subjectId,
            label: entityLabels.get(`${observation.subjectKind}:${observation.subjectId}`) ?? observation.subjectId
          }
        : undefined,
      sourceId: observation.sourceId,
      updatedAt: observation.updatedAt
    }));
  if (contradictionCandidates.filter((observation) => observation.evidenceStatus === "contradicted").length > 20) {
    notes.push("Contradictions are limited to the 20 newest in-scope observations.");
  }

  const strictEntityRefs = input.contextScope?.scope.mode === "strict"
    ? new Set(input.contextScope.entities.map((entity) => `${entity.kind}:${entity.id}`))
    : undefined;
  const contextViewsToReview = input.db.listContextViews().flatMap((view): TodayContextViewItem[] => {
    if (view.refreshPolicy !== "monitored") return [];
    if (strictEntityRefs && !view.context.selectedEntities.every((entity) => strictEntityRefs.has(`${entity.kind}:${entity.id}`))) return [];
    const proposedNodes = (view.context.nodeSelections ?? []).filter((selection) =>
      selection.role === "proposed"
      && (!strictEntityRefs || strictEntityRefs.has(`${selection.entity.kind}:${selection.entity.id}`))
    ).length;
    return proposedNodes > 0 ? [{ id: view.id, name: view.name, proposedNodes, updatedAt: view.updatedAt }] : [];
  });

  // Tasks are stored as inbox items but surfaced separately; the inbox section is for proposals.
  const allowedInbox = input.contextScope ? new Set(input.contextScope.inboxItemIds) : undefined;
  const todayInboxTypes = ["wiki_proposal", "graph_change_proposal", "decision_candidate", "open_question", "risk"];
  const inboxCandidates = (!contentPlaneAllowed
    ? []
    : input.contextScope?.scope.mode === "strict"
      ? input.db.listInboxFiltered({
          status: "pending",
          types: todayInboxTypes,
          ids: input.contextScope.inboxItemIds,
          limit: 51
        })
      : input.entity && input.entity.kind !== "product"
        ? input.db.listInboxContextCandidates({
            entityRefs: [...taskRefs],
            captureIds: captures.map((capture) => capture.id)
          }).filter((item) => item.status === "pending" && todayInboxTypes.includes(item.type))
        : productIds.length > 0
          ? input.db.listInboxFiltered({ status: "pending", productIds, types: todayInboxTypes, limit: 51 })
          : [])
    .filter((item) => !allowedInbox || allowedInbox.has(item.id));
  if (inboxCandidates.length > 50) notes.push("Inbox results are limited to the 50 newest in-scope proposals.");
  const inboxItems = inboxCandidates.slice(0, 50);
  const inbox = inboxItems.map((item: InboxItem) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    ...(sourceAccess === "metadata" ? {} : { body: sourceAccess === "snippets" ? item.body.slice(0, 2_000) : item.body }),
    productId: item.productId
  }));

  if (!contentPlaneAllowed) {
    notes.push("Source-derived captures and Inbox items are hidden by the active sourceAccess=none policy.");
  }

  const model: TodayModel = {
    generatedAt: now.toISOString(),
    scope: { entity: input.entity, productIds },
    summary: {
      dueSoon: dueSoon.length,
      overdue: overdue.length,
      blocked: blocked.length,
      inboxPending: inbox.length,
      agentTasks: agentQueue.length,
      objectives: objectives.length,
      upcomingReviews: upcomingReviews.length,
      contradictions: contradictions.length,
      contextViewsToReview: contextViewsToReview.length,
      ...outcomes.summary
    },
    dueSoon,
    activeWork,
    blocked,
    objectives,
    inbox,
    agentQueue,
    upcomingReviews,
    contradictions,
    contextViewsToReview,
    outcomes,
    notes
  };

  return input.section ? pickSection(model, input.section) : model;
}

function resolveProductIds(input: TodayInput): string[] {
  if (input.contextScope?.scope.mode === "strict") {
    return input.contextScope.entities.filter((entity) => entity.kind === "product").map((entity) => entity.id);
  }
  if (input.entity) {
    return input.entity.kind === "product" ? [input.entity.id] : [];
  }
  const scope = resolveScope(input.config, input.context, { scope: "portfolio" });
  return scope.includedProductIds.length > 0 ? scope.includedProductIds : input.config.products.map((product) => product.id);
}

function entityLabelMap(
  db: WorkMemoryDatabase,
  refs?: Array<{ kind: string; id: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of refs ? db.listEntitiesByRefs(refs) : db.listEntities()) {
    map.set(`${entity.kind}:${entity.id}`, entity.label || entity.id);
  }
  return map;
}

function scoreTask(task: TaskReadModelItem, today: string, horizon: string, labels: Map<string, string>): TodayItem {
  const reasons: string[] = [];
  let score = 0;
  if (task.deadline && task.deadline < today) {
    score += 100;
    reasons.push("overdue");
  } else if (task.deadline === today) {
    score += 90;
    reasons.push("due today");
  } else if (task.deadline && task.deadline <= horizon) {
    score += 40;
    reasons.push("due soon");
  }
  if (task.priority === "critical") {
    score += 60;
    reasons.push("critical");
  } else if (task.priority === "high") {
    score += 30;
    reasons.push("high priority");
  } else if (task.priority === "medium") {
    score += 10;
  }
  if (task.status === "blocked") {
    score += 50;
    reasons.push("blocked");
  }
  if (task.assignee === "me") {
    score += 20;
  } else if (task.assignee === "agent") {
    score += 10;
    reasons.push("agent");
  }

  const linked = task.links.find((link) => ["okr", "mission", "feature", "project", "kpi"].includes(link.targetKind));
  const entity = linked
    ? { kind: linked.targetKind, id: linked.targetId, label: labels.get(`${linked.targetKind}:${linked.targetId}`) || linked.label || linked.targetId }
    : task.productId
      ? { kind: "product", id: task.productId, label: labels.get(`product:${task.productId}`) || task.productId }
      : undefined;

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    deadline: task.deadline,
    productId: task.productId,
    entity,
    score,
    reasons
  };
}

function groupByEntity(items: TodayItem[]): TodayGroup[] {
  const groups = new Map<string, TodayGroup>();
  const unassigned: TodayItem[] = [];
  for (const item of items) {
    if (!item.entity) {
      unassigned.push(item);
      continue;
    }
    const key = `${item.entity.kind}:${item.entity.id}`;
    if (!groups.has(key)) {
      groups.set(key, { entity: item.entity, items: [] });
    }
    groups.get(key)!.items.push(item);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.items.sort((left, right) => right.score - left.score);
  }
  result.sort((left, right) => right.items.length - left.items.length);
  if (unassigned.length > 0) {
    result.push({ entity: { kind: "oneagent", id: "oneagent", label: "OneAgent" }, items: unassigned.sort((a, b) => b.score - a.score) });
  }
  return result;
}

function filterCapturesForScope(input: TodayInput, captures: CaptureRecord[]): CaptureRecord[] {
  if (!input.entity) {
    return captures;
  }
  const { kind, id } = input.entity;
  return captures.filter(
    (capture) =>
      (capture.primaryEntityKind === kind && capture.primaryEntityId === id) ||
      capture.relatedEntities.some((related) => related.entityKind === kind && related.entityId === id)
  );
}

function toCaptureItem(capture: CaptureRecord, labels: Map<string, string>): TodayCaptureItem {
  return {
    id: capture.id,
    title: capture.title,
    contentType: capture.contentType,
    primaryEntity: {
      kind: capture.primaryEntityKind,
      id: capture.primaryEntityId,
      label: labels.get(`${capture.primaryEntityKind}:${capture.primaryEntityId}`) || capture.primaryEntityId
    },
    updatedAt: capture.updatedAt
  };
}

function pickSection(model: TodayModel, section: string): TodayModel {
  const emptyOutcomes: OutcomeSnapshot = {
    ...model.outcomes,
    missions: [],
    standaloneOkrs: [],
    kpis: [],
    alerts: [],
    summary: { missions: 0, okrs: 0, atRiskOkrs: 0, kpis: 0, kpisChanged: 0, staleKpis: 0, workWithoutMeasurement: 0 }
  };
  const empty: TodayModel = { ...model, dueSoon: [], activeWork: [], blocked: [], objectives: [], inbox: [], agentQueue: [], upcomingReviews: [], contradictions: [], contextViewsToReview: [], outcomes: emptyOutcomes };
  const map: Record<string, () => Partial<TodayModel>> = {
    "due-soon": () => ({ dueSoon: model.dueSoon }),
    "active-work": () => ({ activeWork: model.activeWork }),
    blocked: () => ({ blocked: model.blocked }),
    objectives: () => ({ objectives: model.objectives }),
    inbox: () => ({ inbox: model.inbox }),
    "agent-queue": () => ({ agentQueue: model.agentQueue }),
    "upcoming-reviews": () => ({ upcomingReviews: model.upcomingReviews }),
    contradictions: () => ({ contradictions: model.contradictions }),
    "context-views": () => ({ contextViewsToReview: model.contextViewsToReview }),
    outcomes: () => ({ outcomes: model.outcomes })
  };
  const picker = map[section];
  if (!picker) {
    throw new Error(`Unknown Today section: ${section}.`);
  }
  return { ...empty, ...picker() };
}

function relevantTaskEntityRefs(entity: TodayInput["entity"], outcomes: OutcomeSnapshot): Set<string> {
  const refs = new Set<string>();
  if (entity) refs.add(`${entity.kind}:${entity.id}`);
  for (const mission of outcomes.missions) {
    refs.add(`mission:${mission.id}`);
    for (const okr of mission.okrs) {
      refs.add(`okr:${okr.id}`);
      for (const kpi of okr.kpis) refs.add(`kpi:${kpi.id}`);
      for (const contribution of okr.contributions) refs.add(`${contribution.work.kind}:${contribution.work.id}`);
    }
  }
  for (const okr of outcomes.standaloneOkrs) {
    refs.add(`okr:${okr.id}`);
    for (const kpi of okr.kpis) refs.add(`kpi:${kpi.id}`);
    for (const contribution of okr.contributions) refs.add(`${contribution.work.kind}:${contribution.work.id}`);
  }
  return refs;
}

function taskMatchesEntityFocus(
  task: TaskReadModelItem,
  entity: TodayInput["entity"],
  relevantRefs: Set<string>
): boolean {
  if (!entity) return true;
  if (entity.kind === "product" && task.productId === entity.id) return true;
  return task.links.some((link) => relevantRefs.has(`${link.targetKind}:${link.targetId}`));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
