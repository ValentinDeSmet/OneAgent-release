import { createHash } from "node:crypto";
import type { TaskRecord, TaskLinkRecord, WorkMemoryDatabase } from "../../storage/src/index.ts";

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
function revision(task: TaskRecord, links: TaskLinkRecord[]): string {
  return createHash("sha256").update(JSON.stringify([task, [...links].sort((a, b) => a.id.localeCompare(b.id))])).digest("hex");
}
function entityChoices(db: WorkMemoryDatabase) {
  return db.listEntities().filter((entity) => entity.status !== "archived")
    .map(({ kind, id, label }) => ({ ref: `${kind}:${id}`, kind, id, label }));
}
type EntityChoice = ReturnType<typeof entityChoices>[number];
function taskPlacement(task: TaskRecord, links: TaskLinkRecord[], entities: Map<string, EntityChoice>) {
  const about = links.filter((link) => link.relationType === "about");
  const primary = about.find((link) => link.metadata?.priorityPrimary === true);
  const valid = about.filter((link) => entities.has(`${link.targetKind}:${link.targetId}`));
  // Old tasks are resolved only from an explicit primary, an unambiguous existing
  // about link or their product. Never invent an attachment for an orphan task.
  const ref = primary ? `${primary.targetKind}:${primary.targetId}` : valid.length === 1
    ? `${valid[0].targetKind}:${valid[0].targetId}` : !valid.length && task.productId ? `product:${task.productId}` : "";
  const entity = entities.get(ref);
  return { entity: entity?.ref ?? "", entityLabel: entity?.label ?? "", needsAttachment: !entity,
    productLabel: task.productId ? entities.get(`product:${task.productId}`)?.label ?? task.productId : "" };
}
function checkedEntity(value: string, entities: Map<string, EntityChoice>): EntityChoice {
  const entity = entities.get(value);
  if (!entity) throw new Error("Choisis une entité existante et active pour rattacher cette priorité.");
  return entity;
}
function checkedUrl(value: string): string {
  if (!value) return "";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("URL invalide : utilise une adresse http:// ou https://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("URL invalide : utilise http:// ou https://, sans identifiants intégrés.");
  return value;
}
export function priorityItem(task: TaskRecord, today: string, links: TaskLinkRecord[] = [], entities = new Map<string, EntityChoice>()) {
  const placement = taskPlacement(task, links, entities);
  const tracking = task.tracking ?? {};
  const day = (task.deadline || tracking.targetDate)?.slice(0, 10) ?? "";
  const deadline = validDay(day) ? day : "";
  const deadlineKind = task.deadline && validDay(task.deadline.slice(0, 10)) ? "exact"
    : tracking.deadlineKind === "approximate" ? "approximate" : "unknown";
  const active = task.status !== "done";
  const daysUntil = deadline ? Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000) : null;
  return {
    ...task, ...placement, tracking: undefined, revision: revision(task, links), url: tracking.url ?? "",
    requester: tracking.requester ?? "", nextAction: tracking.nextAction ?? "",
    deadline, deadlineKind, deadlineLabel: tracking.deadlineLabel ?? "",
    overdue: active && deadlineKind === "exact" && daysUntil !== null && daysUntil < 0,
    dueSoon: active && deadlineKind === "exact" && daysUntil !== null && daysUntil >= 0 && daysUntil <= 7,
    needsClarification: active && (!tracking.requester || deadlineKind === "unknown" || placement.needsAttachment), daysUntil
  };
}

/** Native, explicitly created tasks only: Inbox/concept proposals are not commitments. */
export function listPriorities(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "today", "query", "view", "filter", "offset", "limit", "sortBy", "sortDirection", "titleQuery", "bodyQuery", "requesterQuery", "urlQuery", "entity", "productId", "priority", "status", "deadlineKind", "deadlineFrom", "deadlineTo"]);
  const today = text(input.today, "today", 10, localDay());
  if (!validDay(today)) throw new Error("Date locale invalide (AAAA-MM-JJ).");
  const view = choice(input.view, "view", ["active", "done", "all"], "active");
  const filter = choice(input.filter, "filter", ["all", "urgent", "overdue", "soon", "clarify", "waiting", "unlinked"], "all");
  const sortBy = choice(input.sortBy, "sortBy", ["title", "body", "entity", "product", "requester", "priority", "deadline", "url", "status", "nextAction"], "priority");
  const direction = choice(input.sortDirection, "sortDirection", ["asc", "desc"], "asc") === "asc" ? 1 : -1;
  const query = text(input.query, "query", 500);
  const entity = text(input.entity, "entity", 512), productId = text(input.productId, "productId", 256);
  const priority = choice(input.priority, "priority", ["", ...priorities], "");
  const status = choice(input.status, "status", ["", ...statuses], "");
  const deadlineKind = choice(input.deadlineKind, "deadlineKind", ["", ...kinds], "");
  const from = text(input.deadlineFrom, "deadlineFrom", 10), to = text(input.deadlineTo, "deadlineTo", 10);
  if (from && !validDay(from) || to && !validDay(to) || from && to && from > to) throw new Error("Intervalle de dates invalide.");
  const titleQuery = text(input.titleQuery, "titleQuery", 500), bodyQuery = text(input.bodyQuery, "bodyQuery", 500);
  const requesterQuery = text(input.requesterQuery, "requesterQuery", 300), urlQuery = text(input.urlQuery, "urlQuery", 500);
  const limit = input.limit ?? 100, offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100 || !Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 1000000) throw new Error("Pagination invalide.");
  const choices = entityChoices(db), byRef = new Map(choices.map((entity) => [entity.ref, entity]));
  const tasks = db.listTasks().filter((task) => task.assignee === "me" && task.status !== "archived");
  const links = new Map<string, TaskLinkRecord[]>();
  for (const link of db.listTaskLinks(tasks.map((task) => task.id))) links.set(link.taskId, [...(links.get(link.taskId) ?? []), link]);
  const all = tasks.map((task) => priorityItem(task, today, links.get(task.id) ?? [], byRef));
  const active = all.filter((task) => task.status !== "done");
  const counts = { active: active.length, urgent: active.filter((task) => ["high", "critical"].includes(task.priority)).length,
    overdue: active.filter((task) => task.overdue).length, soon: active.filter((task) => task.dueSoon).length,
    clarify: active.filter((task) => task.needsClarification).length, waiting: active.filter((task) => task.status === "blocked").length,
    unlinked: active.filter((task) => task.needsAttachment).length };
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  const matches = (value: string | undefined, search: string) => !search || normalize(value ?? "").includes(normalize(search));
  const items = all.filter((task) => (view === "all" || (view === "done" ? task.status === "done" : task.status !== "done"))
    && (!query || [task.title, task.body, task.requester, task.nextAction, task.entityLabel, task.entity, task.productLabel, task.url, task.deadline, task.deadlineLabel].some((value) => matches(value, query)))
    && matches(task.title, titleQuery) && matches(task.body, bodyQuery) && matches(task.requester, requesterQuery) && matches(task.url, urlQuery)
    && (!entity || task.entity === entity) && (!productId || task.productId === productId)
    && (!priority || task.priority === priority) && (!status || task.status === status) && (!deadlineKind || task.deadlineKind === deadlineKind)
    && (!from || !!task.deadline && task.deadline >= from) && (!to || !!task.deadline && task.deadline <= to)
    && (filter === "all" || filter === "urgent" && task.status !== "done" && ["high", "critical"].includes(task.priority)
      || filter === "overdue" && task.overdue || filter === "soon" && task.dueSoon
      || filter === "clarify" && task.needsClarification || filter === "waiting" && task.status === "blocked" || filter === "unlinked" && task.needsAttachment));
  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
  const sortValue = (task: typeof all[number]): string => sortBy === "entity" ? task.entityLabel : sortBy === "product" ? task.productLabel : String(task[sortBy as keyof typeof task] ?? "");
  items.sort((a, b) => {
    const av = sortValue(a), bv = sortValue(b);
    const comparison = sortBy === "priority" ? direction * (rank(a.priority) - rank(b.priority))
      : !av !== !bv ? Number(!av) - Number(!bv) : direction * collator.compare(av, bv);
    return comparison || (sortBy === "priority" ? (a.deadline || "9999").localeCompare(b.deadline || "9999") : 0) || a.id.localeCompare(b.id);
  });
  return { today, counts, entities: choices, items: items.slice(Number(offset), Number(offset) + Number(limit)), total: items.length,
    nextOffset: Number(offset) + Number(limit) < items.length ? Number(offset) + Number(limit) : null };
}
function rank(value: string): number { const index = priorities.indexOf(value); return index < 0 ? 2 : index; }

/** One transaction, ID-based edits and optimistic conflict detection across hosts. */
export function savePriority(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "taskId", "revision", "title", "body", "requester", "priority", "status", "deadline", "deadlineKind", "deadlineLabel", "nextAction", "entity", "productId", "url"]);
  return db.runInImmediateTransaction(() => {
    const id = text(input.taskId, "taskId", 256);
    if (input.taskId !== undefined && !id) throw new Error("Identifiant de sollicitation vide.");
    const existing = id ? db.getTask(id) : undefined;
    if (id && (!existing || existing.archivedAt || existing.status === "archived" || existing.assignee !== "me")) throw new Error("Sollicitation introuvable ou archivée.");
    const links = existing ? db.listTaskLinks([existing.id]) : [];
    const entities = new Map(entityChoices(db).map((entity) => [entity.ref, entity]));
    if (existing && text(input.revision, "revision", 64) !== revision(existing, links)) throw new Error("Cette sollicitation a changé. Actualise la liste et rouvre la fiche avant de réappliquer tes modifications.");
    if (!existing && input.revision !== undefined) throw new Error("Une création ne prend pas de révision.");
    const before = existing ? priorityItem(existing, localDay(), links, entities) : undefined;
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
    const entity = checkedEntity(text(input.entity, "entity", 512, before?.entity), entities);
    const productId = text(input.productId, "productId", 256, entity.kind === "product" ? entity.id : existing?.productId);
    if (productId) checkedEntity(`product:${productId}`, entities);
    if (entity.kind === "product" && productId !== entity.id) throw new Error("Le produit concerné doit correspondre à l’entité produit choisie.");
    const inputTask = {
      productId: productId || null,
      title, body: text(input.body, "body", 10000, existing?.body),
      priority: choice(input.priority, "priority", priorities, existing?.priority ?? "medium"),
      status: choice(input.status, "status", statuses, existing?.status ?? "open"),
      // Only firm commitments enter the legacy deadline column used by Today.
      deadline: deadlineKind === "exact" ? deadline : null,
      tracking: { ...existing?.tracking, url: checkedUrl(text(input.url, "url", 2048, before?.url)), requester: text(input.requester, "requester", 300, before?.requester), deadlineKind: deadlineKind as "exact" | "approximate" | "unknown",
        deadlineLabel, targetDate: deadlineKind === "approximate" ? deadline : "", nextAction: text(input.nextAction, "nextAction", 2000, before?.nextAction) }
    };
    const saved = existing ? db.updateTask({ taskId: existing.id, ...inputTask })
      : db.createTask({ ...inputTask, assignee: "me", origin: "manual" });
    const same = links.find((link) => link.relationType === "about" && link.targetKind === entity.kind && link.targetId === entity.id);
    for (const link of links.filter((link) => link.metadata?.priorityPrimary === true && link.id !== same?.id)) {
      if (link.metadata?.priorityOwnsLink === true) db.removeTaskLink(saved.id, link.id);
      else {
        const metadata = { ...link.metadata }; delete metadata.priorityPrimary;
        db.upsertTaskLink({ ...link, metadata });
      }
    }
    db.upsertTaskLink({ taskId: saved.id, relationType: "about", targetKind: entity.kind, targetId: entity.id,
      label: same?.label, metadata: { ...same?.metadata, priorityPrimary: true, priorityOwnsLink: same ? same.metadata?.priorityOwnsLink === true : true } });
    return priorityItem(saved, localDay(), db.listTaskLinks([saved.id]), entities);
  });
}
