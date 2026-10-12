// Shared by the VS Code webview and the Copilot cockpit.
function createInboxReviewWindow({ document, draftState, discardDraft, onClose }) {
  const dialog = document.querySelector('#inboxReviewDialog');
  const body = document.querySelector('#inboxDetail');
  const notice = document.querySelector('#inboxCloseNotice');
  const discard = document.querySelector('#inboxDiscardClose');
  let currentKey, returnTo;
  const controls = () => [...body.querySelectorAll('input, textarea, select')]
    .filter(el => !el.disabled && !el.readOnly && !el.matches('[data-document-content], [data-observation-selected]'));
  function dirty(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return el.value !== ([...el.options].find(option => option.defaultSelected) || el.options[0])?.value;
    return el.value !== el.defaultValue;
  }
  function controlKey(el) {
    if (el.id) return el.id;
    const attr = [...el.attributes].find(attr => attr.name.startsWith('data-'));
    return attr ? [el.closest('[data-observation-review]')?.dataset.observationReview || '', attr.name, attr.value].join(':') : undefined;
  }
  const changed = () => draftState().dirty || controls().some(dirty);
  function resetNotice() { notice.textContent = ''; discard.hidden = true; }
  function warn() {
    const busy = draftState().busy;
    notice.textContent = busy ? 'Enregistrement en cours. Attendez sa confirmation avant de fermer.' : 'Des modifications ne sont pas enregistrées. Enregistrez-les ou abandonnez-les avant de fermer.';
    discard.hidden = busy;
  }
  function finish() {
    const target = returnTo;
    currentKey = undefined;
    resetNotice();
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    body.replaceChildren();
    onClose();
    // Cards may have been replaced by a background refresh.
    const trigger = [...document.querySelectorAll('[data-inspect], [data-open-curation-package]')]
      .find(el => el.dataset.inspect === target?.id && target?.kind === 'item' || el.dataset.openCurationPackage === target?.id && target?.kind === 'package');
    (trigger || document.querySelector('[data-view="inbox"]'))?.focus();
  }
  function requestClose() {
    if (draftState().busy || changed()) { warn(); return; }
    finish();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  document.querySelector('#inboxCloseReview').addEventListener('click', requestClose);
  discard.addEventListener('click', () => {
    if (draftState().busy) { warn(); return; }
    discardDraft();
    finish();
  });
  return {
    open(key, target) {
      if (dialog.open && currentKey !== key && (draftState().busy || changed())) { warn(); return false; }
      if (currentKey !== key) body.replaceChildren();
      currentKey = key;
      returnTo = target;
      resetNotice();
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        document.querySelector('#inboxCloseReview').focus();
      }
      return true;
    },
    render(draw) {
      if (!dialog.open) return;
      const edited = new Map(controls().filter(dirty).map(el => [controlKey(el), { value: el.value, checked: el.checked }]).filter(([key]) => key));
      const focused = document.activeElement;
      const focusKey = body.contains(focused) ? controlKey(focused) : undefined;
      const selection = focused?.selectionStart == null ? undefined : [focused.selectionStart, focused.selectionEnd];
      const scroll = body.scrollTop;
      const expanded = [...body.querySelectorAll('details')].map(el => el.open);
      draw();
      for (const el of controls()) {
        const saved = edited.get(controlKey(el));
        if (saved) { el.value = saved.value; if ('checked' in el) el.checked = saved.checked; }
      }
      [...body.querySelectorAll('details')].forEach((el, i) => { if (expanded[i] !== undefined) el.open = expanded[i]; });
      body.scrollTop = scroll;
      if (focusKey) {
        const el = [...body.querySelectorAll('input, textarea, select, button')].find(el => controlKey(el) === focusKey);
        el?.focus({ preventScroll: true });
        if (selection && el?.setSelectionRange && ['textarea', 'input'].includes(el.tagName.toLowerCase())) {
          try { el.setSelectionRange(...selection); } catch { /* Some input types do not expose a text selection. */ }
        }
      }
      if (!changed() && !draftState().busy) resetNotice();
    }
  };
}

module.exports = { createInboxReviewWindow };
