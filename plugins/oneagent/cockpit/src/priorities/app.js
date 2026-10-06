"use strict";
const $ = (selector) => document.querySelector(selector);
const token = $('meta[name="oneagent-token"]').content;
const openExternal = null;
const form = $("#form"), editor = $("#editor");
let selectedRelatedRefs = new Set();
let entities = [], sortBy = "manual", sortDirection = "asc";
let items = [], nextOffset = null, selected = null, loading = false, saving = false, requestVersion = 0;
let orderRevision = "", reordering = false, draggedId = "", draggedRow = null, dropRow = null;
let rankHandles = new Map();
let pendingDelete = null;
const deletion = $("#delete-confirm");
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
const filterFields = { sourceUrlQuery: "source-url-query", titleQuery: "title-query", bodyQuery: "body-query", requesterQuery: "requester-query", deadlineFrom: "deadline-from", deadlineTo: "deadline-to", urlQuery: "url-query" };
const facetFields = { itemType: ["item-type", "Sujets et tâches"], involvedEntity: ["involved-filter", "Tous les produits et équipes"], status: ["status-filter", "Tous les avancements"], filter: ["filter", "Toutes les priorités"],
  entity: ["entity-filter", "Toutes les entités"], productId: ["product-filter", "Tous les produits"], relatedEntity: ["related-filter", "Tous les partenaires"], priority: ["priority-filter", "Toutes les priorités"], deadlineKind: ["deadline-kind-filter", "Toutes les échéances"] };
const selectedFilters = Object.fromEntries(Object.keys(facetFields).map(key => [key, new Set()]));
let facets = {}, knownChoices = {};
function filters() { return { ...Object.fromEntries(Object.entries(filterFields).map(([key, id]) => [key, $("#" + id).value])), ...Object.fromEntries(Object.entries(selectedFilters).map(([key, values]) => [key, [...values]])) }; }
function activeFilterCount() { return Object.values(filters()).filter(value => Array.isArray(value) ? value.length : value).length; }
const normalize = value => String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
function renderFacet(key) {
  const [id, placeholder] = facetFields[key], chosen = selectedFilters[key];
  const choices = [...(facets[key] || [])];
  for (const choice of choices) (knownChoices[key] ||= new Map()).set(choice.value, choice.label);
  // Preserve unavailable selections so users can uncheck them; never widen a
  // filter silently when another host edits/deletes its last matching row.
  for (const value of chosen) if (!choices.some(choice => choice.value === value)) choices.push({ value, label: knownChoices[key]?.get(value) || value, count: 0 });
  const labels = choices.filter(choice => chosen.has(choice.value)).map(choice => choice.label);
  $("#" + id + "-summary").textContent = chosen.size > 1 ? `${chosen.size} sélectionnés` : labels[0] || placeholder;
  $("#" + id).dataset.active = String(chosen.size > 0);
  const query = normalize($("#" + id + "-search").value), list = $("#" + id + "-choices");
  const activeElement = document.activeElement?.shadowRoot?.activeElement || document.activeElement;
  const focused = list.contains(activeElement) ? activeElement?.value : undefined;
  let nextFocus;
  const options = choices.filter(choice => normalize(choice.label + " " + choice.value).includes(query)).map(choice => {
    const label = node("label", "", "filter-option"), checkbox = node("input");
    checkbox.type = "checkbox"; checkbox.value = choice.value; checkbox.checked = chosen.has(choice.value); checkbox.disabled = reordering || saving;
    checkbox.addEventListener("change", () => { if (reordering || saving) return; checkbox.checked ? chosen.add(choice.value) : chosen.delete(choice.value); clearTimeout(searchTimer); renderFacet(key); refresh(); });
    if (choice.value === focused) nextFocus = checkbox;
    label.append(checkbox, node("span", choice.label), node("small", String(choice.count), "muted")); return label;
  });
  list.replaceChildren(...(options.length ? options : [node("p", "Aucune valeur dans cette vue.", "hint")]));
  nextFocus?.focus();
}
function renderFacets() { for (const key of Object.keys(facetFields)) renderFacet(key); }
function closeFilterMenus() { for (const [id] of Object.values(facetFields)) $("#" + id).open = false; }
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
const manualView = () => sortBy === "manual" && sortDirection === "asc";
function clearDrag() {
  if (dropRow) delete dropRow.dataset.dropPosition;
  if (draggedRow) delete draggedRow.dataset.dragging;
  draggedId = ""; draggedRow = null; dropRow = null;
}
async function movePriority(taskId, targetTaskId, position) {
  if (!manualView() || loading || saving || reordering || !orderRevision) return;
  clearTimeout(searchTimer);
  clearDrag(); reordering = true; render(); error($("#error"));
  const controls = [...document.querySelectorAll(".toolbar input, .toolbar select, .toolbar button, .filters input, .filters select, .filters button, [data-sort], [data-filter], #add, #empty-add, #refresh, #more, #manual-order")];
  const previous = controls.map(control => control.disabled);
  for (const control of controls) control.disabled = true;
  $("#rank-feedback").textContent = "Enregistrement du classement…";
  try {
    const result = await api("reorder", { taskId, targetTaskId, position, orderRevision });
    orderRevision = result.orderRevision;
    await refresh();
    $("#rank-feedback").textContent = result.moved ? "Classement enregistré." : "Classement inchangé.";
  } catch (failure) {
    orderRevision = "";
    error($("#error"), failure.message + "\nClassement non confirmé. Actualise la liste avant de réessayer le déplacement.");
    $("#rank-feedback").textContent = "Classement non confirmé.";
  } finally {
    reordering = false;
    controls.forEach((control, index) => { control.disabled = previous[index]; });
    renderFacets(); render(); rankHandles.get(taskId)?.focus();
  }
}
function rankCell(item, row, index) {
  const cell = node("td", "", "rank-cell"), handle = node("button", "⠿", "rank-handle");
  handle.type = "button"; handle.draggable = manualView() && !reordering && Boolean(orderRevision); handle.disabled = !manualView() || reordering || !orderRevision;
  handle.setAttribute("aria-label", "Déplacer " + item.title);
  handle.setAttribute("aria-describedby", "rank-help");
  handle.title = manualView() ? "Glisser pour classer · Flèche haut / bas pour déplacer au clavier" : "Reviens à Mon classement pour déplacer ce sujet";
  handle.addEventListener("dragstart", event => {
    if (!manualView() || loading || saving || reordering) { event.preventDefault(); return; }
    draggedId = item.id; draggedRow = row; row.dataset.dragging = "true";
    event.dataTransfer?.setData("text/plain", item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  handle.addEventListener("dragend", clearDrag);
  handle.addEventListener("keydown", event => {
    const target = event.key === "ArrowUp" ? items[index - 1] : event.key === "ArrowDown" ? items[index + 1] : null;
    if (!manualView() || !target) return;
    event.preventDefault(); return movePriority(item.id, target.id, event.key === "ArrowUp" ? "before" : "after");
  });
  row.addEventListener("dragover", event => {
    if (!draggedId || draggedId === item.id || !manualView() || reordering) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (dropRow && dropRow !== row) delete dropRow.dataset.dropPosition;
    dropRow = row;
    const bounds = row.getBoundingClientRect();
    row.dataset.dropPosition = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  });
  row.addEventListener("dragleave", event => { if (!row.contains(event.relatedTarget)) { delete row.dataset.dropPosition; if (dropRow === row) dropRow = null; } });
  row.addEventListener("drop", event => {
    if (!draggedId || draggedId === item.id || !manualView() || reordering) return;
    event.preventDefault();
    const from = draggedId, position = row.dataset.dropPosition || "before";
    clearDrag(); return movePriority(from, item.id, position);
  });
  rankHandles.set(item.id, handle);
  cell.append(handle, node("span", String(item.manualPosition || index + 1), "rank-number"));
  return cell;
}
function render() {
  rankHandles = new Map();
  const fragment = document.createDocumentFragment();
  for (const [index, item] of items.entries()) {
    const row = node("tr"), subject = node("td"), button = node("button", item.title, "subject");
    row.dataset.taskId = item.id;
    button.type = "button"; button.addEventListener("click", () => edit(item));
    const titleLine = node("div", "", "subject-line"), modify = node("button", "Modifier", "edit-link");
    modify.type = "button"; modify.setAttribute("aria-label", "Modifier " + item.title); modify.addEventListener("click", () => edit(item));
        const remove = node("button", "Supprimer", "edit-link danger");
    remove.type = "button"; remove.disabled = saving || reordering; remove.setAttribute("aria-label", "Supprimer " + item.title); remove.addEventListener("click", () => askDelete(item));
    titleLine.append(button, modify, remove); subject.append(titleLine);
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
    row.append(rankCell(item, row, index), subject, description, product, related, requester, priority, due, link, source, status);
    fragment.append(row);
  }
  $("#rows").replaceChildren(fragment);
  for (const button of document.querySelectorAll("[data-sort]")) {
    button.closest("th").setAttribute("aria-sort", button.dataset.sort === sortBy ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
    button.title = "Trier par " + button.textContent.trim() + (button.dataset.sort === sortBy && sortDirection === "asc" ? " · décroissant" : " · croissant");
  }
  const sorted = $("[data-sort='" + sortBy + "']");
  $("#sort-summary").textContent = manualView() ? "Ordre : mon classement" : `Tri : ${sorted?.textContent.trim() || sortBy} · ${sortDirection === "asc" ? "croissant" : "décroissant"}`;
  $("#manual-order").setAttribute("aria-pressed", String(manualView()));
  $("#rank-help").textContent = manualView()
    ? "Glisse la poignée ⠿ pour classer les sujets, ou utilise les flèches ↑ / ↓ au clavier. Les filtres conservent l’ordre commun à VS Code et Copilot."
    : "Un tri par colonne est appliqué. Reviens à « Mon classement » pour déplacer les sujets.";
  const count = activeFilterCount();
  $("#filter-count").textContent = count ? `(${count} actif${count > 1 ? "s" : ""})` : "";
}
async function refresh(append = false) {
  clearDrag();
  const version = ++requestVersion;
  loading = true; $("#refresh").disabled = true; $("#more").disabled = true;
  try {
    const data = await api("list", { today: day(), query: $("#search").value, view: $("#view").value, ...filters(), sortBy, sortDirection, limit: 100, offset: append ? nextOffset : 0 });
    if (version !== requestVersion) return;
    items = append ? [...items, ...data.items.filter((item) => !items.some((old) => old.id === item.id))] : data.items;
    orderRevision = data.orderRevision || "";
    nextOffset = data.nextOffset;
    entities = data.entities || [];
    facets = data.facets || {}; renderFacets();
    for (const key of ["active", "urgent", "overdue", "clarify"]) $("#count-" + key).textContent = data.counts[key];
    for (const button of document.querySelectorAll("[data-filter]")) button.setAttribute("aria-pressed", String((button.dataset.filter === "all" ? !selectedFilters.filter.size : selectedFilters.filter.has(button.dataset.filter)) && $("#view").value === "active"));
    render();
    $("#empty").hidden = items.length > 0;
    $(".table-wrap").hidden = false;
    const filtered = Boolean(activeFilterCount() || $("#search").value || $("#view").value !== "active");
    $("#empty-title").textContent = filtered ? "Aucune sollicitation dans cette vue" : "Aucune sollicitation active";
    $("#empty-text").textContent = filtered ? "Ajuste les filtres ou recherche un autre sujet ou demandeur." : "Ajoute ce que l’on attend de toi, même si la personne ou la date reste à préciser.";
    $("#add").disabled = false; $("#empty-add").disabled = false;
    $("#more").hidden = nextOffset === null;
    $("#summary").textContent = `${items.length} sur ${data.total} sollicitation${data.total > 1 ? "s" : ""} · Actualisé à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    error($("#error"));
  } catch (failure) {
    if (version === requestVersion) { orderRevision = ""; render(); error($("#error"), failure.message); $("#summary").textContent = "Actualisation impossible · les données affichées peuvent être anciennes"; }
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
  if (reordering || saving) return;
  closeFilterMenus(); selected = item; form.reset(); error($("#form-error"));
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
  $("#remove").hidden = !item;
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
  finally { saving = false; for (const button of form.querySelectorAll("button")) button.disabled = false; renderFacets(); }
}
function askDelete(item) {
  if (!item || saving || reordering) return;
  clearTimeout(searchTimer); closeFilterMenus(); pendingDelete = item;
  $("#delete-name").textContent = item.title; error($("#delete-error"));
  $("#delete-submit").disabled = false; deletion.showModal();
}
$("#remove").addEventListener("click", () => askDelete(selected));
$("#delete-cancel").addEventListener("click", () => { if (!saving) { pendingDelete = null; deletion.close(); } });
deletion.addEventListener("cancel", event => { if (saving) event.preventDefault(); else pendingDelete = null; });
$("#delete-submit").addEventListener("click", async () => {
  if (!pendingDelete || saving || reordering || $("#delete-submit").disabled) return;
  const item = pendingDelete; saving = true;
  $("#delete-submit").disabled = true; $("#delete-cancel").disabled = true;
  try {
    await api("delete", { taskId: item.id, revision: item.revision });
    pendingDelete = null; deletion.close();
    if (selected?.id === item.id) { selected = null; editor.close(); }
    $("#action-feedback").textContent = `« ${item.title} » a été supprimée.`; $("#action-feedback").hidden = false;
    await refresh();
  } catch (failure) { error($("#delete-error"), failure.message + "\nSuppression non confirmée. Ferme cette fenêtre et actualise la liste avant de réessayer."); }
  finally { saving = false; $("#delete-cancel").disabled = false; renderFacets(); }
});
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
for (const id of ["view"]) $("#" + id).addEventListener("change", () => refresh());
for (const button of document.querySelectorAll("[data-filter]")) button.addEventListener("click", () => { selectedFilters.filter = new Set(button.dataset.filter === "all" ? [] : [button.dataset.filter]); renderFacet("filter"); $("#view").value = "active"; refresh(); });
let searchTimer;
for (const id of ["search", "title-query", "body-query", "requester-query", "url-query", "source-url-query"]) $("#" + id).addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh(), 250); });
for (const id of Object.values(filterFields).filter((id) => !id.endsWith("-query"))) $("#" + id).addEventListener("change", () => refresh());
for (const button of document.querySelectorAll("[data-sort]")) button.addEventListener("click", () => {
  if (reordering) return;
  if (sortBy === button.dataset.sort && sortDirection === "desc") { sortBy = "manual"; sortDirection = "asc"; }
  else { sortDirection = sortBy === button.dataset.sort ? "desc" : "asc"; sortBy = button.dataset.sort; }
  refresh();
});
$("#manual-order").addEventListener("click", () => { if (reordering) return; sortBy = "manual"; sortDirection = "asc"; refresh(); });
$("#reset-filters").addEventListener("click", () => {
  clearTimeout(searchTimer);
  for (const id of ["search", ...Object.values(filterFields)]) $("#" + id).value = "";
  for (const key of Object.keys(facetFields)) { selectedFilters[key].clear(); $("#" + facetFields[key][0] + "-search").value = ""; }
  $("#view").value = "active"; renderFacets(); refresh();
});
for (const [key, [id]] of Object.entries(facetFields)) {
  $("#" + id).addEventListener("toggle", () => { if ($("#" + id).open) for (const [other] of Object.values(facetFields)) if (other !== id) $("#" + other).open = false; });
  $("#" + id + "-search").addEventListener("input", () => renderFacet(key));
  $("#" + id + "-clear").addEventListener("click", () => { if (reordering || saving) return; selectedFilters[key].clear(); renderFacet(key); refresh(); });
  $("#" + id).addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); $("#" + id).open = false; } });
}
const autoRefresh = () => { if (!loading && !saving && !reordering && !draggedId && !editor.open && !deletion.open && !Object.values(facetFields).some(([id]) => $("#" + id).open) && !document.hidden) refresh(); };
document.addEventListener("visibilitychange", autoRefresh);
setInterval(autoRefresh, 60000);
$("#add").disabled = true; $("#empty-add").disabled = true;
refresh();
