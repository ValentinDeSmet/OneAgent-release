// Shared browser controller, embedded by the cockpit in both hosts.
function createMemoryExplorer(api, createMemoryTable) {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const columns = {
    title: { label: 'Titre', width: 340 }, kind: { label: 'Type', field: 'types', width: 190 },
    labels: { label: 'Entités liées', field: 'refs', width: 230 }, updatedAt: { label: 'Dernière modification', width: 190 },
    createdAt: { label: 'Création', width: 150 }, status: { label: 'Statut', field: 'statuses', width: 150 },
    location: { label: 'Emplacement / source', width: 280 }, open: { label: 'Ouvrir', width: 230 }
  };
  const defaults = () => ({ layout: 'list', types: [], refs: [], statuses: [], sort: 'title', direction: 'asc', group: 'none', columns: ['kind', 'labels', 'updatedAt'], columnOrder: Object.keys(columns), widths: {}, titleQuery: '', locationQuery: '', createdAtFrom: '', createdAtTo: '', updatedAtFrom: '', updatedAtTo: '' });
  const sanitize = value => {
    const v = value && typeof value === 'object' ? value : {}, clean = defaults();
    // Missing layout in a saved legacy view means graph; the global view is explicitly a table.
    clean.layout = v.layout === 'list' ? 'list' : 'graph';
    for (const field of ['types', 'refs', 'statuses']) clean[field] = Array.isArray(v[field]) ? [...new Set(v[field].filter(x => typeof x === 'string'))].sort() : [];
    clean.sort = Object.keys(columns).filter(key => key !== 'open').includes(v.sort) ? v.sort : 'title';
    clean.direction = v.direction === 'desc' ? 'desc' : 'asc'; clean.group = v.group === 'kind' ? 'kind' : 'none';
    clean.columns = Array.isArray(v.columns) ? [...new Set(v.columns.filter(key => columns[key] && !['title', 'open'].includes(key)))] : clean.columns;
    clean.columnOrder = [...new Set([...(Array.isArray(v.columnOrder) ? v.columnOrder.filter(key => columns[key]) : []), ...Object.keys(columns)])];
    for (const key of Object.keys(columns)) if (Number.isFinite(v.widths?.[key])) clean.widths[key] = Math.max(100, Math.min(900, Math.round(v.widths[key])));
    for (const key of ['titleQuery', 'locationQuery']) clean[key] = typeof v[key] === 'string' ? v[key].slice(0, 2000) : '';
    for (const key of ['createdAtFrom', 'createdAtTo', 'updatedAtFrom', 'updatedAtTo']) clean[key] = /^\d{4}-\d{2}-\d{2}$/.test(v[key]) && Number.isFinite(Date.parse(v[key])) ? v[key] : '';
    // A filtered column must be visible so its active filter can always be found.
    for (const [key, column] of Object.entries(columns)) if ((column.field && clean[column.field].length) || clean[key + 'Query'] || clean[key + 'From'] || clean[key + 'To']) if (!['title','open'].includes(key) && !clean.columns.includes(key)) clean.columns.push(key);
    if (clean.sort !== "title" && !clean.columns.includes(clean.sort)) clean.columns.push(clean.sort);
    return clean;
  };
  let config = defaults(), lastFocus, facetCount = 100, newViewMode;
  let cachedIndex, cachedGraph, cachedEntries, entryById = new Map();
  const names = { markdown: 'Markdown', google_sheet: 'Google Sheets', google_doc: 'Google Docs', linked_document: 'Document lié', source: 'Source', note: 'Note', task: 'Tâche', product: 'Produit', team: 'Équipe', person: 'Personne', feature: 'Fonctionnalité', feature_request: 'Demande', project: 'Projet', repository: 'Dépôt', decision: 'Décision', question: 'Question', risk: 'Risque' };
  const label = kind => names[kind] || api.typeLabel(kind) || kind.replace(/_/g, ' ');
  const filterInput = $('#filter');
  const topbar = $('.topbar'), stage = $('[data-panel="map"]'), content = $('.content');
  const oldToolbar = $('.map-toolbar'), oldTools = $('.toolbar:last-child', topbar), preset = $('#graphViewControls');
  const head = document.createElement('div'); head.className = 'memory-head';
  head.innerHTML = '<div class="memory-heading"><strong>Mémoire</strong><span>Retrouver et explorer</span></div><div class="memory-view-row"><div class="memory-view-tabs" role="tablist" aria-label="Vues de la mémoire"></div><label class="memory-view-picker">Toutes les vues <span class="memory-select-slot"></span></label><button type="button" id="memoryNewView" class="memory-button" title="Enregistrer une nouvelle vue">+ Vue</button><details class="memory-menu memory-view-menu"><summary aria-label="Actions sur la vue">…</summary><div class="memory-menu-body memory-view-actions"></div></details><span id="memoryDirty" role="status"></span></div><div class="memory-toolbar"><div class="memory-search-slot"></div><details class="memory-menu" id="memoryFilters"><summary>Filtres <span id="memoryFilterCount"></span></summary><div class="memory-menu-body"><div class="memory-menu-title">Filtrer les résultats</div><input id="memoryFacetSearch" class="control" type="search" placeholder="Chercher un type ou une entité…" aria-label="Rechercher un filtre"><div id="memoryFacets"></div><button class="memory-button" id="memoryResetFilters" type="button">Effacer les filtres</button><button class="memory-button" id="memoryGraphFilters" type="button">Filtres avancés du graphe</button></div></details><details class="memory-menu" id="memoryDisplay"><summary id="memoryDisplayLabel">Colonnes</summary><div class="memory-menu-body"><div class="memory-list-options"><div id="memoryColumnSettings"></div><label>Regrouper par<select id="memoryGroup"><option value="none">Aucun</option><option value="kind">Type</option></select></label></div><div class="memory-graph-options"></div></div></details><div class="memory-context-slot"></div></div><div class="memory-access-row"><span id="memoryAccessStatus" role="status"></span><button type="button" class="memory-button" id="memoryResetAll" title="Effacer les filtres et rétablir l’accès de l’agent à toute la mémoire">Toute la mémoire</button></div><div id="memoryFilterChips" class="memory-filter-chips"></div>';
  topbar.append(head);
  $('.memory-select-slot', head).append($('#graphViewPreset'));
  $('.memory-view-actions', head).append(preset);
  const actionNames = { graphViewSaveAs: 'Enregistrer sous…', graphViewUpdate: 'Enregistrer les modifications', graphViewRename: 'Renommer', graphViewDuplicate: 'Dupliquer', graphViewCompare: 'Comparer', graphViewDelete: 'Supprimer la vue' };
  for (const [id, name] of Object.entries(actionNames)) { const button = $('#'+id); button.textContent = name; button.title = name; }
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'control'; cancel.id = 'memoryCancelChanges'; cancel.textContent = 'Rétablir la vue'; cancel.addEventListener('click', () => { api.restoreView(); closeMenus(); }); preset.append(cancel);
  $('.memory-search-slot', head).append($('.graph-search', oldTools));
  $('#filter').placeholder = 'Rechercher un titre, une entité, un fichier ou un lien…'; $('#filter').setAttribute('aria-label', 'Rechercher dans la mémoire');
  const contextControls = $('[aria-label="Graph interaction mode"]', oldToolbar);
  $('.memory-view-actions', head).append(contextControls);
  $('[data-graph-select="navigate"]').textContent = 'Explorer'; $('[data-graph-select="context"]').textContent = 'Contexte';
  $('.memory-graph-options', head).append(oldToolbar);
  $('.memory-graph-options', head).append($('#graphHiddenModeToggle'));
  const list = document.createElement('section'); list.id = 'memoryList'; list.setAttribute('aria-label', 'Tableau de la mémoire'); stage.append(list);
  const close = document.createElement('button'); close.type = 'button'; close.id = 'memoryCloseDetail'; close.className = 'memory-button'; close.textContent = '← Retour aux résultats'; $('.side-graph .side-head').prepend(close);
  const restoreFocus = () => { if (lastFocus?.isConnected) lastFocus.focus(); else $('.memory-title', list)?.focus(); };
  close.addEventListener('click', () => { content.classList.remove('memory-detail-open'); restoreFocus(); });
  function openDetail() { lastFocus = document.activeElement; content.classList.add('memory-detail-open'); if (config.layout === 'list' || window.matchMedia('(max-width: 1180px)').matches) close.focus(); }
  function closeMenus() { head.querySelectorAll('details[open]').forEach(menu => { menu.open = false; }); }
  head.querySelectorAll('details').forEach(menu => menu.addEventListener('toggle', () => { if (menu.open) head.querySelectorAll('details[open]').forEach(other => { if (other !== menu) other.open = false; }); }));
  document.addEventListener('click', event => { if (!head.contains(event.target)) closeMenus(); });
  document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; const menu = $('details[open]', head); if (menu) { menu.open = false; $('summary', menu).focus(); } else if (content.classList.contains('memory-detail-open')) { content.classList.remove('memory-detail-open'); restoreFocus(); } });
  $('#memoryNewView').addEventListener('click', () => createView());
  $('#memoryResetAll').addEventListener('click', api.reset);
  $('#memoryResetFilters').addEventListener('click', () => {
    for (const field of ['types', 'refs', 'statuses']) config[field] = [];
    for (const field of ['titleQuery', 'locationQuery', 'createdAtFrom', 'createdAtTo', 'updatedAtFrom', 'updatedAtTo']) config[field] = '';
    changed();
  });
  $('#memoryGraphFilters').addEventListener('click', () => { closeMenus(); api.graphFilters(); });
  $('#memoryFacetSearch').addEventListener('input', () => { facetCount = 100; facets(); });
  $('#memoryGroup').addEventListener('change', event => { config.group = event.target.value; changed(); });
  function changed() { api.changed(); }
  const table = createMemoryTable({ root: list, esc, columns, normalize, label, config: () => config, entries, matches, options: filterOptions, value: columnValue, query: () => filterInput.value, changed, open: openEntry });
  function openEntry(entry, action) {
    if (action === 'file' || action === 'url') return api.open({ ...entry, id: action === 'file' ? entry.fileEntryId || entry.id : entry.urlEntryId || entry.id }, action);
    if (entry.taskId) return api.task(entry.taskId);
    if (entry.noteId && api.note(entry.noteId) !== false) return;
    openDetail(); api.inspect(entry);
  }
  const dialog = document.createElement('dialog'); dialog.className = 'memory-view-dialog'; dialog.setAttribute('aria-labelledby', 'memoryViewDialogTitle');
  dialog.innerHTML = '<form id="memoryViewForm"><h2 id="memoryViewDialogTitle">Nouvelle vue</h2><label>Nom<input class="control" id="memoryViewName" required maxlength="120" placeholder="Ex. Documents DKT FF"></label><fieldset><legend>Affichage de la vue</legend><label><input type="radio" name="memoryViewLayout" value="list" checked><span><strong>☷ Tableau</strong><small>Rechercher, filtrer et ouvrir les documents</small></span></label><label><input type="radio" name="memoryViewLayout" value="graph"><span><strong>⌘ Graphe</strong><small>Explorer les relations entre les éléments</small></span></label></fieldset><p class="memory-muted" id="memoryViewDialogHint"></p><div class="memory-dialog-actions"><button type="button" class="memory-button" id="memoryViewCancel">Annuler</button><button type="submit" class="memory-button primary">Créer la vue</button></div></form>';
  document.body.append(dialog);
  const closeDialog = () => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); $('#memoryNewView').focus(); };
  $('#memoryViewCancel', dialog).addEventListener('click', closeDialog);
  $('#memoryViewForm', dialog).addEventListener('submit', event => {
    event.preventDefault(); const name = $('#memoryViewName', dialog).value.trim(); if (!name) return;
    api.createView({ name, layout: $('input[name="memoryViewLayout"]:checked', dialog).value, copy: newViewMode === 'copy' }); closeDialog();
  });
  function createView(layout, copy = false) {
    closeMenus(); table.closeMenu(); newViewMode = copy ? 'copy' : 'new';
    $('#memoryViewDialogTitle', dialog).textContent = copy ? 'Dupliquer la vue' : 'Nouvelle vue';
    const view = api.views().views.find(view => view.id === api.views().activeId);
    $('#memoryViewName', dialog).value = copy ? (view?.name || 'Toute la mémoire') + ' — ' + ((layout || config.layout) === 'list' ? 'tableau' : 'graphe') : '';
    $('input[value="' + (layout || 'list') + '"]', dialog).checked = true;
    $('#memoryViewDialogHint', dialog).textContent = copy ? 'Les filtres, colonnes, tris et le contexte de cette vue sont conservés. La vue d’origine reste intacte.' : 'La nouvelle vue commence sans filtre, avec accès à toute la mémoire.';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    $('#memoryViewName', dialog).focus();
  }
  for (const [layout, title] of [['list', 'Dupliquer en tableau'], ['graph', 'Dupliquer en graphe']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'control'; button.dataset.memoryDuplicate = layout; button.textContent = title;
    button.addEventListener('click', () => createView(layout, true)); preset.append(button);
  }
  function entries() {
    const state = api.state();
    if (cachedEntries && cachedIndex === state.memoryIndex && cachedGraph === state.graph) return cachedEntries;
    cachedIndex = state.memoryIndex; cachedGraph = state.graph;
    const result = [...(state.memoryIndex?.entries || [])];
    const ids = new Set(result.map(entry => entry.id));
    // Retain graph-only kinds (for example Graphify nodes) without duplicating
    // entities already in the complete catalogue.
    for (const node of api.state().graph?.nodes || []) {
      const ref = api.entityRef(node), id = ref ? 'entity:'+ref : node.id;
      if (ids.has(id) || (node.type === 'capture' && ids.has(node.id))) continue;
      result.push({ id, nodeId: node.id, title: node.label, category: 'graph', kind: node.type, refs: ref ? [ref] : [], labels: [], description: node.meta?.description || '', status: node.status, detailRef: ref }); ids.add(id);
    }
    const byFile = new Map();
    for (const entry of result) if (entry.file) { if (!byFile.has(entry.file)) byFile.set(entry.file, []); byFile.get(entry.file).push(entry); }
    const consumed = new Set(), rows = [];
    const rank = entry => ['entity','note','capture','document','source','task','graph'].indexOf(entry.category);
    for (const entry of result) {
      if (consumed.has(entry.id)) continue;
      let group = entry.file ? byFile.get(entry.file) : [entry];
      // Multiple entities/notes can legitimately refer to the same file. Do not
      // collapse distinct business records; only attach representations when unambiguous.
      if (group.filter(item => ['entity','note','capture','task'].includes(item.category)).length > 1) group = [entry];
      group = [...group].sort((a,b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
      const primary = group[0], refs = new Map();
      for (const item of group) { consumed.add(item.id); item.refs.forEach((ref, i) => refs.set(ref, item.labels?.[i] || ref)); }
      const fileEntry = group.find(item => item.file), urlEntry = group.find(item => item.url);
      const dates = group.map(item => item.updatedAt).filter(date => date && Number.isFinite(Date.parse(date))).sort((a,b) => Date.parse(b) - Date.parse(a));
      rows.push({ ...primary, updatedAt: dates[0], refs: [...refs.keys()], labels: [...refs.values()], kinds: [...new Set(group.map(item => item.kind))],
        file: fileEntry?.file, fileEntryId: fileEntry?.id, url: urlEntry?.url, urlEntryId: urlEntry?.id,
        representations: group, searchText: group.map(item => [item.title,item.description,item.file,item.url].join(' ')).join(' ') });
    }
    cachedEntries = rows; entryById = new Map(rows.flatMap(entry => entry.representations.map(item => [item.id, entry])));
    return rows;
  }
  const statusLabels = { open: 'À faire', ready: 'Prêt à démarrer', in_progress: 'En cours', pending: 'À clarifier', candidate: 'À valider', blocked: 'En attente', clarification: 'À clarifier', review: 'À valider', waiting: 'En attente', done: 'Terminé', active: 'Actif', archived: 'Archivé', indexed: 'Indexé' };
  function columnValue(entry, key) {
    if (key === 'kind') return (entry.kinds || [entry.kind]).map(label).join(' · ');
    if (key === 'labels') return entry.labels.join(' · ');
    if (key === 'location') return [entry.file, entry.url].filter(Boolean).join(' · ');
    if (key === 'status') return statusLabels[entry.status] || entry.status || '';
    return entry[key] || '';
  }
  function matches(entry, omit) {
    const query = normalize(filterInput.value).split(/\s+/).filter(Boolean);
    const haystack = normalize([entry.title, entry.description, entry.kind, columnValue(entry,'kind'), ...(entry.labels || []), ...(entry.refs || []), entry.file, entry.url, entry.searchText].filter(Boolean).join(' '));
    const values = { types: entry.kinds || [entry.kind], refs: entry.refs.length ? entry.refs : ['__none__'], statuses: [entry.status || '__none__'] };
    if (!query.every(word => haystack.includes(word))) return false;
    for (const field of Object.keys(values)) if (omit !== field && config[field].length && !config[field].some(value => values[field].includes(value))) return false;
    for (const key of ['title', 'location']) if (omit !== key && !normalize(columnValue(entry,key)).includes(normalize(config[key+'Query']))) return false;
    for (const key of ['createdAt', 'updatedAt']) {
      if (omit === key) continue;
      const from = config[key+'From'], to = config[key+'To'];
      if (!from && !to) continue;
      const date = entry[key] && Number.isFinite(Date.parse(entry[key])) ? new Date(entry[key]).toLocaleDateString('sv-SE') : '';
      if ((from || to) && (!date || (from && date < from) || (to && date > to))) return false;
    }
    return true;
  }
  function filterOptions(field) {
    const counts = new Map(), all = entries();
    for (const entry of all) {
      if (!matches(entry, field)) continue;
      const pairs = field === 'types' ? (entry.kinds || [entry.kind]).map(kind => [kind,label(kind)]) : field === 'refs' ? entry.refs.map((ref,i) => [ref,entry.labels[i] || ref]) : [[entry.status || '__none__', columnValue(entry,'status') || 'Sans statut']];
      if (!pairs.length) pairs.push(['__none__', 'Sans entité liée']);
      for (const [value,title] of pairs) { const item = counts.get(value) || { value, label: title, count: 0 }; item.count++; counts.set(value,item); }
    }
    for (const value of config[field]) if (!counts.has(value)) counts.set(value,{ value, label: field === 'types' ? label(value) : field === 'statuses' ? statusLabels[value] || (value === '__none__' ? 'Sans statut' : value) : all.find(entry => entry.refs.includes(value))?.labels[all.find(entry => entry.refs.includes(value)).refs.indexOf(value)] || (value === '__none__' ? 'Sans entité liée' : value), count: 0 });
    return [...counts.values()].sort((a,b) => a.label.localeCompare(b.label,'fr'));
  }
  function facets() {
    const filter = normalize($('#memoryFacetSearch').value);
    const counts = new Map(filterOptions('types').map(item => [item.value,item.count]));
    const refs = new Map(filterOptions('refs').map(item => [item.value,item]));
    const check = (field, value, title, count) => '<label class="memory-check"><input type="checkbox" data-field="'+field+'" value="'+esc(value)+'"'+(config[field].includes(value) ? ' checked' : '')+'><span>'+esc(title)+'</span><small>'+count+'</small></label>';
    const refItems = [...refs].sort((a,b) => a[1].label.localeCompare(b[1].label,'fr')).filter(([,item]) => normalize(item.label).includes(filter));
    $('#memoryFacets').innerHTML = '<fieldset><legend>Type</legend>'+[...counts].sort((a,b) => label(a[0]).localeCompare(label(b[0]), 'fr')).filter(([kind]) => normalize(label(kind)).includes(filter)).map(([kind,count]) => check('types',kind,label(kind),count)).join('')+'</fieldset><fieldset><legend>Entités liées</legend>'+refItems.slice(0, facetCount).map(([ref,item]) => check('refs',ref,item.label,item.count)).join('')+'</fieldset>';
    if (refItems.length > facetCount) { const more = document.createElement('button'); more.type = 'button'; more.className = 'memory-button'; more.textContent = 'Afficher plus ('+facetCount+' / '+refItems.length+')'; more.onclick = () => { facetCount += 100; facets(); }; $('#memoryFacets').append(more); }
    $('#memoryFacets').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { const field = input.dataset.field; config[field] = input.checked ? [...config[field], input.value] : config[field].filter(value => value !== input.value); const value = input.value; changed(); [...$('#memoryFacets').querySelectorAll('input')].find(item => item.dataset.field === field && item.value === value)?.focus(); }));
  }
  function refreshViews() {
    const { views, activeId, dirty } = api.views();
    const html = '<button class="memory-view-tab'+(!activeId ? ' active' : '')+'" role="tab" aria-selected="'+!activeId+'" data-memory-view="">Toute la mémoire</button>'+views.map(view => '<button class="memory-view-tab'+(view.id === activeId ? ' active' : '')+'" role="tab" aria-selected="'+(view.id === activeId)+'" data-memory-view="'+esc(view.id)+'">'+(view.payload?.memory?.layout === 'list' ? '☷ ' : '⌘ ')+esc(api.viewLabel(view))+'</button>').join('');
    const tabs = $('.memory-view-tabs');
    if (tabs.innerHTML !== html) { tabs.innerHTML = html; tabs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { closeMenus(); api.selectView(button.dataset.memoryView); })); }
    $('#memoryDirty').innerHTML = activeId && dirty ? 'Modifiée <button type="button" class="memory-button" id="memorySaveChanges">Enregistrer</button>' : '';
    $('#memorySaveChanges')?.addEventListener('click', () => $('#graphViewUpdate').click());
    $('#memoryCancelChanges').hidden = !activeId || !dirty;
  }
  function render() {
    const isTable = config.layout === 'list';
    topbar.classList.toggle('memory-list-active', isTable); stage.classList.toggle('memory-list-active', isTable); content.classList.toggle('memory-table-active', isTable);
    list.hidden = !isTable; $('#memoryFilters').hidden = isTable;
    $('.memory-list-options').hidden = !isTable; $('.memory-graph-options').hidden = isTable;
    $('#memoryDisplayLabel').textContent = isTable ? 'Colonnes' : 'Affichage';
    $('#memoryGroup').value = config.group;
    // The global entry already restores both filters and context. Avoid a second identical action.
    $('#memoryResetAll').hidden = !api.views().activeId;
    $('#memoryFilterCount').textContent = config.types.length + config.refs.length || '';
    $('#memoryFilterChips').innerHTML = '';
    if (!isTable) {
      const chips = [...config.types.map(value => ['types',value,label(value)]), ...config.refs.map(value => ['refs',value,filterOptions('refs').find(item => item.value === value)?.label || value])];
      chips.push(...config.statuses.map(value => ['statuses',value,statusLabels[value] || value]));
      for (const [field,title] of [['titleQuery','Titre'],['locationQuery','Emplacement'],['createdAtFrom','Création depuis'],['createdAtTo','Création jusqu’au'],['updatedAtFrom','Modification depuis'],['updatedAtTo','Modification jusqu’au']]) if (config[field]) chips.push([field,config[field],title+' : '+config[field]]);
      $('#memoryFilterChips').innerHTML = chips.map(([field,value,title]) => '<button type="button" class="memory-chip" data-field="'+field+'" data-value="'+esc(value)+'">'+esc(title)+' ×</button>').join('');
      $('#memoryFilterChips').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { const field = button.dataset.field; config[field] = Array.isArray(config[field]) ? config[field].filter(value => value !== button.dataset.value) : ''; changed(); }));
      facets(); table.closeMenu();
    }
    refreshViews();
    if (!isTable) return;
    table.renderColumns($('#memoryColumnSettings'));
    if (api.state().memoryIndex?.error) { table.closeMenu(); list.innerHTML = '<div class="memory-empty" role="alert"><strong>Catalogue indisponible</strong><p>'+esc(api.state().memoryIndex.error)+'</p><button type="button" class="memory-button" id="memoryRetry">Réessayer</button></div>'; $('#memoryRetry').addEventListener('click',api.refresh); return; }
    table.render();
  }
  const resize = () => topbar.style.setProperty('--memory-header-bottom', topbar.getBoundingClientRect().bottom+'px');
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(topbar);
  window.addEventListener('resize', resize); resize();
  return { render, refreshViews, sanitize, createView, defaults, snapshot: () => sanitize(config), apply(value) { config=sanitize(value);table.reset();content.classList.remove('memory-detail-open'); },
    openDetail, setActive(active) { content.classList.toggle('memory-active',active); if (!active) { content.classList.remove('memory-detail-open'); table.closeMenu(); } },
    isList: () => config.layout === 'list',
    matchesNode(node) { const ref=api.entityRef(node); entries(); const entry=entryById.get(ref ? 'entity:'+ref : node.id) || { kind: node.type, refs: [], title: node.label }; return matches(entry); }
  };
}
module.exports = { createMemoryExplorer };
