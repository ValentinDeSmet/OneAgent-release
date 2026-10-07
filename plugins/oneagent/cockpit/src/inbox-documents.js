// Kept in the shared cockpit so Copilot and VS Code review the same draft.
function createDocumentReview({ postMessage, render, format, escape, schedule = setTimeout, cancel = clearTimeout }) {
  const drafts = new Map();
  let sequence = 0;
  const isDocument = (item) => item?.type === "wiki_proposal" && ["markdown_document_review", "wiki_write_review"].includes(item.payload?.proposalKind);
  function draft(item) {
    let value = drafts.get(item.id);
    if (!value || (!value.dirty && !value.busy)) {
      value = { ...value, content: String(item.payload?.content || ""), revision: item.revision, dirty: false, busy: false };
      drafts.set(item.id, value);
    }
    return value;
  }
  function markup(item) {
    if (!isDocument(item)) return null;
    const value = draft(item);
    const editable = item.status === "pending" && item.documentEditable === true && !!item.revision;
    const content = editable ? value.content : String(item.payload?.content || "");
    const stale = editable && value.revision !== item.revision;
    return '<section class="field inbox-document"><label>Document proposé</label>' +
      '<p class="summary">Le Markdown sera publié dans la mémoire privée après votre acceptation.</p>' +
      (editable ? '<div class="detail-actions"><button class="action" data-document-preview aria-pressed="' + (value.editing ? 'false' : 'true') + '">Aperçu</button><button class="action" data-document-edit aria-pressed="' + (value.editing ? 'true' : 'false') + '">Modifier</button></div>' : '') +
      (editable && value.editing ? '<textarea data-document-content maxlength="100000" aria-label="Contenu Markdown du document"' + (value.busy ? ' disabled' : '') + '>' + escape(content) + '</textarea><div class="detail-actions"><button class="action" data-document-save' + (!value.dirty || value.busy || stale ? ' disabled' : '') + '>' + (value.busy ? 'Enregistrement…' : 'Enregistrer les modifications') + '</button><button class="action" data-document-reset' + (value.busy ? ' disabled' : '') + '>Annuler les modifications</button></div>' : '<div class="help-doc">' + format(content) + '</div>') +
      '<p class="summary" data-document-status role="status">' + escape(value.error || (stale ? 'La proposition a changé. Copiez vos modifications, puis rechargez la version actuelle avant de les enregistrer.' : value.dirty ? 'Modifications non enregistrées. Enregistrez-les avant de valider le document.' : !editable && item.status === 'pending' ? 'L’accès complet au document est nécessaire pour le modifier ou l’accepter.' : '')) + '</p></section>';
  }
  function bind(root, item) {
    if (!isDocument(item) || item.documentEditable !== true || item.status !== "pending") return;
    const value = draft(item);
    root.querySelector('[data-document-content]')?.addEventListener('input', (event) => {
      value.content = event.target.value;
      value.dirty = value.content !== String(item.payload?.content || "");
      value.error = "";
      const button = root.querySelector('[data-document-save]');
      if (button) button.disabled = !value.dirty || value.busy || value.revision !== item.revision;
      const status = root.querySelector('[data-document-status]');
      if (status) status.textContent = value.dirty ? 'Modifications non enregistrées. Enregistrez-les avant de valider le document.' : '';
    });
    root.querySelector('[data-document-edit]')?.addEventListener('click', () => { value.editing = true; render(); });
    root.querySelector('[data-document-preview]')?.addEventListener('click', () => { value.editing = false; render(); });
    root.querySelector('[data-document-reset]')?.addEventListener('click', () => { if (value.busy) return; drafts.delete(item.id); render(); });
    root.querySelector('[data-document-save]')?.addEventListener('click', () => {
      if (!value.dirty || value.busy || value.revision !== item.revision || !value.content.trim()) return;
      value.busy = true;
      value.error = "";
      value.requestId = 'document-' + (++sequence);
      value.timer = schedule(() => {
        value.busy = false;
        value.error = 'Enregistrement non confirmé. Actualisez la proposition avant de réessayer ; vos modifications sont conservées.';
        value.requestId = undefined;
        render();
      }, 120000);
      postMessage({ type: 'reviseInboxDocument', id: item.id, revision: value.revision, content: value.content, requestId: value.requestId });
      render();
    });
  }
  function receive(message) {
    if (!['inboxDocumentSaved', 'inboxDocumentSaveFailed'].includes(message?.type)) return false;
    const value = drafts.get(message.id);
    if (!value || message.requestId !== value.requestId) return false;
    cancel(value.timer);
    value.busy = false;
    value.requestId = undefined;
    if (message.type === 'inboxDocumentSaved') {
      const item = message.payload?.item;
      if (!isDocument(item) || !item.revision || item.documentEditable !== true) {
        value.error = 'La version enregistrée n’a pas pu être confirmée. Actualisez la proposition ; vos modifications sont conservées.';
      } else {
        value.content = item.payload.content;
        value.revision = item.revision;
        value.dirty = false;
        value.error = '';
      }
    } else value.error = String(message.error || 'Enregistrement impossible. Vos modifications sont conservées.');
    return true;
  }
  function allowAction(type, item) {
    if (!isDocument(item)) return true;
    const value = draft(item);
    if (value.dirty || value.busy) value.error = 'Enregistrez ou annulez vos modifications avant de poursuivre.';
    else if (type === 'acceptInbox' && item.documentEditable !== true) value.error = 'L’accès complet au document est nécessaire pour l’accepter.';
    else return true;
    render();
    return false;
  }
  return { render: markup, bind, receive, allowAction, revision: (item) => isDocument(item) ? draft(item).revision : undefined };
}

function documentReviewBootstrap() {
  return 'const documentReview = (' + createDocumentReview.toString() + ')({ postMessage: (message) => vscode?.postMessage(message), render: renderInboxDetail, format: mdToHtml, escape: escapeHtml });';
}

module.exports = { createDocumentReview, documentReviewBootstrap };
