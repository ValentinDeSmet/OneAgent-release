import { createHash } from "node:crypto";
import type { TaskRecord, TaskLinkRecord, WorkMemoryDatabase } from "../../storage/src/index.ts";

type Input = Record<string, unknown>;
const priorities = ["critical", "high", "medium", "low"];
const statuses = ["pending", "candidate", "ready", "open", "in_progress", "blocked", "done"];
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
function personalTasks(db: WorkMemoryDatabase): TaskRecord[] {
  return db.listTasks().filter(task => task.assignee === "me" && task.status !== "archived" && !task.archivedAt);
}
function manualRank(task: TaskRecord): number | undefined {
  const value = task.tracking?.manualRank;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? value : undefined;
}
function initialOrder(a: TaskRecord, b: TaskRecord): number {
  const date = (task: TaskRecord) => (task.deadline || task.tracking?.targetDate || "9999").slice(0, 10);
  return rank(a.priority) - rank(b.priority) || date(a).localeCompare(date(b)) || a.id.localeCompare(b.id);
}
function manualOrder(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((a, b) => {
    const ar = manualRank(a), br = manualRank(b);
    if (ar !== undefined || br !== undefined) return ar === undefined ? 1 : br === undefined ? -1 : ar - br || a.id.localeCompare(b.id);
    return initialOrder(a, b);
  });
}
function orderRevision(tasks: TaskRecord[]): string {
  // Bind the whole order, including hidden rows and other pages. Ordinary edits
  // remain possible: their updated tracking is read again inside the transaction.
  return createHash("sha256").update(JSON.stringify(tasks.map(task => [task.id, manualRank(task) ?? null]))).digest("hex");
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
function relatedRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40) throw new Error("Choisis au maximum 40 produits ou équipes partenaires.");
  return [...new Set(value.map(ref => text(ref, "relatedEntityRefs", 512)))].sort();
}
function priorityType(task: TaskRecord, links: TaskLinkRecord[]): "subject" | "task" {
  if (task.tracking?.itemType === "subject" || task.tracking?.itemType === "task") return task.tracking.itemType;
  // Existing rows created in Priorities are subjects; ordinary native tasks stay
  // tasks. Classification never depends on a title, label or guessed intent.
  return links.some(link => link.metadata?.priorityPrimary === true) ? "subject" : "task";
}
function syncRelatedLinks(db: WorkMemoryDatabase, taskId: string, refs: string[]) {
  const links = db.listTaskLinks([taskId]);
  for (const link of links.filter(link => link.metadata?.priorityRelated === true && !refs.includes(`${link.targetKind}:${link.targetId}`))) {
    if (link.metadata?.priorityOwnsLink === true) db.removeTaskLink(taskId, link.id);
    else {
      const metadata = { ...link.metadata }; delete metadata.priorityRelated;
      db.upsertTaskLink({ ...link, metadata });
    }
  }
  for (const ref of refs) {
    const [targetKind, ...parts] = ref.split(":");
    const targetId = parts.join(":");
    const same = links.find(link => link.relationType === "concerns" && link.targetKind === targetKind && link.targetId === targetId);
    db.upsertTaskLink({ taskId, relationType: "concerns", targetKind, targetId, label: same?.label,
      metadata: { ...same?.metadata, priorityRelated: true, priorityOwnsLink: same ? same.metadata?.priorityOwnsLink === true : true } });
  }
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
    ...task, ...placement, tracking: undefined, revision: revision(task, links), url: tracking.url ?? "", sourceUrl: tracking.sourceUrl ?? "",
    itemType: priorityType(task, links), relatedEntityRefs: tracking.relatedEntityRefs ?? [],
    relatedEntities: (tracking.relatedEntityRefs ?? []).map(ref => ({ ref, kind: ref.split(":")[0], label: entities.get(ref)?.label ?? ref })),
    requester: tracking.requester ?? "", nextAction: tracking.nextAction ?? "",
    deadline, deadlineKind, deadlineLabel: tracking.deadlineLabel ?? "",
    overdue: active && deadlineKind === "exact" && daysUntil !== null && daysUntil < 0,
    dueSoon: active && deadlineKind === "exact" && daysUntil !== null && daysUntil >= 0 && daysUntil <= 7,
    needsClarification: active && (!tracking.requester || deadlineKind === "unknown" || placement.needsAttachment), daysUntil
  };
}

/** Native, explicitly created tasks only: Inbox/concept proposals are not commitments. */
export function listPriorities(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "today", "query", "view", "filter", "offset", "limit", "sortBy", "sortDirection", "titleQuery", "bodyQuery", "requesterQuery", "urlQuery", "entity", "productId", "priority", "status", "deadlineKind", "deadlineFrom", "deadlineTo", "sourceUrlQuery", "itemType", "involvedEntity", "relatedEntity"]);
  const today = text(input.today, "today", 10, localDay());
  if (!validDay(today)) throw new Error("Date locale invalide (AAAA-MM-JJ).");
  const view = choice(input.view, "view", ["active", "done", "all"], "active");
  const filter = choice(input.filter, "filter", ["all", "urgent", "overdue", "soon", "clarify", "waiting", "unlinked"], "all");
  const sortBy = choice(input.sortBy, "sortBy", ["manual", "title", "body", "entity", "product", "relatedEntities", "requester", "priority", "deadline", "url", "sourceUrl", "status", "nextAction", "itemType"], "manual");
  const direction = choice(input.sortDirection, "sortDirection", ["asc", "desc"], "asc") === "asc" ? 1 : -1;
  const query = text(input.query, "query", 500);
  const entity = text(input.entity, "entity", 512), productId = text(input.productId, "productId", 256);
  const involvedEntity = text(input.involvedEntity, "involvedEntity", 512), relatedEntity = text(input.relatedEntity, "relatedEntity", 512);
  const itemType = choice(input.itemType, "itemType", ["all", "subject", "task"], "all");
  const priority = choice(input.priority, "priority", ["", ...priorities], "");
  const status = choice(input.status, "status", ["", ...statuses], "");
  const deadlineKind = choice(input.deadlineKind, "deadlineKind", ["", ...kinds], "");
  const from = text(input.deadlineFrom, "deadlineFrom", 10), to = text(input.deadlineTo, "deadlineTo", 10);
  if (from && !validDay(from) || to && !validDay(to) || from && to && from > to) throw new Error("Intervalle de dates invalide.");
  const titleQuery = text(input.titleQuery, "titleQuery", 500), bodyQuery = text(input.bodyQuery, "bodyQuery", 500);
  const requesterQuery = text(input.requesterQuery, "requesterQuery", 300), urlQuery = text(input.urlQuery, "urlQuery", 500);
  const sourceUrlQuery = text(input.sourceUrlQuery, "sourceUrlQuery", 500);
  const limit = input.limit ?? 100, offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100 || !Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 1000000) throw new Error("Pagination invalide.");
  const choices = entityChoices(db), byRef = new Map(choices.map((entity) => [entity.ref, entity]));
  const tasks = manualOrder(personalTasks(db));
  const links = new Map<string, TaskLinkRecord[]>();
  for (const link of db.listTaskLinks(tasks.map((task) => task.id))) links.set(link.taskId, [...(links.get(link.taskId) ?? []), link]);
  const all = tasks.map((task, index) => ({ ...priorityItem(task, today, links.get(task.id) ?? [], byRef), manualPosition: index + 1 }));
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  const matches = (value: string | undefined, search: string) => !search || normalize(value ?? "").includes(normalize(search));
  const matching = all.filter(task => (itemType === "all" || task.itemType === itemType)
    && (!query || [task.title, task.body, task.requester, task.nextAction, task.entityLabel, task.entity, task.productLabel, task.url, task.sourceUrl, task.deadline, task.deadlineLabel,
      ...task.relatedEntities.flatMap(entity => [entity.label, entity.ref])].some(value => matches(value, query)))
    && matches(task.title, titleQuery) && matches(task.body, bodyQuery) && matches(task.requester, requesterQuery) && matches(task.url, urlQuery) && matches(task.sourceUrl, sourceUrlQuery)
    && (!entity || task.entity === entity) && (!productId || task.productId === productId)
    && (!relatedEntity || task.relatedEntityRefs.includes(relatedEntity))
    && (!involvedEntity || task.relatedEntityRefs.includes(involvedEntity) || !!task.productId && involvedEntity === `product:${task.productId}`
      || ["product", "team"].includes(task.entity.split(":")[0]) && task.entity === involvedEntity)
    && (!priority || task.priority === priority) && (!status || task.status === status) && (!deadlineKind || task.deadlineKind === deadlineKind)
    && (!from || !!task.deadline && task.deadline >= from) && (!to || !!task.deadline && task.deadline <= to));
  // Metrics follow the user's product/team, nature and field filters, before
  // pagination. A metric click still reports the whole matching active scope.
  const active = matching.filter(task => task.status !== "done");
  const counts = { active: active.length, urgent: active.filter(task => ["high", "critical"].includes(task.priority)).length,
    overdue: active.filter(task => task.overdue).length, soon: active.filter(task => task.dueSoon).length,
    clarify: active.filter(task => task.needsClarification).length, waiting: active.filter(task => task.status === "blocked").length,
    unlinked: active.filter(task => task.needsAttachment).length };
  const items = matching.filter(task => (view === "all" || (view === "done" ? task.status === "done" : task.status !== "done"))
    && (filter === "all" || filter === "urgent" && task.status !== "done" && ["high", "critical"].includes(task.priority)
      || filter === "overdue" && task.overdue || filter === "soon" && task.dueSoon
      || filter === "clarify" && task.needsClarification || filter === "waiting" && task.status === "blocked" || filter === "unlinked" && task.needsAttachment));
  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
  const sortValue = (task: typeof all[number]): string => sortBy === "entity" ? task.entityLabel : sortBy === "product" ? task.productLabel : sortBy === "relatedEntities" ? task.relatedEntities.map(entity => entity.label).join(", ") : String(task[sortBy as keyof typeof task] ?? "");
  items.sort((a, b) => {
    if (sortBy === "manual") return direction * (a.manualPosition - b.manualPosition);
    const av = sortValue(a), bv = sortValue(b);
    const comparison = sortBy === "priority" ? direction * (rank(a.priority) - rank(b.priority))
      : !av !== !bv ? Number(!av) - Number(!bv) : direction * collator.compare(av, bv);
    return comparison || (sortBy === "priority" ? (a.deadline || "9999").localeCompare(b.deadline || "9999") : 0) || a.id.localeCompare(b.id);
  });
  return { today, counts, orderRevision: orderRevision(tasks), entities: choices, items: items.slice(Number(offset), Number(offset) + Number(limit)), total: items.length,
    nextOffset: Number(offset) + Number(limit) < items.length ? Number(offset) + Number(limit) : null };
}
function rank(value: string): number { const index = priorities.indexOf(value); return index < 0 ? 2 : index; }

/** Move one personal row relative to another, preserving every other row's order. */
export function reorderPriority(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "taskId", "targetTaskId", "position", "orderRevision"]);
  const taskId = text(input.taskId, "taskId", 256), targetTaskId = text(input.targetTaskId, "targetTaskId", 256);
  const position = choice(input.position, "position", ["before", "after"], "before");
  const expected = text(input.orderRevision, "orderRevision", 64);
  if (!taskId || !targetTaskId || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Déplacement invalide : utilise les identifiants et la révision de classement renvoyés par la liste.");
  return db.runInImmediateTransaction(() => {
    const ordered = manualOrder(personalTasks(db));
    const current = orderRevision(ordered);
    if (expected !== current) throw new Error("Le classement a changé. Actualise la liste avant de déplacer une priorité.");
    const moved = ordered.find(task => task.id === taskId);
    if (!moved || !ordered.some(task => task.id === targetTaskId)) throw new Error("Priorité introuvable, archivée ou hors de tes sollicitations personnelles.");
    if (taskId === targetTaskId) return { moved: false, orderRevision: current };
    const next = ordered.filter(task => task.id !== taskId);
    const targetIndex = next.findIndex(task => task.id === targetTaskId);
    next.splice(targetIndex + (position === "after" ? 1 : 0), 0, moved);
    if (next.every((task, index) => task.id === ordered[index].id)) return { moved: false, orderRevision: current };
    // Dense ranks avoid floating-point gaps and stay durable in the existing
    // tracking JSON. Filters and pagination never replace the portfolio order.
    const saved = next.map((task, index) => manualRank(task) === index ? task
      : db.updateTask({ taskId: task.id, tracking: { ...task.tracking, manualRank: index } }));
    return { moved: true, orderRevision: orderRevision(saved) };
  });
}

/** One transaction, ID-based edits and optimistic conflict detection across hosts. */
export function savePriority(db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["scope", "taskId", "revision", "title", "body", "requester", "priority", "status", "deadline", "deadlineKind", "deadlineLabel", "nextAction", "entity", "productId", "url", "sourceUrl", "itemType", "relatedEntityRefs"]);
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
    const relatedEntityRefs = relatedRefs(input.relatedEntityRefs ?? before?.relatedEntityRefs ?? [])
      .filter(ref => ref !== `product:${productId}` && ref !== entity.ref);
    for (const ref of relatedEntityRefs) {
      const related = checkedEntity(ref, entities);
      if (!["product", "team"].includes(related.kind)) throw new Error("Un partenaire doit être un produit ou une équipe existante.");
    }
    const itemType = choice(input.itemType, "itemType", ["subject", "task"], before?.itemType ?? "subject") as "subject" | "task";
    const inputTask = {
      productId: productId || null,
      title, body: text(input.body, "body", 10000, existing?.body),
      priority: choice(input.priority, "priority", priorities, existing?.priority ?? "medium"),
      status: choice(input.status, "status", statuses, existing?.status ?? "open"),
      // Only firm commitments enter the legacy deadline column used by Today.
      deadline: deadlineKind === "exact" ? deadline : null,
      tracking: { ...existing?.tracking, itemType, relatedEntityRefs,
        sourceUrl: checkedUrl(text(input.sourceUrl, "sourceUrl", 2048, before?.sourceUrl)), url: checkedUrl(text(input.url, "url", 2048, before?.url)), requester: text(input.requester, "requester", 300, before?.requester), deadlineKind: deadlineKind as "exact" | "approximate" | "unknown",
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
    syncRelatedLinks(db, saved.id, relatedEntityRefs);
    return priorityItem(saved, localDay(), db.listTaskLinks([saved.id]), entities);
  });
}
