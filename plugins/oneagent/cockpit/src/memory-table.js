// DOM table renderer shared by both hosts. All state belongs to the saved view;
// selections and popover searches are temporary and never activate agent context.
function createMemoryTable(api) {
  const { root, esc, columns } = api;
  const $ = (selector, node = root) => node.querySelector(selector);
  let page = 1, fingerprint = '', visible = [], selected = new Set(), menuColumn, menuSearch = '', optionLimit = 80;
  let dragColumn;
  const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
  const menu = document.createElement('div');
  menu.className = 'memory-column-menu'; menu.hidden = true; menu.setAttribute('role', 'dialog');
  document.body.append(menu);
  const columnButton = key => [...root.querySelectorAll('[data-column-menu]')].find(button => button.dataset.columnMenu === key);
  function closeMenu(restore = false) {
    const button = columnButton(menuColumn); button?.setAttribute("aria-expanded", "false"); menu.hidden = true; menuColumn = undefined;
    if (restore) button?.focus();
  }
  function positionMenu() {
    const anchor = columnButton(menuColumn); if (!anchor) return closeMenu();
    const rect = anchor.getBoundingClientRect(), width = Math.min(320, window.innerWidth - 32);
    menu.style.width = width + 'px';
    menu.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)) + 'px';
    const space = window.innerHeight - rect.bottom - 16;
    menu.style.top = (space >= 220 ? rect.bottom + 5 : Math.max(16, rect.top - Math.min(menu.scrollHeight || 400, window.innerHeight - 32) - 5)) + 'px';
    menu.style.maxHeight = Math.max(160, space >= 220 ? space - 5 : rect.top - 32) + 'px';
  }
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !event.target.closest('[data-column-menu]')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(true); }
  });
  window.addEventListener('resize', () => { if (!menu.hidden) positionMenu(); });
  function updateSelection() {
    const byId = new Map(api.entries().map(entry => [entry.id, entry]));
    selected = new Set([...selected].filter(id => byId.has(id)));
    root.querySelectorAll('[data-memory-id]').forEach(row => {
      const checked = selected.has(row.dataset.memoryId);
      row.classList.toggle('selected', checked);
      const checkbox = $('[data-row-select]', row); if (checkbox) checkbox.checked = checked;
    });
    const count = $('#memorySelectedCount'); if (count) count.textContent = selected.size ? selected.size + ' sélectionné' + (selected.size > 1 ? 's' : '') : '';
    const clear = $('#memoryClearSelection'); if (clear) clear.hidden = !selected.size;
    const all = $('#memorySelectPage');
    if (all) { const n = visible.filter(entry => selected.has(entry.id)).length; all.checked = n > 0 && n === visible.length; all.indeterminate = n > 0 && n < visible.length; all.disabled = !visible.length; }
  }
  function select(entry, extend) {
    if (extend) { if (selected.has(entry.id)) selected.delete(entry.id); else selected.add(entry.id); }
    else selected = new Set([entry.id]);
    updateSelection();
  }
  function setSort(key, direction) {
    const config = api.config(); config.sort = key; config.direction = direction;
    api.changed();
  }
  function moveColumn(key, target) {
    const order = api.config().columnOrder;
    if (key === target || !order.includes(key) || !order.includes(target)) return;
    order.splice(order.indexOf(key), 1); order.splice(order.indexOf(target), 0, key);
    api.changed();
  }
  function setWidth(key, width, persist = true) {
    width = Math.max(100, Math.min(900, Math.round(width)));
    api.config().widths[key] = width;
    const col = [...root.querySelectorAll('col[data-column]')].find(el => el.dataset.column === key);
    if (col) col.style.width = width + 'px';
    const table = $(".memory-table");
    if (table) table.style.width = (40 + [...root.querySelectorAll("col[data-column]")].reduce((sum,col) => sum + (api.config().widths[col.dataset.column] || columns[col.dataset.column].width), 0)) + "px";
    if (persist) api.changed();
  }
  function columnFilters(key) {
    const config = api.config(), column = columns[key];
    if (column.field) return config[column.field].length;
    if (key === 'title' || key === 'location') return config[key + 'Query'] ? 1 : 0;
    if (key === 'updatedAt' || key === 'createdAt') return Number(Boolean(config[key + 'From'] || config[key + 'To']));
    return 0;
  }
  function menuOptions() {
    if (!menuColumn || !columns[menuColumn].field) return;
    const field = columns[menuColumn].field, config = api.config();
    const items = api.options(field).filter(item => api.normalize(item.label).includes(api.normalize(menuSearch)));
    const target = $('[data-filter-options]', menu);
    target.innerHTML = items.slice(0, optionLimit).map(item => '<label class="memory-check"><input type="checkbox" data-filter-value="' + esc(item.value) + '"' + (config[field].includes(item.value) ? ' checked' : '') + '><span>' + esc(item.label) + '</span><small>' + item.count + '</small></label>').join('') || '<p class="memory-muted">Aucune valeur</p>';
    if (items.length > optionLimit) target.innerHTML += '<button type="button" class="memory-button" data-more-options>Afficher plus (' + optionLimit + ' / ' + items.length + ')</button>';
    target.querySelectorAll('[data-filter-value]').forEach(input => input.addEventListener('change', () => {
      const value = input.dataset.filterValue;
      config[field] = input.checked ? [...new Set([...config[field], value])] : config[field].filter(item => item !== value);
      api.changed();
      [...menu.querySelectorAll('[data-filter-value]')].find(item => item.dataset.filterValue === value)?.focus();
    }));
    $('[data-more-options]', target)?.addEventListener('click', () => { optionLimit += 80; menuOptions(); });
  }
  function renderMenu() {
    if (!menuColumn) return;
    const key = menuColumn, config = api.config(), column = columns[key];
    const focused = menu.contains(document.activeElement) ? document.activeElement.dataset.filterInput : undefined;
    menu.setAttribute('aria-label', 'Trier et filtrer : ' + column.label);
    menu.innerHTML = '<strong>' + esc(column.label) + '</strong><div class="memory-column-sorts"><button class="memory-button" type="button" data-sort-direction="asc" aria-pressed="' + (config.sort === key && config.direction === 'asc') + '">↑ Croissant</button><button class="memory-button" type="button" data-sort-direction="desc" aria-pressed="' + (config.sort === key && config.direction === 'desc') + '">↓ Décroissant</button></div>';
    if (column.field) {
      menu.innerHTML += '<input class="control" type="search" data-filter-input="search" placeholder="Rechercher une valeur…" aria-label="Rechercher dans ' + esc(column.label) + '" value="' + esc(menuSearch) + '"><div data-filter-options class="memory-column-options"></div>';
    } else if (['updatedAt', 'createdAt'].includes(key)) {
      menu.innerHTML += '<label>À partir du<input type="date" data-filter-input="from" value="' + esc(config[key + 'From']) + '"></label><label>Jusqu’au<input type="date" data-filter-input="to" value="' + esc(config[key + 'To']) + '"></label><p class="memory-muted">Les dates inconnues restent en fin de tri et sont exclues lorsqu’une période est filtrée.</p>';
    } else {
      menu.innerHTML += '<form data-text-filter><label>Contient<input class="control" type="search" data-filter-input="query" value="' + esc(config[key + 'Query']) + '" placeholder="Rechercher dans cette colonne…"></label><button type="submit" class="memory-button">Appliquer</button></form>';
    }
    menu.innerHTML += '<button type="button" class="memory-button" data-clear-column>Effacer le filtre de cette colonne</button>';
    menu.querySelectorAll('[data-sort-direction]').forEach(button => button.addEventListener('click', () => setSort(key, button.dataset.sortDirection)));
    $('[data-filter-input="search"]', menu)?.addEventListener('input', event => { menuSearch = event.target.value; optionLimit = 80; menuOptions(); });
    $('[data-text-filter]', menu)?.addEventListener('submit', event => { event.preventDefault(); config[key + 'Query'] = $('[data-filter-input="query"]', menu).value; api.changed(); });
    for (const [input, suffix] of [['from', 'From'], ['to', 'To']]) $('[data-filter-input="' + input + '"]', menu)?.addEventListener('change', event => { config[key + suffix] = event.target.value; api.changed(); });
    $('[data-clear-column]', menu).addEventListener('click', () => {
      if (column.field) config[column.field] = [];
      else if (['updatedAt', 'createdAt'].includes(key)) { config[key + 'From'] = ''; config[key + 'To'] = ''; }
      else config[key + 'Query'] = '';
      api.changed();
    });
    menuOptions(); menu.hidden = false; positionMenu();
    if (focused) $('[data-filter-input="' + focused + '"]', menu)?.focus();
  }
  function openMenu(key) {
    if (menuColumn === key) return closeMenu(true);
    closeMenu();
    menuColumn = key; columnButton(key)?.setAttribute('aria-expanded','true'); menuSearch = ''; optionLimit = 80; renderMenu();
    $('input', menu)?.focus();
  }
  function renderColumns(target) {
    const config = api.config();
    target.innerHTML = config.columnOrder.map((key, i) => '<div class="memory-column-setting"><label><input type="checkbox" data-visible-column="' + key + '"' + (['title', 'open'].includes(key) || config.columns.includes(key) ? ' checked' : '') + (['title', 'open'].includes(key) ? ' disabled' : '') + '>' + columns[key].label + '</label><button class="memory-button" type="button" data-column-up="' + key + '" aria-label="Déplacer ' + columns[key].label + ' vers la gauche"' + (!i ? ' disabled' : '') + '>←</button><button class="memory-button" type="button" data-column-down="' + key + '" aria-label="Déplacer ' + columns[key].label + ' vers la droite"' + (i === config.columnOrder.length - 1 ? ' disabled' : '') + '>→</button></div>').join('');
    target.querySelectorAll('[data-visible-column]').forEach(input => input.addEventListener('change', () => {
      const key = input.dataset.visibleColumn;
      if (!input.checked && columnFilters(key)) { input.checked = true; return; }
      if (!input.checked && config.sort === key) { config.sort = "title"; config.direction = "asc"; }
      config.columns = input.checked ? [...config.columns, key] : config.columns.filter(value => value !== key);
      api.changed();
    }));
    for (const [attribute, delta] of [['up', -1], ['down', 1]]) target.querySelectorAll('[data-column-' + attribute + ']').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset[attribute === 'up' ? 'columnUp' : 'columnDown'], order = config.columnOrder, i = order.indexOf(key);
      [order[i], order[i + delta]] = [order[i + delta], order[i]]; api.changed();
    }));
    target.querySelectorAll('[data-visible-column]').forEach(input => {
      if (columnFilters(input.dataset.visibleColumn)) { input.disabled = true; input.parentElement.title = 'Effacer le filtre de la colonne avant de la masquer.'; }
    });
  }
  function compare(a, b) {
    const config = api.config(), left = api.value(a, config.sort), right = api.value(b, config.sort);
    const group = config.group === 'kind' ? api.label(a.kind).localeCompare(api.label(b.kind), 'fr') : 0;
    if (group) return group;
    if (!left !== !right) return left ? -1 : 1;
    return collator.compare(String(left), String(right)) * (config.direction === 'desc' ? -1 : 1) || a.id.localeCompare(b.id);
  }
  function cell(entry, key) {
    if (key === 'title') return '<button type="button" class="memory-title" data-select-title title="' + esc(entry.title) + '">' + esc(entry.title) + '</button>' + (entry.representations?.length > 1 ? '<span class="memory-representations" title="Même fichier : ' + esc(entry.representations.map(item => item.title).join(' · ')) + '">' + entry.representations.length + ' représentations</span>' : '');
    if (key === 'kind') return (entry.kinds || [entry.kind]).map(kind => '<span class="memory-kind">' + esc(api.label(kind)) + '</span>').join(' ');
    if (key === 'labels') return '<span title="' + esc(entry.labels.join(' · ')) + '">' + esc(entry.labels.join(' · ') || '—') + '</span>';
    if (key === 'createdAt' || key === 'updatedAt') return entry[key] && Number.isFinite(Date.parse(entry[key])) ? '<time datetime="' + esc(entry[key]) + '" title="' + esc(entry[key]) + '">' + esc(new Date(entry[key]).toLocaleDateString('fr-FR')) + '</time>' : '<span class="memory-muted">—</span>';
    if (key === 'open') {
      const actions = [];
      if (entry.file) actions.push('<button type="button" class="memory-button" data-memory-action="file">↗ ' + (/\.(md|markdown)$/i.test(entry.file) ? 'Markdown' : 'Fichier') + '</button>');
      if (entry.url) actions.push('<button type="button" class="memory-button" data-memory-action="url">↗ Source</button>');
      if (entry.taskId || entry.noteId || entry.detailRef || entry.nodeId) actions.push('<button type="button" class="memory-button" data-memory-action="inspect">' + (entry.taskId ? 'Tâche' : entry.noteId ? 'Note' : 'Fiche') + '</button>');
      return actions.length ? '<div class="memory-row-actions">' + actions.join('') + '</div>' : '<span class="memory-muted">Aucun document lié</span>';
    }
    return '<span title="' + esc(api.value(entry, key)) + '">' + esc(api.value(entry, key) || '—') + '</span>';
  }
  function render() {
    const config = api.config(), entries = api.entries();
    const nextFingerprint = JSON.stringify([api.query(), config]); if (fingerprint !== nextFingerprint) { page = 1; fingerprint = nextFingerprint; }
    const filtered = entries.filter(entry => api.matches(entry)).sort(compare);
    const pages = Math.max(1, Math.ceil(filtered.length / 80)); page = Math.min(page, pages);
    visible = filtered.slice((page - 1) * 80, page * 80);
    const keys = config.columnOrder.filter(key => ['title', 'open'].includes(key) || config.columns.includes(key) || columnFilters(key));
    const tableWidth = 40 + keys.reduce((sum,key) => sum + (config.widths[key] || columns[key].width), 0);
    const oldScroll = $('.memory-table-scroll'); const scroll = oldScroll ? { top: oldScroll.scrollTop, left: oldScroll.scrollLeft } : { top: 0, left: 0 };
    let previousGroup;
    const rows = visible.map(entry => {
      const group = config.group === 'kind' && entry.kind !== previousGroup ? '<tr class="memory-group-row"><th colspan="' + (keys.length + 1) + '" scope="rowgroup">' + esc(api.label(entry.kind)) + '</th></tr>' : ''; previousGroup = entry.kind;
      return group + '<tr class="memory-row" data-memory-id="' + esc(entry.id) + '"><td class="memory-select-cell"><input type="checkbox" data-row-select aria-label="Sélectionner ' + esc(entry.title) + '"></td>' + keys.map(key => '<td data-column="' + key + '">' + cell(entry, key) + '</td>').join('') + '</tr>';
    }).join('');
    root.innerHTML = '<div class="memory-results-heading"><span role="status">' + filtered.length + ' résultat' + (filtered.length > 1 ? 's' : '') + ' / ' + entries.length + '</span><span id="memorySelectedCount" aria-live="polite"></span><button type="button" class="memory-button" id="memoryClearSelection" hidden>Effacer la sélection</button></div><div class="memory-table-scroll"><table class="memory-table" style="width:' + tableWidth + 'px"><caption class="sr-only">Tableau de la mémoire — tri et filtres dans les colonnes</caption><colgroup><col style="width:40px">' + keys.map(key => '<col data-column="' + key + '" style="width:' + (config.widths[key] || columns[key].width) + 'px">').join('') + '</colgroup><thead><tr><th class="memory-select-cell"><input id="memorySelectPage" type="checkbox" aria-label="Sélectionner cette page de résultats"></th>' + keys.map(key => '<th scope="col" data-header-column="' + key + '"' + (key !== 'open' ? ' aria-sort="' + (config.sort !== key ? 'none' : config.direction === 'asc' ? 'ascending' : 'descending') + '"' : '') + '><div class="memory-column-heading"><button type="button" draggable="true" class="memory-column-title" data-sort-column="' + key + '" title="' + (key === 'open' ? 'Actions disponibles' : 'Trier par ' + columns[key].label) + '">' + columns[key].label + (config.sort === key ? config.direction === 'asc' ? ' ↑' : ' ↓' : '') + '</button>' + (key !== 'open' ? '<button type="button" class="memory-filter-button' + (columnFilters(key) ? ' filtered' : '') + '" data-column-menu="' + key + '" aria-label="Filtrer ' + columns[key].label + '" aria-haspopup="dialog" aria-expanded="' + (menuColumn === key) + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L9 9v4l-2-1V9Z"/></svg>' + (columnFilters(key) ? '<span>' + columnFilters(key) + '</span>' : '') + '</button>' : '') + '</div><span class="memory-column-resize" role="separator" aria-orientation="vertical" aria-label="Largeur de ' + columns[key].label + '" aria-valuemin="100" aria-valuemax="900" aria-valuenow="' + (config.widths[key] || columns[key].width) + '" tabindex="0" data-resize-column="' + key + '"></span></th>').join('') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + (keys.length + 1) + '" class="memory-empty">Aucun résultat. Modifie la recherche ou les filtres des colonnes.</td></tr>') + '</tbody></table></div><nav class="memory-pagination" aria-label="Pages de résultats"><button type="button" class="memory-button" data-page="-1"' + (page === 1 ? ' disabled' : '') + '>Précédent</button><span>' + page + ' / ' + pages + '</span><button type="button" class="memory-button" data-page="1"' + (page === pages ? ' disabled' : '') + '>Suivant</button></nav>';
    $('.memory-table-scroll').scrollTop = scroll.top; $('.memory-table-scroll').scrollLeft = scroll.left;
    $('.memory-table-scroll').addEventListener('scroll', () => { if (!menu.hidden) positionMenu(); }, { passive: true });
    root.querySelectorAll('[data-sort-column]').forEach(button => {
      const key = button.dataset.sortColumn;
      if (key !== 'open') button.addEventListener('click', () => setSort(key, config.sort === key && config.direction === 'asc' ? 'desc' : 'asc'));
      button.addEventListener('dragstart', event => { dragColumn = key; event.dataTransfer?.setData('application/x-oneagent-column', key); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; });
      button.addEventListener('dragend', () => { dragColumn = undefined; });
    });
    root.querySelectorAll('[data-header-column]').forEach(th => {
      th.addEventListener('dragover', event => { if (dragColumn) event.preventDefault(); });
      th.addEventListener('drop', event => { if (!dragColumn) return; event.preventDefault(); moveColumn(dragColumn, th.dataset.headerColumn); dragColumn = undefined; });
    });
    root.querySelectorAll('[data-column-menu]').forEach(button => button.addEventListener('click', () => openMenu(button.dataset.columnMenu)));
    root.querySelectorAll('[data-resize-column]').forEach(handle => {
      const key = handle.dataset.resizeColumn;
      handle.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setWidth(key, (config.widths[key] || columns[key].width) + (event.key === 'ArrowRight' ? 16 : -16)); [...root.querySelectorAll('[data-resize-column]')].find(el => el.dataset.resizeColumn === key)?.focus(); } });
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return; event.preventDefault();
        const start = event.clientX, width = config.widths[key] || columns[key].width;
        const move = event => setWidth(key, width + event.clientX - start, false);
        const end = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); api.changed(); };
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
      });
    });
    const byId = new Map(visible.map(entry => [entry.id, entry]));
    root.querySelectorAll('[data-memory-id]').forEach(row => {
      const entry = byId.get(row.dataset.memoryId);
      row.addEventListener('click', event => { if (event.target.closest('[data-memory-action], input')) return; select(entry, event.metaKey || event.ctrlKey); });
      $('[data-row-select]', row).addEventListener('change', () => select(entry, true));
      row.querySelectorAll('[data-memory-action]').forEach(button => button.addEventListener('click', () => { if (!selected.has(entry.id)) selected.add(entry.id); updateSelection(); api.open(entry, button.dataset.memoryAction); }));
    });
    $('#memorySelectPage').addEventListener('change', event => { visible.forEach(entry => event.target.checked ? selected.add(entry.id) : selected.delete(entry.id)); updateSelection(); });
    $('#memoryClearSelection').addEventListener('click', () => { selected.clear(); updateSelection(); });
    root.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { page += Number(button.dataset.page); closeMenu(); render(); $('.memory-table-scroll').scrollTop = 0; $('.memory-title')?.focus(); }));
    updateSelection(); if (menuColumn) renderMenu();
  }
  return { render, renderColumns, closeMenu, reset() { page = 1; selected.clear(); closeMenu(); } };
}
module.exports = { createMemoryTable };
