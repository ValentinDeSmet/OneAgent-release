"use strict";
const $ = (selector) => document.querySelector(selector);
const token = $('meta[name="oneagent-token"]').content;
const openExternal = null;
const form = $("#form"), editor = $("#editor");
let selectedRelatedRefs = new Set();
let entities = [], sortBy = "priority", sortDirection = "asc";
let items = [], nextOffset = null, selected = null, loading = false, saving = false, requestVersion = 0;
const priorityLabels = { critical: "Critique", high: "Haute", medium: "Normale", low: "Basse" };
const statusLabels = { open: "À faire", in_progress: "En cours", ready: "Prête", pending: "À clarifier", candidate: "À valider", blocked: "En attente", done: "Terminée" };
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
const filterFields = { itemType: "item-type", involvedEntity: "involved-filter", relatedEntity: "related-filter", sourceUrlQuery: "source-url-query", titleQuery: "title-query", bodyQuery: "body-query", entity: "entity-filter", productId: "product-filter", requesterQuery: "requester-query", priority: "priority-filter", deadlineFrom: "deadline-from", deadlineTo: "deadline-to", deadlineKind: "deadline-kind-filter", urlQuery: "url-query", status: "status-filter" };
function filters() { return Object.fromEntries(Object.entries(filterFields).map(([key, id]) => [key, $("#" + id).value])); }
function activeFilterCount() { return Object.entries(filters()).filter(([key, value]) => value && !(key === "itemType" && value === "all")).length; }
function selectOptions(select, choices, placeholder, value = select.value) {
  const options = [Object.assign(node("option", placeholder), { value: "" })];
  for (const choice of choices) options.push(Object.assign(node("option", choice.label), { value: choice.value }));
  if (value && !choices.some((choice) => choice.value === value)) options.push(Object.assign(node("option", value + " · indisponible"), { value }));
  select.replaceChildren(...options); select.value = value;
}
function entityOptions() { return entities.map((entity) => ({ value: entity.ref, label: `${entity.label} · ${entity.kind}` })); }
function productOptions() { return entities.filter((entity) => entity.kind === "product").map((entity) => ({ value: entity.id, label: entity.label })); }
function syncProduct() {
  const entity = entities.find((entity) => entity.ref === form.elements.entity.value);
  form.elements.productId.disabled = entity?.kind === "product";
  if (entity?.kind === "product") form.elements.productId.value = entity.id;
  $("#product-help").textContent = entity?.kind === "product"
    ? "L’entité produit fixe le produit principal. Change l’entité pour le remplacer, ou ajoute les autres produits ci-dessous."
    : "Le produit principal et les partenaires peuvent être modifiés indépendamment du sujet.";
  selectedRelatedRefs.delete("product:" + form.elements.productId.value);
  if (["product", "team"].includes(entity?.kind)) selectedRelatedRefs.delete(entity.ref);
  renderPartnerChoices();
}
function partnerOptions() { return entities.filter(entity => ["product", "team"].includes(entity.kind)).map(entity => ({ value: entity.ref, label: entity.label + " · " + (entity.kind === "team" ? "équipe" : "produit") })); }
function renderPartnerChoices() {
  const primary = "product:" + form.elements.productId.value;
  const attached = form.elements.entity.value;
  const choices = partnerOptions().filter(choice => choice.value !== primary && choice.value !== attached);
  for (const ref of selectedRelatedRefs) if (!choices.some(choice => choice.value === ref)) choices.push({ value: ref, label: ref + " · indisponible" });
  const selection = $("#partner-selection"), list = $("#partner-options");
  const chips = [];
  for (const ref of selectedRelatedRefs) {
    const choice = choices.find(choice => choice.value === ref);
    const button = node("button", (choice?.label || ref) + " ×", "partner-chip");
    button.type = "button"; button.setAttribute("aria-label", "Retirer " + (choice?.label || ref));
    button.addEventListener("click", () => { selectedRelatedRefs.delete(ref); renderPartnerChoices(); });
    chips.push(button);
  }
  selection.replaceChildren(...(chips.length ? chips : [node("span", "Aucun partenaire sélectionné", "hint")]));
  const query = $("#partner-search").value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  const options = choices.filter(choice => (choice.label + " " + choice.value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").includes(query)).map(choice => {
    const label = node("label", "", "partner-option"), checkbox = node("input");
    checkbox.type = "checkbox"; checkbox.value = choice.value; checkbox.checked = selectedRelatedRefs.has(choice.value);
    checkbox.addEventListener("change", () => { checkbox.checked ? selectedRelatedRefs.add(choice.value) : selectedRelatedRefs.delete(choice.value); renderPartnerChoices(); });
    label.append(checkbox, node("span", choice.label)); return label;
  });
  list.replaceChildren(...(options.length ? options : [node("p", "Aucun produit ou équipe correspondant. Crée un partenaire dans le graphe si nécessaire.", "hint")]));
}
function urlCell(value, title) {
  const cell = node("td", "", "url-cell"), href = safeUrl(value);
  if (href) {
    const anchor = node("a", value); anchor.href = href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.title = title + " · " + href;
    if (openExternal) anchor.addEventListener("click", event => { event.preventDefault(); openExternal(href); });
    cell.append(anchor);
  } else cell.append(node("span", value ? "URL invalide" : "—", "muted"));
  return cell;
}
function safeUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function render() {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = node("tr"), subject = node("td"), button = node("button", item.title, "subject");
    button.type = "button"; button.addEventListener("click", () => edit(item));
    const titleLine = node("div", "", "subject-line"), modify = node("button", "Modifier", "edit-link");
    modify.type = "button"; modify.setAttribute("aria-label", "Modifier " + item.title); modify.addEventListener("click", () => edit(item));
    titleLine.append(button, modify); subject.append(titleLine);
    subject.append(node("span", item.itemType === "task" ? "Tâche" : "Sujet", "badge nature"));
    subject.append(node("p", item.entityLabel ? `${item.entityLabel} · ${item.entity.split(":")[0]}` : "Entité à rattacher", item.needsAttachment ? "overdue" : "muted"));
    const description = node("td"), content = node("span", item.body || "—", "description");
    content.title = item.body || ""; description.append(content);
    const product = node("td", item.productLabel || "Sans produit", item.productLabel ? "" : "muted");
    const related = node("td", "", "related-cell");
    for (const partner of item.relatedEntities || []) related.append(node("span", partner.label, "badge partner"));
    if (!item.relatedEntities?.length) related.append(node("span", "—", "muted"));
    const link = urlCell(item.url, "Documentation"), source = urlCell(item.sourceUrl, "Source");
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
    row.append(subject, description, product, related, requester, priority, due, link, source, status);
    fragment.append(row);
  }
  $("#rows").replaceChildren(fragment);
  for (const button of document.querySelectorAll("[data-sort]")) {
    button.closest("th").setAttribute("aria-sort", button.dataset.sort === sortBy ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
    button.title = "Trier par " + button.textContent.trim() + (button.dataset.sort === sortBy && sortDirection === "asc" ? " · décroissant" : " · croissant");
  }
  const sorted = $("[data-sort='" + sortBy + "']");
  $("#sort-summary").textContent = `Tri : ${sorted?.textContent.trim() || sortBy} · ${sortDirection === "asc" ? "croissant" : "décroissant"}`;
  const count = activeFilterCount();
  $("#filter-count").textContent = count ? `(${count} actif${count > 1 ? "s" : ""})` : "";
}
async function refresh(append = false) {
  const version = ++requestVersion;
  loading = true; $("#refresh").disabled = true; $("#more").disabled = true;
  try {
    const data = await api("list", { today: day(), query: $("#search").value, view: $("#view").value, filter: $("#filter").value, ...filters(), sortBy, sortDirection, limit: 100, offset: append ? nextOffset : 0 });
    if (version !== requestVersion) return;
    items = append ? [...items, ...data.items.filter((item) => !items.some((old) => old.id === item.id))] : data.items;
    nextOffset = data.nextOffset;
    entities = data.entities || [];
    selectOptions($("#entity-filter"), entityOptions(), "Toutes les entités");
    selectOptions($("#product-filter"), productOptions(), "Tous les produits");
    selectOptions($("#involved-filter"), partnerOptions(), "Tous les produits et équipes");
    selectOptions($("#related-filter"), partnerOptions(), "Tous les partenaires");
    for (const key of ["active", "urgent", "overdue", "clarify"]) $("#count-" + key).textContent = data.counts[key];
    for (const button of document.querySelectorAll("[data-filter]")) button.setAttribute("aria-pressed", String(button.dataset.filter === $("#filter").value && $("#view").value === "active"));
    render();
    $("#empty").hidden = items.length > 0;
    $(".table-wrap").hidden = false;
    const filtered = Boolean(activeFilterCount() || $("#search").value || $("#filter").value !== "all" || $("#view").value !== "active");
    $("#empty-title").textContent = filtered ? "Aucune sollicitation dans cette vue" : "Aucune sollicitation active";
    $("#empty-text").textContent = filtered ? "Ajuste les filtres ou recherche un autre sujet ou demandeur." : "Ajoute ce que l’on attend de toi, même si la personne ou la date reste à préciser.";
    $("#add").disabled = false; $("#empty-add").disabled = false;
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
  selectedRelatedRefs = new Set(item?.relatedEntityRefs || []);
  $("#partner-search").value = "";
  form.elements.itemType.value = item?.itemType || "subject";
  $("#editor-title").textContent = item ? "Suivre la sollicitation" : "Nouvelle sollicitation";
  selectOptions(form.elements.entity, entityOptions(), "Choisir une entité…", item?.entity || "");
  selectOptions(form.elements.productId, productOptions(), "Sans produit", item?.productId || "");
  $("#entity-help").textContent = entities.length ? (item?.needsAttachment ? "Cette ancienne priorité doit être rattachée à une entité avant enregistrement." : "Rattachement conservé dans le graphe et les tâches.") : "Crée d’abord une entité dans OneAgent, puis actualise cette page.";
  syncProduct();
  if (item) for (const key of ["url", "sourceUrl", "title", "body", "requester", "priority", "status", "deadline", "deadlineKind", "deadlineLabel", "nextAction"]) form.elements[key].value = item[key] || "";
  $("#updated").textContent = item ? `Créée le ${new Date(item.createdAt).toLocaleDateString("fr-FR")} · Modifiée le ${new Date(item.updatedAt).toLocaleString("fr-FR")}` : "Sujet et entité sont obligatoires. Le produit est facultatif pour les autres types d’entités.";
  $("#done").hidden = !item || item.status === "done";
  deadlineFields(); editor.showModal(); form.elements.title.focus();
}
async function save(event) {
  event.preventDefault(); if (saving) return;
  const input = Object.fromEntries(new FormData(form));
  input.relatedEntityRefs = [...selectedRelatedRefs];
  if (selected) { input.taskId = selected.id; input.revision = selected.revision; }
  saving = true;
  for (const button of form.querySelectorAll("button")) button.disabled = true;
  error($("#form-error"));
  try { await api("save", input); editor.close(); await refresh(); }
  catch (failure) { error($("#form-error"), failure.message + "\nEn cas de coupure, vérifie la liste avant de réessayer une création."); }
  finally { saving = false; for (const button of form.querySelectorAll("button")) button.disabled = false; }
}
form.addEventListener("submit", save);
form.elements.entity.addEventListener("change", syncProduct);
form.elements.productId.addEventListener("change", syncProduct);
$("#partner-search").addEventListener("input", renderPartnerChoices);
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
for (const id of ["search", "title-query", "body-query", "requester-query", "url-query", "source-url-query"]) $("#" + id).addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh(), 250); });
for (const id of Object.values(filterFields).filter((id) => !id.endsWith("-query"))) $("#" + id).addEventListener("change", () => refresh());
for (const button of document.querySelectorAll("[data-sort]")) button.addEventListener("click", () => {
  sortDirection = sortBy === button.dataset.sort && sortDirection === "asc" ? "desc" : "asc";
  sortBy = button.dataset.sort; refresh();
});
$("#reset-filters").addEventListener("click", () => {
  clearTimeout(searchTimer);
  for (const id of ["search", ...Object.values(filterFields)]) $("#" + id).value = "";
  $("#item-type").value = "all";
  $("#filter").value = "all"; $("#view").value = "active"; refresh();
});
const autoRefresh = () => { if (!loading && !saving && !editor.open && !document.hidden) refresh(); };
document.addEventListener("visibilitychange", autoRefresh);
setInterval(autoRefresh, 60000);
$("#add").disabled = true; $("#empty-add").disabled = true;
refresh();
