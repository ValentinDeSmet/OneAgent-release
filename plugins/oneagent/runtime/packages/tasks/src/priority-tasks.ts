import type { TaskRecord, TaskUpdateInput, WorkMemoryDatabase } from "../../storage/src/index.ts";
import { createTask, listTaskReadModel, type TaskStatus, type TaskPriority, type TaskAssignee } from "./index.ts";
import { isPriorityTask, priorityRevision, validDay } from "./priorities.ts";

type Input = Record<string, unknown>;
const statuses = ["pending", "candidate", "open", "in_progress", "blocked", "ready", "done"];
function input(raw: unknown, extra: string[]): Input {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Objet JSON attendu.");
  const value = raw as Input;
  if (value.scope !== "portfolio") throw new Error("Le périmètre portfolio est obligatoire.");
  for (const key of Object.keys(value)) if (!["scope", "priorityId", ...extra].includes(key)) throw new Error(`Champ inconnu : ${key}`);
  return value;
}
function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > max) throw new Error(`Champ invalide : ${field}`);
  return value.trim();
}
function revision(value: unknown): string {
  const result = text(value, "revision", 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Révision invalide. Actualise avant de réessayer.");
  return result;
}
function native(db: WorkMemoryDatabase, id: unknown): TaskRecord {
  const task = db.getTask(text(id, "taskId"));
  if (!task || task.archivedAt || task.status === "archived") throw new Error("Tâche native introuvable ou archivée.");
  return task;
}
function parent(db: WorkMemoryDatabase, value: Input, write = false, allowRemoved = false): TaskRecord {
  const task = native(db, value.priorityId), links = db.listTaskLinks([task.id]);
  const removed = task.tracking?.inPriorities === false && task.tracking?.priorityRemoved !== false;
  if (task.assignee !== "me" || !(isPriorityTask(task, links) || allowRemoved && removed)) throw new Error("Choisis une priorité personnelle encore suivie.");
  if (write && priorityRevision(task, links) !== revision(value.priorityRevision)) throw new Error("La priorité a changé. Actualise avant de réessayer.");
  return task;
}
const relation = (db: WorkMemoryDatabase, childId: string, parentId: string) => db.listTaskLinks([childId]).find(link => link.targetKind === "task" && link.targetId === parentId && link.metadata?.priorityWork === true);
function checkTask(db: WorkMemoryDatabase, task: TaskRecord, expected: unknown) {
  if (priorityRevision(task, db.listTaskLinks([task.id])) !== revision(expected)) throw new Error("La tâche a changé. Actualise avant de réessayer.");
}
function readTask(db: WorkMemoryDatabase, id: string) { return listTaskReadModel(db, []).find(task => task.id === id)!; }
function attach(db: WorkMemoryDatabase, task: TaskRecord, priority: TaskRecord) {
  if (task.id === priority.id) throw new Error("Une priorité ne peut pas être sa propre tâche.");
  const visited = new Set<string>(), pending = [priority.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === task.id) throw new Error("Ce rattachement créerait une boucle entre priorités et tâches.");
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...db.listTaskLinks([id]).filter(link => link.targetKind === "task" && link.metadata?.priorityWork === true).map(link => link.targetId));
  }
  const same = db.listTaskLinks([task.id]).find(link => link.relationType === "supports" && link.targetKind === "task" && link.targetId === priority.id);
  db.upsertTaskLink({ taskId: task.id, relationType: "supports", targetKind: "task", targetId: priority.id, label: same?.label,
    metadata: { ...same?.metadata, priorityWork: true, priorityWorkOwnsLink: same ? same.metadata?.priorityWorkOwnsLink === true : true } });
}

/** Existing native tasks are reused; proposals are never silently materialized. */
export function listPriorityTasks(db: WorkMemoryDatabase, raw: unknown) {
  const value = input(raw, ["query", "limit", "offset"]), priority = parent(db, value, false, true);
  const query = value.query === undefined || value.query === "" ? "" : text(value.query, "query", 500).toLocaleLowerCase("fr");
  const limit = value.limit ?? 100, offset = value.offset ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100 || !Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 1000000) throw new Error("Pagination invalide.");
  const linked = new Set(db.listTaskLinksForTargets([{ kind: "task", id: priority.id }]).filter(link => link.metadata?.priorityWork === true).map(link => link.taskId));
  const tasks = listTaskReadModel(db, []).filter(task => task.priorityRevision && task.status !== "archived");
  const items = tasks.filter(task => linked.has(task.id)).sort((a, b) => a.createdAt!.localeCompare(b.createdAt!) || a.id.localeCompare(b.id));
  const available = tasks.filter(task => task.id !== priority.id && !linked.has(task.id) && (!query || task.title.toLocaleLowerCase("fr").includes(query)))
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));
  return { priorityId: priority.id, priorityTitle: priority.title, priorityRevision: priorityRevision(priority, db.listTaskLinks([priority.id])), items,
    choices: available.slice(Number(offset), Number(offset) + Number(limit)).map(task => ({ id: task.id, title: task.title, status: task.status, assignee: task.assignee, revision: task.priorityRevision })),
    totalChoices: available.length, nextOffset: Number(offset) + Number(limit) < available.length ? Number(offset) + Number(limit) : null };
}

export function attachPriorityTask(db: WorkMemoryDatabase, raw: unknown) {
  const value = input(raw, ["priorityRevision", "taskId", "taskRevision"]);
  return db.runInImmediateTransaction(() => {
    const priority = parent(db, value, true), task = native(db, value.taskId);
    checkTask(db, task, value.taskRevision); attach(db, task, priority);
    return { priorityId: priority.id, task: readTask(db, task.id) };
  });
}
export function detachPriorityTask(db: WorkMemoryDatabase, raw: unknown) {
  const value = input(raw, ["priorityRevision", "taskId", "taskRevision"]);
  return db.runInImmediateTransaction(() => {
    const priority = parent(db, value, true, true), task = native(db, value.taskId);
    checkTask(db, task, value.taskRevision);
    const link = relation(db, task.id, priority.id);
    if (!link) throw new Error("Cette tâche n’est plus rattachée à cette priorité.");
    if (link.metadata?.priorityWorkOwnsLink === true) db.removeTaskLink(task.id, link.id);
    else {
      const metadata = { ...link.metadata }; delete metadata.priorityWork; delete metadata.priorityWorkOwnsLink;
      db.upsertTaskLink({ ...link, metadata });
    }
    return { detached: true, priorityId: priority.id, task: readTask(db, task.id) };
  });
}
export function savePriorityTask(db: WorkMemoryDatabase, raw: unknown) {
  const value = input(raw, ["priorityRevision", "taskId", "taskRevision", "title", "body", "status", "priority", "assignee", "deadline", "notes"]);
  return db.runInImmediateTransaction(() => {
    const priority = parent(db, value, true), existing = value.taskId !== undefined ? native(db, value.taskId) : undefined;
    if (existing) {
      checkTask(db, existing, value.taskRevision);
      if (!relation(db, existing.id, priority.id)) throw new Error("Cette tâche n’est plus rattachée à cette priorité.");
    } else if (value.taskRevision !== undefined) throw new Error("Une création ne prend pas de révision de tâche.");
    const update: Omit<TaskUpdateInput, "taskId"> = {};
    for (const [key, max] of [["title", 300], ["body", 10000], ["notes", 10000]] as const) {
      if (value[key] === undefined) continue;
      if (key !== "title" && value[key] === "") update[key] = "";
      else update[key] = text(value[key], key, max);
    }
    for (const [key, options] of [["status", statuses], ["priority", ["low", "medium", "high", "critical"]], ["assignee", ["me", "agent"]]] as const) {
      if (value[key] === undefined) continue;
      const result = text(value[key], key, 32);
      if (!(options as readonly string[]).includes(result)) throw new Error(`Valeur invalide : ${key}`);
      update[key] = result;
    }
    if (value.deadline !== undefined) {
      if (value.deadline !== "" && (typeof value.deadline !== "string" || !validDay(value.deadline))) throw new Error("Date de tâche invalide.");
      update.deadline = value.deadline === "" ? null : value.deadline as string;
    }
    if (!existing && !update.title) throw new Error("Indique le titre de la tâche.");
    let id;
    if (existing) id = db.updateTask({ taskId: existing.id, ...update }).id;
    else {
      const about = db.listTaskLinks([priority.id]).filter(link => link.relationType === "about" && link.metadata?.priorityPrimary === true);
      const created = createTask(db, { title: update.title!, productId: priority.productId,
        status: update.status as TaskStatus | undefined, priority: update.priority as TaskPriority | undefined, assignee: update.assignee as TaskAssignee | undefined, deadline: update.deadline ?? undefined, body: update.body ?? undefined, notes: update.notes ?? undefined,
        links: about.map(link => ({ relationType: "about", targetKind: link.targetKind, targetId: link.targetId })) });
      id = created.id; attach(db, db.getTask(id)!, priority);
    }
    return { priorityId: priority.id, task: readTask(db, id) };
  });
}
