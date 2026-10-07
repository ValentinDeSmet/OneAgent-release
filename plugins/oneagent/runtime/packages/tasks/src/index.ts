import { isPriorityTask, priorityRevision } from "./priorities.ts";
import type { InboxItem } from "../../shared/src/index.ts";
import type {
  TaskInput,
  TaskTracking,
  TaskLinkInput,
  TaskLinkRecord,
  TaskMetadataInput,
  TaskMetadataRecord,
  TaskRecord,
  TaskUpdateInput,
  WorkMemoryDatabase
} from "../../storage/src/index.ts";

export interface TaskDraft {
  title: string;
  body?: string;
  productId?: string;
  sourceId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: TaskAssignee;
  deadline?: string;
  notes?: string;
  origin?: TaskOrigin;
  links?: TaskLinkDraft[];
}

export interface TaskLinkDraft {
  relationType: string;
  targetKind: string;
  targetId: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskReadModelItem {
  id: string;
  title: string;
  body?: string;
  status: TaskStatus;
  defaultStatus: TaskStatus;
  priority: TaskPriority;
  assignee: TaskAssignee;
  deadline?: string;
  notes?: string;
  productId?: string;
  sourceId?: string;
  origin: TaskOrigin;
  links: TaskLinkDraft[];
  tracking?: TaskTracking | null;
  inPriorities?: boolean;
  priorityRevision?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type TaskStatus = "pending" | "candidate" | "open" | "in_progress" | "blocked" | "ready" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskAssignee = "me" | "agent";
export type TaskOrigin = "manual" | "agent" | "task" | "inbox" | "concept";

export function createTask(db: WorkMemoryDatabase, input: TaskDraft): TaskReadModelItem {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Task title is required.");
  }

  const task = db.createTask({
    title,
    body: input.body,
    productId: input.productId,
    sourceId: input.sourceId,
    status: input.status ?? "open",
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? "me",
    deadline: input.deadline,
    notes: input.notes,
    origin: input.origin ?? "manual",
    tracking: { inPriorities: false, priorityRemoved: false }
  });
  const links = db.replaceTaskLinks(task.id, normalizeLinkDrafts(input.links ?? []));
  return taskFromRecord(task, links);
}

export function updateTask(db: WorkMemoryDatabase, input: TaskUpdateInput & { links?: TaskLinkDraft[] }): TaskReadModelItem {
  const native = db.getTask(input.taskId);
  if (native) {
    const task = db.updateTask(input);
    const links = input.links ? db.replaceTaskLinks(task.id, normalizeLinkDrafts(input.links)) : db.listTaskLinks([task.id]);
    return taskFromRecord(task, links);
  }

  const metadata = db.upsertTaskMetadata(input);
  const task = legacyTaskById(db, input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }
  const links = input.links ? db.replaceTaskLinks(input.taskId, normalizeLinkDrafts(input.links)) : db.listTaskLinks([input.taskId]);
  return { ...applyMetadata(task, metadata), links: links.map(linkToDraft) };
}

export function archiveTask(db: WorkMemoryDatabase, taskId: string): void {
  db.archiveTask(taskId);
}

export function listTaskReadModel(db: WorkMemoryDatabase, productIds: string[]): TaskReadModelItem[] {
  const byKey = new Map<string, TaskReadModelItem>();
  const nativeTasks = db.listTasks(productIds);
  const nativeTitles = new Set(nativeTasks.map(taskKey));
  const nativeLinks = groupLinks(db.listTaskLinks(nativeTasks.map((task) => task.id)));

  for (const task of nativeTasks) {
    byKey.set(`native:${task.id}`, taskFromRecord(task, nativeLinks.get(task.id) ?? []));
  }

  const legacy = legacyTasks(db, productIds);
  const metadata = new Map(db.listTaskMetadata(legacy.map((task) => task.id)).map((entry) => [entry.taskId, entry]));
  const legacyLinks = groupLinks(db.listTaskLinks(legacy.map((task) => task.id)));
  for (const task of legacy) {
    const enriched = applyMetadata(task, metadata.get(task.id));
    if (enriched.status === "archived") {
      continue;
    }
    if (!nativeTitles.has(taskKey(enriched)) && !byKey.has(taskKey(enriched))) {
      byKey.set(taskKey(enriched), {
        ...enriched,
        links: (legacyLinks.get(enriched.id) ?? []).map(linkToDraft)
      });
    }
  }

  return Array.from(byKey.values());
}

/**
 * Bounded task read model for entity spaces and strict context surfaces. Native
 * tasks are selected through indexed product/source/link dimensions; linked
 * legacy Inbox tasks are hydrated only from the resulting task id allowlist.
 */
export function listTaskReadModelForContext(
  db: WorkMemoryDatabase,
  filter: {
    productIds?: string[];
    sourceIds?: string[];
    entityRefs?: Array<{ kind: string; id: string }>;
    taskIds?: string[];
  }
): TaskReadModelItem[] {
  const explicitIds = [...new Set(filter.taskIds ?? [])];
  const targetLinks = db.listTaskLinksForTargets(filter.entityRefs ?? []);
  const candidateIds = [...new Set([...explicitIds, ...targetLinks.map((link) => link.taskId)])];
  const nativeCandidates = db.listTaskContextCandidates({
    productIds: filter.productIds,
    sourceIds: filter.sourceIds,
    entityRefs: filter.entityRefs
  });
  const nativeById = new Map(nativeCandidates.map((task) => [task.id, task]));
  for (const task of db.listTasksByIds(explicitIds)) nativeById.set(task.id, task);
  const nativeTasks = [...nativeById.values()];
  const allIds = [...new Set([...candidateIds, ...nativeTasks.map((task) => task.id)])];
  const links = groupLinks(db.listTaskLinks(allIds));
  const result = nativeTasks.map((task) => taskFromRecord(task, links.get(task.id) ?? []));

  const nativeIds = new Set(nativeTasks.map((task) => task.id));
  const legacyIds = candidateIds.filter((id) => !nativeIds.has(id));
  if (legacyIds.length > 0) {
    const metadata = new Map(db.listTaskMetadata(legacyIds).map((entry) => [entry.taskId, entry]));
    for (const item of db.listInboxFiltered({ ids: legacyIds, types: ["task"] })) {
      const task = applyMetadata(taskFromInbox(item), metadata.get(item.id));
      if (task.status !== "archived") result.push({ ...task, links: (links.get(item.id) ?? []).map(linkToDraft) });
    }
  }
  return result;
}

export function updateTaskMetadata(db: WorkMemoryDatabase, input: TaskMetadataInput): TaskMetadataRecord {
  const native = db.getTask(input.taskId);
  if (native) {
    db.updateTask(input);
  }
  return db.upsertTaskMetadata(input);
}

function legacyTasks(db: WorkMemoryDatabase, productIds: string[]): TaskReadModelItem[] {
  const byKey = new Map<string, TaskReadModelItem>();
  for (const item of db.listInbox("pending", productIds).filter((candidate) => candidate.type === "task")) {
    const task = taskFromInbox(item);
    byKey.set(taskKey(task), task);
  }

  for (const concept of db.listConcepts(productIds, 100).filter((candidate) => candidate.conceptType === "task")) {
    const task: TaskReadModelItem = {
      id: concept.id,
      title: concept.canonicalName,
      body: concept.description,
      status: "candidate",
      defaultStatus: "candidate",
      priority: "medium",
      assignee: "me",
      origin: "concept",
      links: []
    };
    if (!byKey.has(taskKey(task))) {
      byKey.set(taskKey(task), task);
    }
  }

  return Array.from(byKey.values());
}

function legacyTaskById(db: WorkMemoryDatabase, taskId: string): TaskReadModelItem | undefined {
  const inbox = db.getInboxItem(taskId);
  if (inbox?.type === "task") {
    return taskFromInbox(inbox);
  }
  for (const concept of db.listConcepts([], 500).filter((candidate) => candidate.conceptType === "task")) {
    if (concept.id === taskId) {
      return {
        id: concept.id,
        title: concept.canonicalName,
        body: concept.description,
        status: "candidate",
        defaultStatus: "candidate",
        priority: "medium",
        assignee: "me",
        origin: "concept",
        links: []
      };
    }
  }
  return undefined;
}

function taskFromRecord(task: TaskRecord, links: TaskLinkRecord[] = []): TaskReadModelItem {
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    status: isTaskStatus(task.status) ? task.status : "open",
    defaultStatus: isTaskStatus(task.status) ? task.status : "open",
    priority: isTaskPriority(task.priority) ? task.priority : "medium",
    assignee: isTaskAssignee(task.assignee) ? task.assignee : "me",
    deadline: task.deadline,
    notes: task.notes,
    productId: task.productId,
    sourceId: task.sourceId,
    origin: isTaskOrigin(task.origin) ? task.origin : "task",
    links: links.map(linkToDraft),
    tracking: task.tracking,
    inPriorities: isPriorityTask(task, links),
    priorityRevision: priorityRevision(task, links),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function taskFromInbox(item: InboxItem): TaskReadModelItem {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    status: "pending",
    defaultStatus: "pending",
    priority: "medium",
    assignee: "me",
    productId: item.productId,
    sourceId: item.sourceId,
    origin: "inbox",
    links: []
  };
}

function applyMetadata(task: TaskReadModelItem, metadata: TaskMetadataRecord | undefined): TaskReadModelItem {
  if (!metadata) {
    return task;
  }
  return {
    ...task,
    title: metadata.title ?? task.title,
    body: metadata.body ?? task.body,
    status: isTaskStatus(metadata.status) ? metadata.status : task.status,
    priority: isTaskPriority(metadata.priority) ? metadata.priority : task.priority,
    assignee: isTaskAssignee(metadata.assignee) ? metadata.assignee : task.assignee,
    deadline: metadata.deadline,
    notes: metadata.notes,
    updatedAt: metadata.updatedAt
  };
}

function normalizeLinkDrafts(links: TaskLinkDraft[]): Array<Omit<TaskLinkInput, "taskId">> {
  return links
    .map((link) => ({
      relationType: String(link.relationType || "").trim(),
      targetKind: String(link.targetKind || "").trim(),
      targetId: String(link.targetId || "").trim(),
      label: String(link.label || "").trim(),
      metadata: link.metadata && typeof link.metadata === "object" && !Array.isArray(link.metadata)
        ? link.metadata
        : undefined
    }))
    .filter((link) => link.relationType && link.targetKind && link.targetId);
}

function groupLinks(links: TaskLinkRecord[]): Map<string, TaskLinkRecord[]> {
  const grouped = new Map<string, TaskLinkRecord[]>();
  for (const link of links) {
    const items = grouped.get(link.taskId) ?? [];
    items.push(link);
    grouped.set(link.taskId, items);
  }
  return grouped;
}

function linkToDraft(link: TaskLinkRecord): TaskLinkDraft {
  return {
    relationType: link.relationType,
    targetKind: link.targetKind,
    targetId: link.targetId,
    label: link.label,
    metadata: link.metadata
  };
}

function isTaskStatus(value: string | undefined): value is TaskStatus {
  return value === "pending" || value === "candidate" || value === "open" || value === "in_progress" || value === "blocked" || value === "ready" || value === "done" || value === "archived";
}

function isTaskPriority(value: string | undefined): value is TaskPriority {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isTaskAssignee(value: string | undefined): value is TaskAssignee {
  return value === "me" || value === "agent";
}

function isTaskOrigin(value: string | undefined): value is TaskOrigin {
  return value === "manual" || value === "agent" || value === "task" || value === "inbox" || value === "concept";
}

function taskKey(task: { title: string }): string {
  return task.title.toLowerCase().trim();
}
