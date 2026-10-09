// Shared column layout for Memory and Priorities, including their standalone canvas.
function createTableColumns(api) {
  const { columns, required = ['title'], root } = api;
  const keys = Object.keys(columns), bound = new WeakSet();
  let dragColumn;
  const normalize = value => {
    const v = value && typeof value === 'object' ? value : {};
    const known = list => Array.isArray(list) ? [...new Set(list.filter(key => keys.includes(key)))] : [];
    const order = [...new Set([...known(v.columnOrder), ...keys])];
    const visible = Array.isArray(v.columns) ? known(v.columns) : [...(api.defaults || keys)];
    const widths = {};
    for (const key of keys) if (Number.isFinite(v.widths?.[key])) widths[key] = Math.max(columns[key].minWidth || 100, Math.min(900, Math.round(v.widths[key])));
    return { columns: visible.filter(key => !required.includes(key)), columnOrder: order, widths };
  };
  const visible = () => api.config().columnOrder.filter(key => required.includes(key) || api.config().columns.includes(key) || api.isFiltered?.(key));
  const width = key => api.config().widths[key] || columns[key].width;
  const disabled = () => Boolean(api.disabled?.());
  function setWidth(key, size, persist = true) {
    if (disabled()) return;
    api.config().widths[key] = Math.max(columns[key].minWidth || 100, Math.min(900, Math.round(size)));
    const table = root.querySelector('.memory-table');
    const col = [...root.querySelectorAll('col[data-column]')].find(col => col.dataset.column === key);
    if (col) col.style.width = width(key) + 'px';
    const handle = [...root.querySelectorAll('[data-resize-column]')].find(handle => handle.dataset.resizeColumn === key);
    handle?.setAttribute('aria-valuenow', String(width(key)));
    if (table) table.style.width = ((api.leadingWidth || 0) + visible().reduce((sum,key) => sum + width(key),0)) + 'px';
    if (persist) api.changed();
  }
  function bind(table) {
    table.querySelectorAll('[data-sort-column]').forEach(button => {
      if (bound.has(button)) return; bound.add(button);
      button.draggable = true;
      button.addEventListener('dragstart', event => {
        if (disabled()) { event.preventDefault(); return; }
        dragColumn = button.dataset.sortColumn; event.dataTransfer?.setData('application/x-oneagent-column', dragColumn);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      button.addEventListener('dragend', () => { dragColumn = undefined; });
    });
    table.querySelectorAll('[data-header-column]').forEach(th => {
      if (bound.has(th)) return; bound.add(th);
      th.addEventListener('dragover', event => { if (dragColumn && !disabled()) event.preventDefault(); });
      th.addEventListener('drop', event => {
        if (!dragColumn || disabled()) return; event.preventDefault();
        const key = dragColumn, target = th.dataset.headerColumn, order = api.config().columnOrder; dragColumn = undefined;
        if (key === target || !order.includes(key) || !order.includes(target)) return;
        order.splice(order.indexOf(key),1); order.splice(order.indexOf(target),0,key); api.changed();
      });
    });
    table.querySelectorAll('[data-resize-column]').forEach(handle => {
      if (bound.has(handle)) return; bound.add(handle);
      const key = handle.dataset.resizeColumn;
      handle.addEventListener('keydown', event => {
        if (disabled() || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault(); setWidth(key,width(key)+(event.key==='ArrowRight'?16:-16));
        [...root.querySelectorAll('[data-resize-column]')].find(el=>el.dataset.resizeColumn===key)?.focus();
      });
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || disabled()) return; event.preventDefault();
        const start = event.clientX, initial = width(key), config = api.config();
        const move = event => { if (api.config() === config) setWidth(key,initial+event.clientX-start,false); };
        const end = () => { document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',end); document.removeEventListener('pointercancel',end); if (api.config() === config) api.changed(); };
        document.addEventListener('pointermove',move); document.addEventListener('pointerup',end); document.addEventListener('pointercancel',end);
      });
    });
  }
  function renderSettings(target) {
    const config = api.config(); target.replaceChildren();
    for (const [i,key] of config.columnOrder.entries()) {
      const row = document.createElement('div'); row.className = 'memory-column-setting';
      const label = document.createElement('label'), input = document.createElement('input'); input.type='checkbox'; input.dataset.visibleColumn=key;
      input.checked=required.includes(key)||config.columns.includes(key)||Boolean(api.isFiltered?.(key));
      input.disabled=disabled()||required.includes(key)||Boolean(api.isFiltered?.(key));
      if (api.isFiltered?.(key)) label.title='Effacer le filtre de la colonne avant de la masquer.';
      label.append(input,document.createTextNode(columns[key].label)); row.append(label);
      input.addEventListener('change',()=>{
        if (disabled()) return;
        config.columns=input.checked?[...new Set([...config.columns,key])]:config.columns.filter(value=>value!==key);
        if (!input.checked) api.onHide?.(key); api.changed();
      });
      for (const [direction,delta,text] of [['up',-1,'←'],['down',1,'→']]) {
        const button=document.createElement('button'); button.type='button'; button.className='memory-button';button.textContent=text;
        button.dataset[direction==='up'?'columnUp':'columnDown']=key;
        button.setAttribute('aria-label','Déplacer '+columns[key].label+(delta<0?' vers la gauche':' vers la droite'));
        button.disabled=disabled()||i+delta<0||i+delta>=config.columnOrder.length;
        button.addEventListener('click',()=>{if(disabled())return; const index=config.columnOrder.indexOf(key), order=config.columnOrder;[order[index],order[index+delta]]=[order[index+delta],order[index]];api.changed();}); row.append(button);
      }
      target.append(row);
    }
  }
  return { normalize, visible, width, bind, renderSettings };
}
if (typeof module !== 'undefined') module.exports = { createTableColumns };
