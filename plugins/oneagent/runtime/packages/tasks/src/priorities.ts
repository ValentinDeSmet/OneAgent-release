import { createHash } from "node:crypto";
import type { TaskRecord, WorkMemoryDatabase } from "../../storage/src/index.ts";

type Input = Record<string, unknown>;
const priorities = ["critical", "high", "medium", "low"];
const statuses = ["pending", "candidate", "ready", "open", "blocked", "done"];
const kinds = ["exact", "approximate", "unknown"];
const object = (raw: unknown): Input => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Objet JSON attendu.");
  return raw as Input;
};
function fields(raw: unknown, allowed: string[]): Input {
  const input = object(raw);
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`Champ inconnu : ${key}`);
  if (input.scope !== "portfolio") throw new Error("Le périmètre portfolio est obligatoire.");
  return input;
}
function text(value: unknown, name: string, max: number, fallback = ""): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.includes("\0") || value.length > max) throw new Error(`Champ invalide : ${name}`);
  return value.trim();
}
function choice(value: unknown, name: string, options: string[], fallback: string): string {
  const result = text(value, name, 32, fallback);
  if (!options.includes(result)) throw new Error(`Valeur invalide : ${name}`);
  return result;
}
export function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function revision(task: TaskRecord): string {
  return createHash("sha256").update(JSON.stringify(task)).digest("hex");
}
export function priorityItem(task: TaskRecord, today: string) {
  const tracking = task.tracking ?? {};
  const day = (task.deadline || tracking.targetDate)?.slice(0, 10) ?? "";
  const deadline = validDay(day) ? day : "";
  const deadlineKind = task.deadline && validDay(task.deadline.slice(0, 10)) ? "exact"
    : tracking.deadlineKind === "approximate" ? "approximate" : "unknown";
  const active = task.status !== "done";
  const daysUntil = deadline ? Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000) : null;
  return {
    ...task, tracking: undefined, revision: revision(task),
    requester: tracking.requester ?? "", nextAction: tracking.nextAction ?? "",
    deadline, deadlineKind, deadlineLabel: tracking.deadlineLabel ?? "",
    overdue: active && deadlineKind === "exact" && daysUntil !== null && daysUntil < 0,
    dueSoon: active && deadlineKind === "exact" && daysUntil !== null && daysUntil >= 0 && daysUntil <= 7,
    needsClarification: active && (!tracking.requester || deadlineKind === "unknown"), daysUntil
  };
}

/** Native, explicitly created tasks only: Inbox/concept proposals are not commitments. */
export function listPriorities(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "today", "query", "view", "filter", "offset", "limit"]);
  const today = text(input.today, "today", 10, localDay());
  if (!validDay(today)) throw new Error("Date locale invalide (AAAA-MM-JJ).");
  const view = choice(input.view, "view", ["active", "done", "all"], "active");
  const filter = choice(input.filter, "filter", ["all", "urgent", "overdue", "soon", "clarify", "waiting"], "all");
  const query = text(input.query, "query", 500).toLocaleLowerCase("fr");
  const limit = input.limit ?? 100, offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100 || !Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 1000000) throw new Error("Pagination invalide.");
  const all = db.listTasks().filter((task) => task.assignee === "me" && task.status !== "archived")
    .map((task) => priorityItem(task, today));
  const active = all.filter((task) => task.status !== "done");
  const counts = { active: active.length, urgent: active.filter((task) => ["high", "critical"].includes(task.priority)).length,
    overdue: active.filter((task) => task.overdue).length, soon: active.filter((task) => task.dueSoon).length,
    clarify: active.filter((task) => task.needsClarification).length, waiting: active.filter((task) => task.status === "blocked").length };
  const items = all.filter((task) => (view === "all" || (view === "done" ? task.status === "done" : task.status !== "done"))
    && (!query || [task.title, task.body, task.requester, task.nextAction].some((value) => value?.toLocaleLowerCase("fr").includes(query)))
    && (filter === "all" || filter === "urgent" && task.status !== "done" && ["high", "critical"].includes(task.priority)
      || filter === "overdue" && task.overdue || filter === "soon" && task.dueSoon
      || filter === "clarify" && task.needsClarification || filter === "waiting" && task.status === "blocked"))
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done")
      || rank(a.priority) - rank(b.priority) || Number(b.overdue) - Number(a.overdue)
      || (a.deadline || "9999").localeCompare(b.deadline || "9999")
      || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { today, counts, items: items.slice(Number(offset), Number(offset) + Number(limit)), total: items.length,
    nextOffset: Number(offset) + Number(limit) < items.length ? Number(offset) + Number(limit) : null };
}
function rank(value: string): number { const index = priorities.indexOf(value); return index < 0 ? 2 : index; }

/** One transaction, ID-based edits and optimistic conflict detection across hosts. */
export function savePriority(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "taskId", "revision", "title", "body", "requester", "priority", "status", "deadline", "deadlineKind", "deadlineLabel", "nextAction"]);
  return db.runInImmediateTransaction(() => {
    const id = text(input.taskId, "taskId", 256);
    if (input.taskId !== undefined && !id) throw new Error("Identifiant de sollicitation vide.");
    const existing = id ? db.getTask(id) : undefined;
    if (id && (!existing || existing.archivedAt || existing.status === "archived" || existing.assignee !== "me")) throw new Error("Sollicitation introuvable ou archivée.");
    if (existing && text(input.revision, "revision", 64) !== revision(existing)) throw new Error("Cette sollicitation a changé. Actualise la liste et rouvre la fiche avant de réappliquer tes modifications.");
    if (!existing && input.revision !== undefined) throw new Error("Une création ne prend pas de révision.");
    const before = existing ? priorityItem(existing, localDay()) : undefined;
    const title = text(input.title, "title", 300, existing?.title);
    if (!title) throw new Error("Indique le sujet attendu.");
    const deadlineKind = choice(input.deadlineKind, "deadlineKind", kinds, before?.deadlineKind ?? "unknown");
    let deadline = text(input.deadline, "deadline", 10, before?.deadline ?? "");
    let deadlineLabel = text(input.deadlineLabel, "deadlineLabel", 150, before?.deadlineLabel);
    if (deadlineKind === "unknown") { deadline = ""; deadlineLabel = ""; }
    if (deadline && !validDay(deadline)) throw new Error("Échéance invalide (AAAA-MM-JJ).");
    if (deadlineKind === "exact" && !deadline) throw new Error("Une échéance ferme nécessite une date.");
    if (deadlineKind === "exact") deadlineLabel = "";
    if (deadlineKind === "approximate" && !deadline && !deadlineLabel) throw new Error("Indique une période estimée ou une date cible.");
    const inputTask = {
      title, body: text(input.body, "body", 10000, existing?.body),
      priority: choice(input.priority, "priority", priorities, existing?.priority ?? "medium"),
      status: choice(input.status, "status", statuses, existing?.status ?? "open"),
      // Only firm commitments enter the legacy deadline column used by Today.
      deadline: deadlineKind === "exact" ? deadline : null,
      tracking: { requester: text(input.requester, "requester", 300, before?.requester), deadlineKind: deadlineKind as "exact" | "approximate" | "unknown",
        deadlineLabel, targetDate: deadlineKind === "approximate" ? deadline : "", nextAction: text(input.nextAction, "nextAction", 2000, before?.nextAction) }
    };
    const saved = existing ? db.updateTask({ taskId: existing.id, ...inputTask })
      : db.createTask({ ...inputTask, assignee: "me", origin: "manual" });
    return priorityItem(saved, localDay());
  });
}
