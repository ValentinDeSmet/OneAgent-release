// Shared browser controller, embedded by the cockpit in both hosts.
function createMemoryExplorer(api) {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const defaults = () => ({ layout: 'graph', types: [], refs: [], sort: 'title', direction: 'asc', group: 'none', columns: ['kind', 'labels', 'updatedAt'] });
  const sanitize = value => {
    const v = value && typeof value === 'object' ? value : {};
    return { layout: v.layout === 'list' ? 'list' : 'graph', types: Array.isArray(v.types) ? [...new Set(v.types.filter(x => typeof x === 'string'))].sort() : [], refs: Array.isArray(v.refs) ? [...new Set(v.refs.filter(x => typeof x === 'string'))].sort() : [], sort: ['title', 'kind', 'updatedAt'].includes(v.sort) ? v.sort : 'title', direction: v.direction === 'desc' ? 'desc' : 'asc', group: v.group === 'kind' ? 'kind' : 'none', columns: Array.isArray(v.columns) ? ['kind', 'labels', 'updatedAt'].filter(x => v.columns.includes(x)) : defaults().columns };
  };
  let config = defaults(), page = 1, lastKey = '', selectedId, lastFocus, facetCount = 100;
  let cachedIndex, cachedGraph, cachedEntries, entryById = new Map();
  const names = { markdown: 'Markdown', google_sheet: 'Google Sheets', google_doc: 'Google Docs', linked_document: 'Document lié', source: 'Source', note: 'Note', task: 'Tâche', product: 'Produit', team: 'Équipe', person: 'Personne', feature: 'Fonctionnalité', feature_request: 'Demande', project: 'Projet', repository: 'Dépôt', decision: 'Décision', question: 'Question', risk: 'Risque' };
  const label = kind => names[kind] || api.typeLabel(kind) || kind.replace(/_/g, ' ');
  const topbar = $('.topbar'), stage = $('[data-panel="map"]'), content = $('.content');
  const oldToolbar = $('.map-toolbar'), oldTools = $('.toolbar:last-child', topbar), preset = $('#graphViewControls');
  const head = document.createElement('div'); head.className = 'memory-head';
  head.innerHTML = '<div class="memory-heading"><strong>Mémoire</strong><span>Retrouver et explorer</span></div><div class="memory-view-row"><div class="memory-view-tabs" role="tablist" aria-label="Vues de la mémoire"></div><label class="memory-view-picker">Toutes les vues <span class="memory-select-slot"></span></label><button type="button" id="memoryNewView" class="memory-button" title="Enregistrer une nouvelle vue">+ Vue</button><details class="memory-menu memory-view-menu"><summary aria-label="Actions sur la vue">…</summary><div class="memory-menu-body memory-view-actions"></div></details><span id="memoryDirty" role="status"></span></div><div class="memory-toolbar"><div class="memory-search-slot"></div><div class="memory-quick-layout" role="group" aria-label="Choisir l’affichage"><button class="memory-button" type="button" data-memory-layout="list">Liste</button><button class="memory-button" type="button" data-memory-layout="graph">Graphe</button></div><details class="memory-menu" id="memoryFilters"><summary>Filtres <span id="memoryFilterCount"></span></summary><div class="memory-menu-body"><div class="memory-menu-title">Filtrer les résultats</div><input id="memoryFacetSearch" class="control" type="search" placeholder="Chercher un type ou une entité…" aria-label="Rechercher un filtre"><div id="memoryFacets"></div><button class="memory-button" id="memoryResetFilters" type="button">Effacer les filtres</button><button class="memory-button" id="memoryGraphFilters" type="button">Filtres avancés du graphe</button></div></details><details class="memory-menu" id="memorySortMenu"><summary>Trier</summary><div class="memory-menu-body"><label>Trier par<select id="memorySort"><option value="title">Titre</option><option value="kind">Type</option><option value="updatedAt">Dernière modification</option></select></label><label>Ordre<select id="memoryDirection"><option value="asc">Croissant</option><option value="desc">Décroissant</option></select></label></div></details><details class="memory-menu" id="memoryDisplay"><summary>Affichage</summary><div class="memory-menu-body"><div class="memory-layout-choice" role="group" aria-label="Affichage"><button class="memory-button" type="button" data-memory-layout="list">☷ Liste</button><button class="memory-button" type="button" data-memory-layout="graph">⌘ Graphe</button></div><div class="memory-list-options"><label>Regrouper par<select id="memoryGroup"><option value="none">Aucun</option><option value="kind">Type</option></select></label><fieldset><legend>Propriétés visibles</legend><label><input type="checkbox" data-memory-column="kind">Type</label><label><input type="checkbox" data-memory-column="labels">Entités liées</label><label><input type="checkbox" data-memory-column="updatedAt">Dernière modification</label></fieldset></div><div class="memory-graph-options"></div></div></details><div class="memory-context-slot"></div></div><div class="memory-access-row"><span id="memoryAccessStatus" role="status"></span><button type="button" class="memory-button" id="memoryResetAll" title="Effacer les filtres et rétablir l’accès de l’agent à toute la mémoire">Réinitialiser</button></div><div id="memoryFilterChips" class="memory-filter-chips"></div>';
  topbar.append(head);
  $('.memory-select-slot', head).append($('#graphViewPreset'));
  $('.memory-view-actions', head).append(preset);
  const actionNames = { graphViewSaveAs: 'Enregistrer sous…', graphViewUpdate: 'Enregistrer les modifications', graphViewRename: 'Renommer', graphViewDuplicate: 'Dupliquer', graphViewCompare: 'Comparer', graphViewDelete: 'Supprimer la vue' };
  for (const [id, name] of Object.entries(actionNames)) { const button = $('#'+id); button.textContent = name; button.title = name; }
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'control'; cancel.id = 'memoryCancelChanges'; cancel.textContent = 'Annuler les modifications'; cancel.addEventListener('click', () => { api.restoreView(); closeMenus(); }); preset.append(cancel);
  $('.memory-search-slot', head).append($('.graph-search', oldTools));
  $('#filter').placeholder = 'Rechercher un titre, une entité, un fichier ou un lien…'; $('#filter').setAttribute('aria-label', 'Rechercher dans la mémoire');
  const contextControls = $('[aria-label="Graph interaction mode"]', oldToolbar);
  $('.memory-context-slot', head).append(contextControls);
  $('[data-graph-select="navigate"]').textContent = 'Explorer'; $('[data-graph-select="context"]').textContent = 'Contexte';
  $('.memory-graph-options', head).append(oldToolbar);
  $('.memory-graph-options', head).append($('#graphHiddenModeToggle'));
  const list = document.createElement('section'); list.id = 'memoryList'; list.setAttribute('aria-label', 'Liste de la mémoire'); stage.append(list);
  const close = document.createElement('button'); close.type = 'button'; close.id = 'memoryCloseDetail'; close.className = 'memory-button'; close.textContent = '← Retour aux résultats'; $('.side-graph .side-head').prepend(close);
  const restoreFocus = () => { const row = [...list.querySelectorAll('[data-memory-id]')].find(item => item.dataset.memoryId === selectedId); if (row) $('.memory-title', row)?.focus(); else lastFocus?.focus(); };
  close.addEventListener('click', () => { content.classList.remove('memory-detail-open'); restoreFocus(); });
  function openDetail() { lastFocus = document.activeElement; content.classList.add('memory-detail-open'); if (window.matchMedia('(max-width: 1180px)').matches) close.focus(); }
  function closeMenus() { head.querySelectorAll('details[open]').forEach(menu => { menu.open = false; }); }
  head.querySelectorAll('details').forEach(menu => menu.addEventListener('toggle', () => { if (menu.open) head.querySelectorAll('details[open]').forEach(other => { if (other !== menu) other.open = false; }); }));
  document.addEventListener('click', event => { if (!head.contains(event.target)) closeMenus(); });
  document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; const menu = $('details[open]', head); if (menu) { menu.open = false; $('summary', menu).focus(); } else if (content.classList.contains('memory-detail-open')) { content.classList.remove('memory-detail-open'); restoreFocus(); } });
  $('#memoryNewView').addEventListener('click', api.newView);
  $('#memoryResetAll').addEventListener('click', api.reset);
  $('#memoryResetFilters').addEventListener('click', () => { config.types = []; config.refs = []; changed(); });
  $('#memoryGraphFilters').addEventListener('click', () => { closeMenus(); api.graphFilters(); });
  $('#memoryFacetSearch').addEventListener('input', () => { facetCount = 100; facets(); });
  for (const [id, property] of [['memorySort','sort'], ['memoryDirection','direction'], ['memoryGroup','group']]) $('#'+id).addEventListener('change', event => { config[property] = event.target.value; changed(); });
  head.querySelectorAll('[data-memory-layout]').forEach(button => button.addEventListener('click', () => { config.layout = button.dataset.memoryLayout; closeMenus(); changed(); }));
  head.querySelectorAll('[data-memory-column]').forEach(input => input.addEventListener('change', () => { config.columns = [...head.querySelectorAll('[data-memory-column]:checked')].map(el => el.dataset.memoryColumn); changed(); }));
  function changed() { page = 1; api.changed(); }
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
    cachedEntries = result; entryById = new Map(result.map(entry => [entry.id, entry]));
    return result;
  }
  function matches(entry, omit) {
    const query = normalize($('#filter').value).split(/\s+/).filter(Boolean);
    const haystack = normalize([entry.title, entry.description, entry.kind, label(entry.kind), ...(entry.labels || []), ...(entry.refs || []), entry.file, entry.url].filter(Boolean).join(' '));
    return query.every(word => haystack.includes(word)) && (omit === 'types' || !config.types.length || config.types.includes(entry.kind)) && (omit === 'refs' || !config.refs.length || config.refs.some(ref => entry.refs?.includes(ref)));
  }
  function facets() {
    const all = entries(), filter = normalize($('#memoryFacetSearch').value), counts = new Map(), refs = new Map();
    for (const entry of all) {
      if (matches(entry, 'types')) counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1);
      if (matches(entry, 'refs')) (entry.refs || []).forEach((ref, i) => { const item = refs.get(ref) || { label: entry.labels?.[i] || ref, count: 0 }; item.count++; refs.set(ref, item); });
    }
    for (const type of config.types) if (!counts.has(type)) counts.set(type, 0);
    for (const ref of config.refs) if (!refs.has(ref)) refs.set(ref, { label: all.find(e => e.detailRef === ref)?.title || ref, count: 0 });
    const check = (field, value, title, count) => '<label class="memory-check"><input type="checkbox" data-field="'+field+'" value="'+esc(value)+'"'+(config[field].includes(value) ? ' checked' : '')+'><span>'+esc(title)+'</span><small>'+count+'</small></label>';
    const refItems = [...refs].sort((a,b) => a[1].label.localeCompare(b[1].label,'fr')).filter(([,item]) => normalize(item.label).includes(filter));
    $('#memoryFacets').innerHTML = '<fieldset><legend>Type</legend>'+[...counts].sort((a,b) => label(a[0]).localeCompare(label(b[0]), 'fr')).filter(([kind]) => normalize(label(kind)).includes(filter)).map(([kind,count]) => check('types',kind,label(kind),count)).join('')+'</fieldset><fieldset><legend>Entités liées</legend>'+refItems.slice(0, facetCount).map(([ref,item]) => check('refs',ref,item.label,item.count)).join('')+'</fieldset>';
    if (refItems.length > facetCount) { const more = document.createElement('button'); more.type = 'button'; more.className = 'memory-button'; more.textContent = 'Afficher plus ('+facetCount+' / '+refItems.length+')'; more.onclick = () => { facetCount += 100; facets(); }; $('#memoryFacets').append(more); }
    $('#memoryFacets').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { const field = input.dataset.field; config[field] = input.checked ? [...config[field], input.value] : config[field].filter(value => value !== input.value); const value = input.value; changed(); [...$('#memoryFacets').querySelectorAll('input')].find(item => item.dataset.field === field && item.value === value)?.focus(); }));
  }
  function refreshViews() {
    const { views, activeId, dirty } = api.views();
    const html = '<button class="memory-view-tab'+(!activeId ? ' active' : '')+'" role="tab" aria-selected="'+!activeId+'" data-memory-view="">Tout</button>'+views.map(view => '<button class="memory-view-tab'+(view.id === activeId ? ' active' : '')+'" role="tab" aria-selected="'+(view.id === activeId)+'" data-memory-view="'+esc(view.id)+'">'+(view.payload?.memory?.layout === 'list' ? '☷ ' : '⌘ ')+esc(view.name)+'</button>').join('');
    const tabs = $('.memory-view-tabs');
    if (tabs.innerHTML !== html) { tabs.innerHTML = html; tabs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { closeMenus(); api.selectView(button.dataset.memoryView); })); }
    $('#memoryDirty').innerHTML = activeId && dirty ? 'Modifiée <button type="button" class="memory-button" id="memorySaveChanges">Enregistrer</button>' : '';
    $('#memorySaveChanges')?.addEventListener('click', () => $('#graphViewUpdate').click());
    $('#memoryCancelChanges').hidden = !activeId || !dirty;
  }
  function render() {
    topbar.classList.toggle('memory-list-active', config.layout === 'list'); stage.classList.toggle('memory-list-active', config.layout === 'list');
    list.hidden = config.layout !== 'list';
    $('#memorySortMenu').hidden = config.layout !== 'list'; $('#memoryGraphFilters').hidden = config.layout === 'list';
    $('.memory-list-options').hidden = config.layout !== 'list'; $('.memory-graph-options').hidden = config.layout === 'list';
    head.querySelectorAll('[data-memory-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.memoryLayout === config.layout)));
    head.querySelectorAll('[data-memory-column]').forEach(input => { input.checked = config.columns.includes(input.dataset.memoryColumn); });
    $('#memorySort').value = config.sort; $('#memoryDirection').value = config.direction; $('#memoryGroup').value = config.group;
    $('#memoryFilterCount').textContent = config.types.length + config.refs.length || '';
    const chips = [...config.types.map(value => ['types', value, label(value)]), ...config.refs.map(value => ['refs', value, entries().find(entry => entry.detailRef === value)?.title || value])];
    $('#memoryFilterChips').innerHTML = chips.map(([field,value,title]) => '<button type="button" class="memory-chip" data-field="'+field+'" data-value="'+esc(value)+'">'+esc(title)+' <span aria-hidden="true">×</span><span class="sr-only">Retirer le filtre</span></button>').join('');
    $('#memoryFilterChips').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { config[button.dataset.field] = config[button.dataset.field].filter(x => x !== button.dataset.value); changed(); }));
    facets(); refreshViews();
    if (config.layout !== 'list') return;
    if (api.state().memoryIndex?.error) { list.innerHTML = '<div class="memory-empty" role="alert"><strong>Catalogue indisponible</strong><p>'+esc(api.state().memoryIndex.error)+'</p><button class="memory-button" id="memoryRetry">Réessayer</button></div>'; $('#memoryRetry').addEventListener('click', api.refresh); return; }
    const all = entries();
    const fingerprint = JSON.stringify([$('#filter').value, config]); if (fingerprint !== lastKey) { page = 1; lastKey = fingerprint; }
    const filtered = all.filter(entry => matches(entry)).sort((a,b) => {
      const grouped = config.group === 'kind' ? label(a.kind).localeCompare(label(b.kind), 'fr') : 0;
      const left = config.sort === 'kind' ? label(a.kind) : a[config.sort] || '', right = config.sort === 'kind' ? label(b.kind) : b[config.sort] || '';
      return grouped || String(left).localeCompare(String(right),'fr',{numeric:true,sensitivity:'base'}) * (config.direction === 'desc' ? -1 : 1) || a.id.localeCompare(b.id);
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length/80)); page = Math.min(page,totalPages);
    let group;
    const rows = filtered.slice((page-1)*80, page*80).map(entry => {
      const heading = config.group === 'kind' && group !== entry.kind ? '<h3 class="memory-group-heading">'+esc(label(entry.kind))+'</h3>' : ''; group = entry.kind;
      const details = [config.columns.includes('kind') ? '<span class="memory-kind">'+esc(label(entry.kind))+'</span>' : '', config.columns.includes('labels') ? '<span>'+esc((entry.labels || []).join(' · '))+'</span>' : '', config.columns.includes('updatedAt') && entry.updatedAt ? '<time datetime="'+esc(entry.updatedAt)+'">'+esc(new Date(entry.updatedAt).toLocaleDateString('fr-FR'))+'</time>' : ''].join('');
      return heading+'<article class="memory-row'+(entry.id === selectedId ? ' selected' : '')+'" data-memory-id="'+esc(entry.id)+'"><div class="memory-row-main"><button class="memory-title" data-memory-action="inspect">'+esc(entry.title)+'</button><div class="memory-row-meta">'+details+'</div>'+(entry.description ? '<p class="memory-description">'+esc(entry.description)+'</p>' : '')+'</div><div class="memory-row-actions">'+(entry.file ? '<button class="memory-button" data-memory-action="file" title="Ouvrir le fichier">↗ '+(/\.(md|markdown)$/i.test(entry.file) ? 'Markdown' : 'Fichier')+'</button>' : '')+(entry.url ? '<button class="memory-button" data-memory-action="url" title="Ouvrir le document source">↗ Source</button>' : '')+'</div></article>';
    }).join('');
    list.innerHTML = '<div class="memory-results-heading"><span role="status">'+filtered.length+' résultat'+(filtered.length>1?'s':'')+' / '+all.length+'</span><span>Recherche dans les titres, descriptions et liens</span></div>'+(rows || '<div class="memory-empty"><strong>Aucun résultat</strong><p>Essaie un autre mot ou enlève un filtre.</p><button class="memory-button" id="memoryShowAll">Afficher toute la mémoire</button></div>')+'<nav class="memory-pagination" aria-label="Pages de résultats"><button class="memory-button" data-page="-1"'+(page===1?' disabled':'')+'>Précédent</button><span>'+page+' / '+totalPages+'</span><button class="memory-button" data-page="1"'+(page===totalPages?' disabled':'')+'>Suivant</button></nav>';
    list.querySelectorAll('[data-memory-action]').forEach(button => button.addEventListener('click', () => {
      const entry = all.find(item => item.id === button.closest('[data-memory-id]').dataset.memoryId); if (!entry) return;
      selectedId = entry.id;
      if (button.dataset.memoryAction !== 'inspect') api.open(entry, button.dataset.memoryAction);
      else if (entry.category === 'entity' || entry.nodeId) { openDetail(); api.inspect(entry); }
      else if (entry.taskId) api.task(entry.taskId);
      else if (entry.noteId) { if (api.note(entry.noteId) === false) { if (entry.file) api.open(entry, "file"); else { openDetail(); api.inspect(entry); } } }
      else if (entry.file || entry.url) api.open(entry, entry.file ? 'file' : 'url');
      else if (entry.detailRef) { openDetail(); api.inspect(entry); }
      else { openDetail(); api.inspect(entry); }
    }));
    list.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { page += Number(button.dataset.page); render(); list.scrollTop = 0; $('.memory-title', list)?.focus(); }));
    $('#memoryShowAll')?.addEventListener('click', () => { config.types=[];config.refs=[];$('#filter').value='';changed(); });
  }
  const resize = () => topbar.style.setProperty('--memory-header-bottom', topbar.getBoundingClientRect().bottom+'px');
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(topbar);
  window.addEventListener('resize', resize); resize();
  return { render, refreshViews, sanitize, snapshot: () => sanitize(config), apply(value) { config=sanitize(value);page=1;content.classList.remove('memory-detail-open'); },
    openDetail, setActive(active) { content.classList.toggle('memory-active',active); if (!active) content.classList.remove('memory-detail-open'); },
    isList: () => config.layout === 'list',
    matchesNode(node) { const ref=api.entityRef(node); entries(); const entry=entryById.get(ref ? 'entity:'+ref : node.id) || { kind: node.type, refs: [], title: node.label }; return matches(entry); }
  };
}
module.exports = { createMemoryExplorer };
