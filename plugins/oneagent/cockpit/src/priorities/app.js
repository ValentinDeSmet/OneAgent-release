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
const rowMenu = $("#row-menu");
const taskEditor = $("#task-editor"), taskForm = $("#task-form");
const expandedTasks = new Set(), taskCache = new Map(), taskLoads = new Map();
let taskPanels = new Map(), taskContext = null, taskChoices = [], taskNextOffset = null, taskSearchVersion = 0, taskSearchTimer;
let menuItem = null, menuTrigger = null;
const viewEditor = $("#view-editor"), viewForm = $("#view-form"), viewDeletion = $("#view-delete-confirm");
let savedViews = [], viewsRevision = "", defaultViewId = null, activeViewId = "", viewsReady = false, viewDraft = null, viewBusy = false;
const priorityLabels = { critical: "Critique", high: "Haute", medium: "Normale", low: "Basse" };
const workTypeLabels = { unspecified: "À préciser", discovery: "Discovery", technical_study: "Étude technique", implementation: "Développement / implémentation", validation: "Validation / recette", documentation: "Documentation", other: "Autre" };
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
const facetFields = { workType: ["work-type-filter", "Tous les types de travail"], deadlineQuarter: ["quarter-filter", "Tous les trimestres"], deadlineYear: ["year-filter", "Toutes les années"], itemType: ["item-type", "Sujets et tâches"], involvedEntity: ["involved-filter", "Tous les produits et équipes"], status: ["status-filter", "Tous les avancements"], filter: ["filter", "Toutes les priorités"],
  entity: ["entity-filter", "Toutes les entités"], productId: ["product-filter", "Tous les produits"], relatedEntity: ["related-filter", "Tous les partenaires"], priority: ["priority-filter", "Toutes les priorités"], deadlineKind: ["deadline-kind-filter", "Toutes les échéances"] };
const selectedFilters = Object.fromEntries(Object.keys(facetFields).map(key => [key, new Set()]));
let facets = {}, knownChoices = {};
function filters() { return { ...Object.fromEntries(Object.entries(filterFields).map(([key, id]) => [key, $("#" + id).value])), ...Object.fromEntries(Object.entries(selectedFilters).map(([key, values]) => [key, [...values]])) }; }
function viewCriteria() {
  const value = { query: $("#search").value.trim(), view: $("#view").value, ...filters(), sortBy, sortDirection };
  for (const key of Object.keys(value)) value[key] = Array.isArray(value[key]) ? [...value[key]].filter(item => item && item !== "all").sort() : value[key].trim();
  return value;
}
const sameCriteria = (a,b) => JSON.stringify(Object.keys(a).sort().map(key => [key,a[key]])) === JSON.stringify(Object.keys(b).sort().map(key => [key,b[key]]));
const activeView = () => savedViews.find(view => view.id === activeViewId);
function renderViewControls() {
  const focused = document.activeElement?.shadowRoot?.activeElement || document.activeElement;
  const focusedId = $("#view-tabs").contains(focused) ? focused?.dataset?.viewId : undefined;
  const current = activeView(), dirty = Boolean(current && !sameCriteria(viewCriteria(), current.criteria));
  const choices = [{ id: "", name: activeViewId ? "Toutes mes priorités" : activeFilterCount() || $("#search").value || sortBy !== "manual" || $("#view").value !== "active" ? "Vue libre" : "Toutes mes priorités" }, ...savedViews];
  const buttons = choices.map((view,index) => {
    const button = node("button", view.name + (view.id && view.id === defaultViewId ? " ★" : ""), "view-tab");
    button.type = "button"; button.dataset.viewId = view.id; button.disabled = saving || reordering || viewBusy;
    button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(view.id === activeViewId)); button.setAttribute("aria-controls", "priority-table");
    button.tabIndex = view.id === activeViewId ? 0 : -1;
    button.addEventListener("click", () => chooseView(view.id));
    button.addEventListener("keydown", event => {
      const next = event.key === "ArrowRight" ? (index + 1) % choices.length : event.key === "ArrowLeft" ? (index + choices.length - 1) % choices.length : event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : null;
      if (next === null) return; event.preventDefault(); chooseView(choices[next].id); $("#view-tabs").children[next]?.focus();
    }); return button;
  });
  $("#view-tabs").replaceChildren(...buttons);
  if (focusedId !== undefined) buttons.find(button => button.dataset.viewId === focusedId && !button.disabled)?.focus();
  $("#view-dirty").hidden = !dirty; $("#view-update").hidden = !dirty; $("#view-revert").hidden = !dirty;
  $("#view-actions").hidden = !current;
  $("#view-default").textContent = current?.id === defaultViewId ? "Ne plus ouvrir par défaut" : "Ouvrir par défaut";
  for (const id of ["view-save-as", "view-update", "view-revert", "view-rename", "view-duplicate", "view-default", "view-delete"]) $("#" + id).disabled = !viewsRevision || saving || reordering || viewBusy;
}
function applyViewCriteria(value = {}) {
  clearTimeout(searchTimer); closeFilterMenus(); closeRowMenu(); $("#view-actions").open = false;
  $("#search").value = value.query || ""; $("#view").value = value.view || "active";
  sortBy = value.sortBy || "manual"; sortDirection = value.sortDirection || "asc";
  for (const [key,id] of Object.entries(filterFields)) $("#" + id).value = value[key] || "";
  for (const key of Object.keys(facetFields)) {
    selectedFilters[key] = new Set(Array.isArray(value[key]) ? value[key] : value[key] ? [value[key]] : []);
    $("#" + facetFields[key][0] + "-search").value = "";
  }
  expandedTasks.clear(); renderFacets(); renderViewControls();
}
function chooseView(id) {
  if (saving || reordering || viewBusy || editor.open || taskEditor.open || viewEditor.open) return;
  const view = savedViews.find(view => view.id === id); if (id && !view) return;
  activeViewId = id; applyViewCriteria(view?.criteria); refresh();
}
async function readViews(version) {
  try {
    const data = await api("views", {}); if (version !== requestVersion) return;
    const initial = !viewsReady;
    savedViews = data.items || []; viewsRevision = data.revision || ""; defaultViewId = data.defaultViewId || null; viewsReady = true;
    if (activeViewId && !activeView()) { activeViewId = ""; $("#view-feedback").textContent = "Cette vue a été supprimée ailleurs ; tes filtres actuels sont conservés."; }
    if (initial && defaultViewId && !activeFilterCount() && !$("#search").value && sortBy === "manual" && $("#view").value === "active") {
      const view = savedViews.find(view => view.id === defaultViewId); if (view) { activeViewId = view.id; applyViewCriteria(view.criteria); }
    }
    error($("#view-error")); renderViewControls();
  } catch (failure) { if (version === requestVersion) { viewsRevision = ""; renderViewControls(); error($("#view-error"), "Vues indisponibles : " + failure.message + "\nActualise pour recharger les vues. Les filtres actuels sont conservés."); } }
}
function openViewEditor(mode) {
  if (!viewsRevision || saving || reordering || viewBusy) return;
  const current = activeView(); if (mode !== "create" && !current) return;
  $("#view-actions").open = false; closeFilterMenus(); viewForm.reset(); error($("#view-form-error"));
  viewDraft = { mode, id: current?.id, criteria: mode === "duplicate" ? current.criteria : viewCriteria() };
  viewForm.elements.name.value = mode === "rename" ? current.name : mode === "duplicate" ? current.name + " · copie" : "";
  viewForm.elements.makeDefault.checked = mode === "rename" && current.id === defaultViewId;
  $("#view-editor-title").textContent = mode === "rename" ? "Renommer la vue" : mode === "duplicate" ? "Dupliquer la vue" : "Nouvelle vue";
  $("#view-editor-help").textContent = mode === "rename" ? "Le nom change ; les filtres et le tri enregistrés sont conservés." : mode === "duplicate" ? "Copie les critères enregistrés dans une nouvelle vue." : "Enregistre les filtres, la recherche et le tri actuels. Les priorités restent à jour automatiquement.";
  $("#view-submit").disabled = false; viewEditor.showModal(); viewForm.elements.name.focus();
}
async function writeView(operation, input, target, confirmed) {
  if (!viewsRevision || saving || reordering || viewBusy) return;
  viewBusy = true; saving = true; error(target); renderViewControls();
  try {
    const data = await api(operation, { ...input, revision: viewsRevision });
    savedViews = data.items; defaultViewId = data.defaultViewId; viewsRevision = data.revision;
    confirmed(data); error($("#view-error")); await refresh();
  } catch (failure) {
    viewsRevision = "";
    error(target, failure.message + "\nModification non confirmée. Ferme cette fenêtre et actualise les vues avant de réessayer.");
  } finally { viewBusy = false; saving = false; renderViewControls(); render(); }
}
$("#view-save-as").addEventListener("click", () => openViewEditor("create"));
$("#view-rename").addEventListener("click", () => openViewEditor("rename"));
$("#view-duplicate").addEventListener("click", () => openViewEditor("duplicate"));
for (const id of ["view-close", "view-cancel"]) $("#" + id).addEventListener("click", () => { if (!viewBusy) viewEditor.close(); });
viewEditor.addEventListener("cancel", event => { if (viewBusy) event.preventDefault(); });
viewForm.addEventListener("submit", async event => {
  event.preventDefault(); if (!viewDraft || $("#view-submit").disabled || viewBusy) return;
  const input = { name: viewForm.elements.name.value, makeDefault: viewForm.elements.makeDefault.checked };
  if (viewDraft.mode === "rename") input.id = viewDraft.id;
  else input.criteria = viewDraft.criteria;
  $("#view-submit").disabled = true;
  await writeView("view-save", input, $("#view-form-error"), data => {
    activeViewId = data.saved.id; viewEditor.close();
    if (viewDraft.mode === "duplicate") applyViewCriteria(data.saved.criteria);
    $("#view-feedback").textContent = "Vue enregistrée.";
  });
});
$("#view-update").addEventListener("click", () => {
  const current = activeView(); if (!current) return;
  return writeView("view-save", { id: current.id, criteria: viewCriteria() }, $("#view-error"), () => { $("#view-feedback").textContent = "Filtres et tri de la vue mis à jour."; });
});
$("#view-revert").addEventListener("click", () => chooseView(activeViewId));
$("#view-default").addEventListener("click", () => {
  const current = activeView(); if (!current) return; $("#view-actions").open = false;
  return writeView("view-save", { id: current.id, makeDefault: current.id !== defaultViewId }, $("#view-error"), () => { $("#view-feedback").textContent = defaultViewId ? "Vue d’ouverture enregistrée." : "Ouverture sur toutes les priorités."; });
});
let pendingViewDelete;
$("#view-delete").addEventListener("click", () => {
  if (saving || reordering || viewBusy || !activeView()) return;
  pendingViewDelete = activeView(); $("#view-actions").open = false; $("#view-delete-name").textContent = pendingViewDelete.name;
  error($("#view-delete-error")); $("#view-delete-submit").disabled = false; viewDeletion.showModal();
});
$("#view-delete-cancel").addEventListener("click", () => { if (!viewBusy) viewDeletion.close(); });
viewDeletion.addEventListener("cancel", event => { if (viewBusy) event.preventDefault(); });
$("#view-delete-submit").addEventListener("click", async () => {
  if (!pendingViewDelete || $("#view-delete-submit").disabled || viewBusy) return;
  $("#view-delete-submit").disabled = true;
  return writeView("view-delete", { id: pendingViewDelete.id }, $("#view-delete-error"), () => {
    if (activeViewId === pendingViewDelete.id) activeViewId = "";
    viewDeletion.close(); $("#view-feedback").textContent = "Vue supprimée ; les priorités et les filtres actuels sont conservés.";
  });
});
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
const manualView = () => sortBy === "manual" && sortDirection === "asc" && $("#view").value !== "excluded";
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
function closeRowMenu(returnFocus = false) {
  const trigger = menuTrigger;
  rowMenu.hidden = true; menuTrigger?.setAttribute("aria-expanded", "false");
  menuItem = null; menuTrigger = null;
  if (returnFocus) trigger?.focus();
}
function showRowMenu(item, trigger) {
  if (saving || reordering) return;
  if (menuTrigger === trigger && !rowMenu.hidden) { closeRowMenu(true); return; }
  closeRowMenu(); closeFilterMenus();
  menuItem = item; menuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  const restore = item.inPriorities === false;
  $("#row-menu-label").textContent = restore ? "Remettre dans mes priorités" : "Retirer des priorités";
  $("#row-menu-help").textContent = restore ? "La même tâche retrouve la liste." : "La tâche et ses liens sont conservés.";
  rowMenu.setAttribute("aria-label", "Actions pour " + item.title);
  rowMenu.hidden = false;
  const bounds = trigger.getBoundingClientRect(), width = 270, height = rowMenu.getBoundingClientRect().height;
  rowMenu.style.left = Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)) + "px";
  rowMenu.style.top = Math.max(12, Math.min(bounds.bottom + 6, window.innerHeight - height - 12)) + "px";
  $("#row-menu-action").focus();
}
function actionButton(label, icon) {
  const button = node("button", "", "row-action"); button.type = "button";
  button.title = label; button.setAttribute("aria-label", label);
  // Static line icons; user content always remains text.
  button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  button.disabled = saving || reordering;
  return button;
}
function render() {
  renderViewControls();
  taskPanels = new Map();
  closeRowMenu();
  rankHandles = new Map();
  const fragment = document.createDocumentFragment();
  for (const [index, item] of items.entries()) {
    const row = node("tr"), subject = node("td"), button = node("button", item.title, "subject");
    row.dataset.taskId = item.id;
    button.type = "button"; button.addEventListener("click", () => edit(item));
    const titleLine = node("div", "", "subject-line"), actions = node("div", "", "row-actions");
    const modify = actionButton("Modifier " + item.title, '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>');
    modify.addEventListener("click", () => edit(item));
    const more = actionButton("Actions pour " + item.title, '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>');
    more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-controls", "row-menu"); more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", () => showRowMenu(item, more));
    more.addEventListener("keydown", event => { if (event.key === "ArrowDown") { event.preventDefault(); showRowMenu(item, more); } });
    actions.append(modify, more); titleLine.append(button, actions); subject.append(titleLine);
    if (item.inPriorities === false) subject.append(node("span", "Retirée des priorités", "badge excluded"));
    subject.append(node("span", item.itemType === "task" ? "Tâche" : "Sujet", "badge nature"));
    subject.append(node("p", item.entityLabel ? `${item.entityLabel} · ${item.entity.split(":")[0]}` : "Entité à rattacher", item.needsAttachment ? "overdue" : "muted"));
    const tasksToggle = node("button", `${expandedTasks.has(item.id) ? "▾" : "▸"} Tâches · ${item.taskDoneCount || 0}/${item.taskCount || 0}`, "tasks-toggle");
    tasksToggle.type = "button"; tasksToggle.setAttribute("aria-expanded", String(expandedTasks.has(item.id)));
    tasksToggle.setAttribute("aria-controls", "priority-tasks-" + encodeURIComponent(item.id));
    tasksToggle.addEventListener("click", () => { expandedTasks.has(item.id) ? expandedTasks.delete(item.id) : expandedTasks.add(item.id); render(); });
    subject.append(tasksToggle);
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
      due.append(node("span", item.deadlineQuarter ? `${item.deadlineQuarter}${item.deadlineYear ? " " + item.deadlineYear : " · année à préciser"}` : "Trimestre à préciser"));
      if (item.legacyDeadlineLabel) due.append(node("p", "Ancienne période : " + item.legacyDeadlineLabel, "estimate"));
    } else due.append(node("span", "À préciser", "muted"));
    const status = node("td"); status.append(node("span", statusLabels[item.status] || item.status, "badge"));
    const work = node("td", workTypeLabels[item.workType] || "À préciser", "work-type-cell");
    row.append(rankCell(item, row, index), subject, description, work, product, related, requester, priority, due, link, source, status);
    fragment.append(row);
    if (expandedTasks.has(item.id)) {
      const detailRow = node("tr", "", "tasks-accordion"), cell = node("td"), panel = node("section", "", "priority-tasks");
      cell.colSpan = 12; panel.id = "priority-tasks-" + encodeURIComponent(item.id); panel.setAttribute("aria-label", "Tâches pour " + item.title);
      cell.append(panel); detailRow.append(cell); fragment.append(detailRow); taskPanels.set(item.id, panel);
      renderPriorityTasks(item, panel);
    }
  }
  $("#rows").replaceChildren(fragment);
  for (const button of document.querySelectorAll("[data-sort]")) {
    button.closest("th").setAttribute("aria-sort", button.dataset.sort === sortBy ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
    button.title = "Trier par " + button.textContent.trim() + (button.dataset.sort === sortBy && sortDirection === "asc" ? " · décroissant" : " · croissant");
  }
  const sorted = $("[data-sort='" + sortBy + "']");
  $("#sort-summary").textContent = manualView() ? "Ordre : mon classement" : `Tri : ${sorted?.textContent.trim() || sortBy} · ${sortDirection === "asc" ? "croissant" : "décroissant"}`;
  $("#manual-order").setAttribute("aria-pressed", String(manualView()));
  $("#rank-help").textContent = $("#view").value === "excluded"
    ? "Ces éléments restent dans Tâches. Utilise le menu ⋯ pour les remettre dans tes priorités." : manualView()
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
    await readViews(version); if (version !== requestVersion) return;
    const data = await api("list", { today: day(), query: $("#search").value, view: $("#view").value, ...filters(), sortBy, sortDirection, limit: 100, offset: append ? nextOffset : 0 });
    if (version !== requestVersion) return;
    items = append ? [...items, ...data.items.filter((item) => !items.some((old) => old.id === item.id))] : data.items;
    orderRevision = data.orderRevision || "";
    nextOffset = data.nextOffset;
    entities = data.entities || [];
    taskCache.clear(); taskLoads.clear();
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
    if (version === requestVersion) { loading = false; $("#refresh").disabled = false; $("#more").disabled = false; renderViewControls(); }
  }
}
function renderPriorityTasks(item, panel) {
  const data = taskCache.get(item.id);
  panel.replaceChildren();
  const head = node("div", "", "priority-tasks-head"), title = node("strong", "Tâches pour « " + (data?.priorityTitle || item.title) + " »"), add = node("button", "+ Ajouter une tâche");
  add.type = "button"; add.disabled = !data || saving || item.inPriorities === false;
  add.addEventListener("click", () => openTaskEditor(item, data)); head.append(title, add); panel.append(head);
  if (!data) {
    panel.append(node("p", "Chargement des tâches…", "muted"));
    if (taskLoads.has(item.id)) return;
    const request = {};
    taskLoads.set(item.id, request);
    api("tasks", { priorityId: item.id }).then(value => {
      if (taskLoads.get(item.id) !== request) return;
      taskLoads.delete(item.id); taskCache.set(item.id, value);
      const current = taskPanels.get(item.id);
      if (current && expandedTasks.has(item.id)) renderPriorityTasks(item, current);
    }).catch(failure => {
      if (taskLoads.get(item.id) !== request) return;
      taskLoads.delete(item.id);
      const current = taskPanels.get(item.id);
      if (!current || !expandedTasks.has(item.id)) return;
      current.replaceChildren(node("p", failure.message, "error"));
      const retry = node("button", "Réessayer le chargement"); retry.type = "button"; retry.addEventListener("click", () => renderPriorityTasks(item, current)); current.append(retry);
    });
    return;
  }
  if (!data.items.length) panel.append(node("p", "Aucune tâche rattachée. Crée une tâche ou choisis-en une déjà disponible dans Tâches.", "muted"));
  const list = node("div", "", "priority-task-list");
  for (const task of data.items) {
    const row = node("div", "", "priority-task-row"), content = node("div", "", "priority-task-content"), actions = node("div", "", "row-actions");
    content.append(node("strong", task.title));
    const meta = node("p", `${statusLabels[task.status] || task.status} · ${task.assignee === "agent" ? "Agent" : "Moi"}${task.deadline ? " · " + dateLabel(task.deadline) : ""}`, "muted");
    content.append(meta); if (task.body) content.append(node("p", task.body, "description"));
    const modify = actionButton("Modifier la tâche " + task.title, '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>');
    modify.disabled = saving || item.inPriorities === false; modify.addEventListener("click", () => openTaskEditor(item, data, task));
    const detach = node("button", "Détacher", "subtle"); detach.type = "button"; detach.disabled = saving;
    detach.title = "Retirer le lien à cette priorité ; conserver la tâche et ses autres liens.";
    detach.addEventListener("click", async () => {
      if (saving || detach.disabled) return;
      saving = true; detach.disabled = true;
      try {
        await api("task-detach", { priorityId: item.id, priorityRevision: data.priorityRevision, taskId: task.id, taskRevision: task.priorityRevision });
        $("#action-feedback").textContent = "Tâche détachée ; elle reste disponible dans Tâches."; $("#action-feedback").hidden = false; await refresh();
      } catch (failure) { error($("#error"), failure.message + "\nDétachement non confirmé. Actualise avant de réessayer."); }
      finally { saving = false; render(); }
    });
    actions.append(modify, detach); row.append(content, actions); list.append(row);
  }
  panel.append(list);
}
function taskModeFields() {
  const attach = taskForm.elements.mode.value === "attach";
  $("#task-existing-fields").hidden = !attach; $("#task-new-fields").hidden = attach;
  for (const key of ["title", "body", "status", "priority", "assignee", "deadline", "notes"]) taskForm.elements[key].disabled = attach;
  taskForm.elements.title.required = !attach; taskForm.elements.existingTask.disabled = !attach; taskForm.elements.existingTask.required = attach;
  $("#task-save").textContent = attach ? "Rattacher la tâche" : taskContext?.task ? "Enregistrer" : "Créer la tâche";
}
function openTaskEditor(item, data, task = null) {
  if (saving || reordering || !data || item.inPriorities === false) return;
  closeFilterMenus(); closeRowMenu(); taskForm.reset(); error($("#task-error"));
  taskContext = { priorityId: item.id, priorityRevision: data.priorityRevision, task };
  taskChoices = data.choices || []; taskNextOffset = data.nextOffset; taskSearchVersion++;
  $("#task-search").value = "";
  selectOptions(taskForm.elements.existingTask, taskChoices.map(task => ({ value: task.id, label: task.title })), "Choisir une tâche…", "");
  $("#task-more").hidden = taskNextOffset === null;
  $("#task-editor-title").textContent = task ? "Modifier la tâche" : "Ajouter une tâche";
  $("#task-parent").textContent = "Pour la priorité « " + data.priorityTitle + " »";
  $("#task-mode-field").hidden = Boolean(task); taskForm.elements.mode.value = "create";
  if (task) for (const key of ["title", "body", "status", "priority", "assignee", "deadline", "notes"]) taskForm.elements[key].value = task[key] || "";
  $("#task-save").disabled = false; taskModeFields(); taskEditor.showModal(); taskForm.elements.title.focus();
}
async function searchTasks(append = false) {
  if (!taskContext || saving) return;
  const version = ++taskSearchVersion;
  try {
    const data = await api("tasks", { priorityId: taskContext.priorityId, query: $("#task-search").value, offset: append ? taskNextOffset : 0 });
    if (version !== taskSearchVersion || !taskEditor.open) return;
    taskChoices = append ? [...taskChoices, ...data.choices.filter(task => !taskChoices.some(old => old.id === task.id))] : data.choices;
    taskContext.priorityRevision = data.priorityRevision; taskNextOffset = data.nextOffset;
    selectOptions(taskForm.elements.existingTask, taskChoices.map(task => ({ value: task.id, label: task.title })), "Choisir une tâche…", "");
    $("#task-more").hidden = taskNextOffset === null; error($("#task-error"));
  } catch (failure) { if (version === taskSearchVersion) error($("#task-error"), failure.message); }
}
taskForm.elements.mode.addEventListener("change", taskModeFields);
$("#task-search").addEventListener("input", () => { clearTimeout(taskSearchTimer); taskSearchTimer = setTimeout(() => searchTasks(), 250); });
$("#task-more").addEventListener("click", () => { if (taskNextOffset !== null) searchTasks(true); });
for (const id of ["task-close", "task-cancel"]) $("#" + id).addEventListener("click", () => { if (!saving) { taskSearchVersion++; taskEditor.close(); } });
taskEditor.addEventListener("cancel", event => { if (saving) event.preventDefault(); else taskSearchVersion++; });
taskForm.addEventListener("submit", async event => {
  event.preventDefault(); if (saving || !taskContext || $("#task-save").disabled) return;
  clearTimeout(taskSearchTimer); taskSearchVersion++;
  const fields = Object.fromEntries(new FormData(taskForm)), input = { priorityId: taskContext.priorityId, priorityRevision: taskContext.priorityRevision };
  let operation = "task-save";
  if (fields.mode === "attach") {
    const task = taskChoices.find(task => task.id === fields.existingTask);
    if (!task) { error($("#task-error"), "Choisis une tâche existante."); return; }
    operation = "task-attach"; input.taskId = task.id; input.taskRevision = task.revision;
  } else {
    for (const key of ["title", "body", "status", "priority", "assignee", "deadline", "notes"]) input[key] = fields[key];
    if (taskContext.task) { input.taskId = taskContext.task.id; input.taskRevision = taskContext.task.priorityRevision; }
  }
  saving = true; error($("#task-error"));
  for (const button of taskForm.querySelectorAll("button")) button.disabled = true;
  try { await api(operation, input); taskEditor.close(); await refresh(); }
  catch (failure) { error($("#task-error"), failure.message + "\nÉcriture non confirmée. Ferme cette fiche et actualise avant de réessayer, pour éviter un doublon."); }
  finally { saving = false; for (const button of taskForm.querySelectorAll("button")) if (button.id !== "task-save") button.disabled = false; render(); }
});
function deadlineFields() {
  const kind = form.elements.deadlineKind.value;
  $("#deadline-fields").hidden = kind !== "exact";
  $("#period-field").hidden = kind !== "approximate";
  form.elements.deadline.required = kind === "exact";
  form.elements.deadline.disabled = kind !== "exact";
  for (const key of ["deadlineQuarter", "deadlineYear"]) {
    form.elements[key].disabled = kind !== "approximate";
    form.elements[key].required = kind === "approximate";
  }
  $("#date-help").textContent = kind === "approximate" ? "Choisis Q1, Q2, Q3 ou Q4 et une année. Le trimestre reste une période ; il ne déclenche pas d’alerte de retard de date ferme." : kind === "exact" ? "Une date ferme dépassée apparaîtra dans les retards." : "Une échéance inconnue reste visible comme « À préciser ».";
}
function yearOptions(selectedYear) {
  const year = new Date().getFullYear();
  const years = new Set(Array.from({ length: 7 }, (_, i) => year - 1 + i));
  if (selectedYear) years.add(Number(selectedYear));
  selectOptions(form.elements.deadlineYear, [...years].sort((a,b) => a-b).map(value => ({ value: String(value), label: String(value) })), "Choisir l’année…", selectedYear ? String(selectedYear) : String(year));
}

function edit(item = null) {
  if (reordering || saving) return;
  closeRowMenu(); closeFilterMenus(); selected = item; form.reset(); error($("#form-error"));
  selectedRelatedRefs = new Set(item?.relatedEntityRefs || []);
  $("#partner-search").value = "";
  yearOptions(item?.deadlineYear);
  form.elements.workType.value = item?.workType || "unspecified";
  $("#legacy-period").hidden = !item?.legacyDeadlineLabel;
  $("#legacy-period").textContent = item?.legacyDeadlineLabel ? "Ancienne période conservée : " + item.legacyDeadlineLabel + ". Choisis son trimestre et son année avant d’enregistrer cette fiche." : "";
  form.elements.itemType.value = item?.itemType || "subject";
  $("#editor-title").textContent = item ? "Suivre la sollicitation" : "Nouvelle sollicitation";
  selectOptions(form.elements.entity, entityOptions(), "Choisir une entité…", item?.entity || "");
  selectOptions(form.elements.productId, productOptions(), "Sans produit", item?.productId || "");
  $("#entity-help").textContent = entities.length ? (item?.needsAttachment ? "Cette ancienne priorité doit être rattachée à une entité avant enregistrement." : "Rattachement conservé dans le graphe et les tâches.") : "Crée d’abord une entité dans OneAgent, puis actualise cette page.";
  syncProduct();
  if (item) for (const key of ["url", "sourceUrl", "title", "body", "requester", "priority", "status", "deadline", "deadlineKind", "deadlineQuarter", "nextAction"]) form.elements[key].value = item[key] || "";
  $("#updated").textContent = item ? `Créée le ${new Date(item.createdAt).toLocaleDateString("fr-FR")} · Modifiée le ${new Date(item.updatedAt).toLocaleString("fr-FR")}` : "Sujet et entité sont obligatoires. Le produit est facultatif pour les autres types d’entités.";
  $("#done").hidden = !item || item.status === "done";
  $("#remove").hidden = !item || item.inPriorities === false;
  $("#restore").hidden = !item || item.inPriorities !== false;
  deadlineFields(); editor.showModal(); form.elements.title.focus();
}
async function save(event) {
  event.preventDefault(); if (saving) return;
  const input = Object.fromEntries(new FormData(form));
  if (input.deadlineYear !== undefined) input.deadlineYear = Number(input.deadlineYear);
  input.relatedEntityRefs = [...selectedRelatedRefs];
  if (selected) { input.taskId = selected.id; input.revision = selected.revision; }
  saving = true;
  for (const button of form.querySelectorAll("button")) button.disabled = true;
  error($("#form-error"));
  try { await api("save", input); editor.close(); await refresh(); }
  catch (failure) { error($("#form-error"), failure.message + "\nEn cas de coupure, vérifie la liste avant de réessayer une création."); }
  finally { saving = false; for (const button of form.querySelectorAll("button")) button.disabled = false; renderFacets(); render(); }
}
function askDelete(item) {
  if (!item || saving || reordering) return;
  clearTimeout(searchTimer); closeRowMenu(); closeFilterMenus(); pendingDelete = item;
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
    $("#action-feedback").textContent = `« ${item.title} » a été retirée des priorités. La tâche est conservée.`; $("#action-feedback").hidden = false;
    await refresh();
  } catch (failure) { error($("#delete-error"), failure.message + "\nRetrait non confirmé. Ferme cette fenêtre et actualise la liste avant de réessayer."); }
  finally { saving = false; $("#delete-cancel").disabled = false; renderFacets(); render(); }
});
async function restorePriority(item) {
  if (!item || saving || reordering) return;
  closeRowMenu(); clearTimeout(searchTimer); saving = true; render();
  for (const button of form.querySelectorAll("button")) button.disabled = true;
  try {
    await api("save", { taskId: item.id, revision: item.revision, inPriorities: true });
    if (selected?.id === item.id) { selected = null; editor.close(); }
    $("#action-feedback").textContent = `« ${item.title} » a été remise dans les priorités.`; $("#action-feedback").hidden = false;
    await refresh();
  } catch (failure) { error(editor.open ? $("#form-error") : $("#error"), failure.message + "\nRemise dans les priorités non confirmée. Actualise la liste avant de réessayer."); }
  finally { saving = false; for (const button of form.querySelectorAll("button")) button.disabled = false; renderFacets(); render(); }
}
$("#restore").addEventListener("click", () => restorePriority(selected));
$("#row-menu-action").addEventListener("click", () => { const item = menuItem; closeRowMenu(); return item?.inPriorities === false ? restorePriority(item) : askDelete(item); });
rowMenu.addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closeRowMenu(true); }
  else if (event.key === "Tab") closeRowMenu(true);
});
document.addEventListener("pointerdown", event => {
  if (rowMenu.hidden) return;
  const path = event.composedPath();
  if (!path.includes(rowMenu) && !path.includes(menuTrigger)) closeRowMenu();
}, true);
document.addEventListener("scroll", event => { if (!rowMenu.contains(event.target)) closeRowMenu(); }, true);
window.addEventListener("resize", () => closeRowMenu());
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
const autoRefresh = () => { if (!loading && !saving && !reordering && !draggedId && !editor.open && !taskEditor.open && !deletion.open && !viewEditor.open && !viewDeletion.open && !$("#view-actions").open && rowMenu.hidden && !Object.values(facetFields).some(([id]) => $("#" + id).open) && !document.hidden) refresh(); };
document.addEventListener("visibilitychange", autoRefresh);
setInterval(autoRefresh, 60000);
$("#add").disabled = true; $("#empty-add").disabled = true;
refresh();
