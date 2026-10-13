// One on-demand detail surface for tasks, notes, memory and runtime actions.
function createDetailWindows({ document, onClose }) {
  const dialog = document.querySelector('#detailWindow');
  const notice = document.querySelector('#detailWindowNotice');
  const discard = document.querySelector('#detailWindowDiscard');
  const close = document.querySelector('#detailWindowClose');
  const panes = Object.fromEntries([...dialog.querySelectorAll('[data-detail-pane]')].map(el => [el.dataset.detailPane, el]));
  let kind, key, origin, baseline = new Map(), pending, sequence = 0, lockedFields = new Map();
  function unlock() { for (const [el, disabled] of lockedFields) if (el.isConnected) el.disabled = disabled; lockedFields.clear(); }
  const value = el => ['checkbox', 'radio'].includes(el.type) ? el.checked : el.value;
  const fields = () => kind ? [...panes[kind].querySelectorAll('input, textarea, select')].filter(el => !el.readOnly && !el.matches('[type="search"], [data-task-link-search], [data-task-link-kind-search]')) : [];
  const dirty = () => fields().some(el => baseline.has(el) && baseline.get(el) !== value(el));
  function clean() { baseline = new Map(fields().map(el => [el, value(el)])); notice.textContent = ''; discard.hidden = true; }
  function warn() {
    notice.textContent = pending ? 'Enregistrement en cours. Attendez sa confirmation avant de fermer.' : 'Des modifications ne sont pas enregistrées. Enregistrez-les ou abandonnez-les avant de fermer.';
    discard.hidden = !!pending;
  }
  function finish() {
    const previous = kind, previousKey = key, trigger = origin;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    kind = key = undefined; baseline.clear(); notice.textContent = ''; discard.hidden = true;
    onClose(previous);
    const attribute = previous === 'tasks' ? 'data-task' : previous === 'notes' ? 'data-note-id' : undefined;
    const replacement = attribute && [...document.querySelectorAll('[' + attribute + ']')].find(el => el.getAttribute(attribute) === previousKey);
    (trigger?.isConnected ? trigger : replacement || document.querySelector('[data-view="' + previous + '"]'))?.focus();
  }
  function requestClose() {
    if (pending || dirty()) { warn(); return false; }
    finish(); return true;
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  close.addEventListener('click', requestClose);
  discard.addEventListener('click', () => { if (pending) warn(); else finish(); });
  return {
    open(nextKind, nextKey, title) {
      if (dialog.open && (nextKind !== kind || nextKey !== key)) {
        if (!requestClose()) return false;
      }
      if (!dialog.open) {
        origin = document.activeElement; kind = nextKind; key = nextKey;
        for (const [name, pane] of Object.entries(panes)) pane.hidden = name !== kind;
        document.querySelector('#detailWindowTitle').textContent = title;
        if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
        clean(); close.focus();
      }
      return true;
    },
    isOpen: name => dialog.open && kind === name,
    dirty: name => dialog.open && kind === name && dirty(),
    busy: name => dialog.open && kind === name && !!pending,
    render(name, draw, force = false) {
      if (!dialog.open || kind !== name || (!force && (dirty() || pending))) return;
      draw(); clean();
    },
    markClean(name) { if (kind === name) clean(); },
    requestClose,
    submit(message, post) {
      if (pending || !dialog.open) return;
      const requestId = 'editor-' + (++sequence);
      pending = { requestId, kind, timer: setTimeout(() => {
        pending = undefined; unlock();
        notice.textContent = 'Enregistrement non confirmé. Vos modifications sont conservées ; vérifiez leur état avant de réessayer.';
      }, 120000) };
      lockedFields = new Map([...panes[kind].querySelectorAll('input, textarea, select, button')].map(el => [el, el.disabled]));
      for (const el of lockedFields.keys()) el.disabled = true;
      notice.textContent = 'Enregistrement…'; discard.hidden = true;
      post({ ...message, editorRequestId: requestId });
    },
    receive(message) {
      if (!pending || message?.type !== 'editorResult' || message.requestId !== pending?.requestId) return false;
      clearTimeout(pending.timer); pending = undefined; unlock();
      if (message.error) { notice.textContent = message.error + ' Vos modifications sont conservées.'; discard.hidden = true; }
      else finish();
      return true;
    }
  };
}

module.exports = { createDetailWindows };
