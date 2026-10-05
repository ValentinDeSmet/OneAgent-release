const token = document.querySelector('meta[name="oneagent-token"]').content;
const { renderMarkdown } = await import(`./markdown.bundle.mjs?token=${encodeURIComponent(token)}`);
const byId = (id) => document.getElementById(id);
let snapshot, editing = false, saving = false;
const status = (message, error = false) => { byId("status").textContent = message; byId("status").dataset.error = String(error); };
const api = async (route, value) => {
  const response = await fetch(`/api/${route}`, { method: value ? "POST" : "GET", headers: { "X-OneAgent-Token": token, ...(value ? { "Content-Type": "application/json" } : {}) }, ...(value ? { body: JSON.stringify(value) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "La demande a échoué."); return result;
};
const dirty = () => snapshot && byId("source").value !== snapshot.content;
const show = (edit) => {
  editing = edit;
  byId("read").setAttribute("aria-pressed", String(!edit)); byId("edit").setAttribute("aria-pressed", String(edit));
  byId("source").hidden = !edit; byId("preview").hidden = edit; byId("save").hidden = !edit;
  if (!edit) {
    const content = byId("source").value;
    if (snapshot.markdown) byId("preview").innerHTML = renderMarkdown(content);
    else { const code = document.createElement("pre"); code.textContent = content; byId("preview").replaceChildren(code); }
  }
};
const refresh = async () => {
  if (saving) return;
  if (dirty()) { status("Brouillon conservé. Enregistrez vos modifications avant d’actualiser.", true); return; }
  try {
    snapshot = await api("document"); byId("title").textContent = snapshot.title; byId("path").textContent = snapshot.file;
    byId("source").value = snapshot.content; byId("edit").hidden = !snapshot.editable; show(editing && snapshot.editable); status("");
  } catch (error) { status(error.message, true); }
};
byId("read").addEventListener("click", () => { if (snapshot) show(false); });
byId("edit").addEventListener("click", () => { if (snapshot?.editable) show(true); });
byId("refresh").addEventListener("click", refresh);
byId("source").addEventListener("input", () => status(dirty() ? "Modifications non enregistrées" : ""));
byId("save").addEventListener("click", async () => {
  if (saving || !snapshot?.editable) return;
  saving = true; byId("save").disabled = true; byId("source").readOnly = true;
  const content = byId("source").value;
  try {
    const result = await api("save", { revision: snapshot.revision, content });
    snapshot = { ...snapshot, content, revision: result.revision }; status("Fichier enregistré.");
  } catch (error) { status(error.message + " Le brouillon est conservé ; l’enregistrement n’est pas relancé automatiquement.", true); }
  finally { saving = false; byId("save").disabled = false; byId("source").readOnly = false; }
});
byId("preview").addEventListener("click", async (event) => {
  const link = event.target.closest("a"); if (!link) return;
  const href = link.getAttribute("href");
  if (href.startsWith("#")) return;
  event.preventDefault();
  if (/^https?:\/\//i.test(href)) { window.open(href, "_blank", "noopener,noreferrer"); return; }
  try { await api("open", { href }); } catch (error) { status(error.message, true); }
});
window.addEventListener("beforeunload", (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } });
await refresh();
