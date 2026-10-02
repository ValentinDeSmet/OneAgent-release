"use strict";
const $ = (selector) => document.querySelector(selector);
const token = $('meta[name="oneagent-token"]').content;
const form = $("#form"), editor = $("#editor");
let items = [], nextOffset = null, selected = null, loading = false, saving = false, requestVersion = 0;
const priorityLabels = { critical: "Critique", high: "Haute", medium: "Normale", low: "Basse" };
const statusLabels = { open: "À faire", ready: "Prête", pending: "À clarifier", candidate: "À valider", blocked: "En attente", done: "Terminée" };
const day = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const dateLabel = (value) => new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
function error(target, message = "") { target.textContent = message; target.hidden = !message; }
async function api(operation, input) {
  const response = await fetch(`/api/${operation}`, { method: "POST", headers: { "Content-Type": "application/json", "X-OneAgent-Token": token }, body: JSON.stringify({ ...input, scope: "portfolio" }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "La demande a échoué.");
  return data;
}
function node(tag, text = "", className = "") {
  const result = document.createElement(tag); result.textContent = text; result.className = className; return result;
}
function render() {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = node("tr"), subject = node("td"), button = node("button", item.title, "subject");
    button.type = "button"; button.addEventListener("click", () => edit(item));
    subject.append(button);
    if (item.body) subject.append(node("p", item.body.length > 120 ? item.body.slice(0, 120) + "…" : item.body));
    const requester = node("td", item.requester || "À préciser", item.requester ? "" : "muted");
    const priority = node("td"); priority.append(node("span", priorityLabels[item.priority] || item.priority, `badge ${item.priority === "critical" ? "critical" : item.priority === "high" ? "high" : ""}`));
    const due = node("td");
    if (item.deadlineKind === "exact" && item.deadline) {
      due.append(node("span", dateLabel(item.deadline), item.overdue ? "overdue" : ""));
      if (item.overdue) due.append(node("p", `En retard de ${Math.abs(item.daysUntil)} j`, "overdue"));
      else if (item.daysUntil === 0 && item.status !== "done") due.append(node("p", "Aujourd’hui"));
      else if (item.dueSoon) due.append(node("p", `Dans ${item.daysUntil} j`));
    } else if (item.deadlineKind === "approximate") {
      due.append(node("span", item.deadlineLabel || (item.deadline ? dateLabel(item.deadline) : "À préciser")));
      due.append(node("p", `Estimation${item.deadlineLabel && item.deadline ? " · cible " + dateLabel(item.deadline) : ""}`, "estimate"));
    } else due.append(node("span", "À préciser", "muted"));
    const status = node("td"); status.append(node("span", statusLabels[item.status] || item.status, "badge"));
    row.append(subject, requester, priority, due, status, node("td", item.nextAction || "À définir", item.nextAction ? "" : "muted"));
    fragment.append(row);
  }
  $("#rows").replaceChildren(fragment);
}
async function refresh(append = false) {
  const version = ++requestVersion;
  loading = true; $("#refresh").disabled = true; $("#more").disabled = true;
  try {
    const data = await api("list", { today: day(), query: $("#search").value, view: $("#view").value, filter: $("#filter").value, limit: 100, offset: append ? nextOffset : 0 });
    if (version !== requestVersion) return;
    items = append ? [...items, ...data.items.filter((item) => !items.some((old) => old.id === item.id))] : data.items;
    nextOffset = data.nextOffset;
    for (const key of ["active", "urgent", "overdue", "clarify"]) $("#count-" + key).textContent = data.counts[key];
    for (const button of document.querySelectorAll("[data-filter]")) button.setAttribute("aria-pressed", String(button.dataset.filter === $("#filter").value && $("#view").value === "active"));
    render();
    $("#empty").hidden = items.length > 0;
    $(".table-wrap").hidden = items.length === 0;
    const filtered = Boolean($("#search").value || $("#filter").value !== "all" || $("#view").value !== "active");
    $("#empty-title").textContent = filtered ? "Aucune sollicitation dans cette vue" : "Aucune sollicitation active";
    $("#empty-text").textContent = filtered ? "Ajuste les filtres ou recherche un autre sujet ou demandeur." : "Ajoute ce que l’on attend de toi, même si la personne ou la date reste à préciser.";
    $("#more").hidden = nextOffset === null;
    $("#summary").textContent = `${items.length} sur ${data.total} sollicitation${data.total > 1 ? "s" : ""} · Actualisé à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    error($("#error"));
  } catch (failure) {
    if (version === requestVersion) { error($("#error"), failure.message); $("#summary").textContent = "Actualisation impossible · les données affichées peuvent être anciennes"; }
  } finally {
    if (version === requestVersion) { loading = false; $("#refresh").disabled = false; $("#more").disabled = false; }
  }
}
function deadlineFields() {
  const kind = form.elements.deadlineKind.value;
  $("#deadline-fields").hidden = kind === "unknown";
  $("#period-field").hidden = kind !== "approximate";
  form.elements.deadline.required = kind === "exact";
  form.elements.deadline.disabled = kind === "unknown";
  form.elements.deadlineLabel.disabled = kind !== "approximate";
  $("#date-label").textContent = kind === "approximate" ? "Date cible (facultative)" : "Date attendue";
  $("#date-help").textContent = kind === "approximate" ? "La période suffit. Une date cible peut aider au tri ; elle ne déclenche pas d’alerte de retard." : kind === "exact" ? "Une date ferme dépassée apparaîtra dans les retards." : "Une échéance inconnue reste visible comme « À préciser ».";
}
function edit(item = null) {
  selected = item; form.reset(); error($("#form-error"));
  $("#editor-title").textContent = item ? "Suivre la sollicitation" : "Nouvelle sollicitation";
  if (item) for (const key of ["title", "body", "requester", "priority", "status", "deadline", "deadlineKind", "deadlineLabel", "nextAction"]) form.elements[key].value = item[key] || "";
  $("#updated").textContent = item ? `Créée le ${new Date(item.createdAt).toLocaleDateString("fr-FR")} · Modifiée le ${new Date(item.updatedAt).toLocaleString("fr-FR")}` : "Aucun rattachement à un projet n’est nécessaire.";
  $("#done").hidden = !item || item.status === "done";
  deadlineFields(); editor.showModal(); form.elements.title.focus();
}
async function save(event) {
  event.preventDefault(); if (saving) return;
  const input = Object.fromEntries(new FormData(form));
  if (selected) { input.taskId = selected.id; input.revision = selected.revision; }
  saving = true;
  for (const button of form.querySelectorAll("button")) button.disabled = true;
  error($("#form-error"));
  try { await api("save", input); editor.close(); await refresh(); }
  catch (failure) { error($("#form-error"), failure.message + "\nEn cas de coupure, vérifie la liste avant de réessayer une création."); }
  finally { saving = false; for (const button of form.querySelectorAll("button")) button.disabled = false; }
}
form.addEventListener("submit", save);
form.elements.deadlineKind.addEventListener("change", deadlineFields);
for (const id of ["add", "empty-add"]) $("#" + id).addEventListener("click", () => edit());
for (const id of ["close", "cancel"]) $("#" + id).addEventListener("click", () => editor.close());
editor.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
$("#done").addEventListener("click", () => { form.elements.status.value = "done"; form.requestSubmit(); });
$("#refresh").addEventListener("click", () => refresh());
$("#more").addEventListener("click", () => { if (!loading && nextOffset !== null) refresh(true); });
for (const id of ["view", "filter"]) $("#" + id).addEventListener("change", () => refresh());
for (const button of document.querySelectorAll("[data-filter]")) button.addEventListener("click", () => { $("#filter").value = button.dataset.filter; $("#view").value = "active"; refresh(); });
let searchTimer;
$("#search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh(), 250); });
const autoRefresh = () => { if (!loading && !saving && !editor.open && !document.hidden) refresh(); };
document.addEventListener("visibilitychange", autoRefresh);
setInterval(autoRefresh, 60000);
refresh();
