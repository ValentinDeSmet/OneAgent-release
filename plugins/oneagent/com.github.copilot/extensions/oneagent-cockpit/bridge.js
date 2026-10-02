(() => {
  "use strict";
  const token = document.querySelector('meta[name="oneagent-token"]').content;
  const api = async (route, input = {}) => {
    const response = await fetch(`/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json", "X-OneAgent-Token": token }, body: JSON.stringify(input) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "La demande a échoué.");
    return value;
  };
  let viewState, connected = false, ready = false;
  const queued = [], dialogs = new Map();
  const element = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
  const banner = (message, error = false) => {
    if (!ready) { queued.push({ type: "host", kind: "notice", message, level: error ? "error" : "info" }); return; }
    const target = document.getElementById("oneagent-host-status");
    target.textContent = message; target.hidden = !message; target.dataset.error = String(error);
  };
  const post = (value) => api("message", value).catch((error) => {
    banner(`${error.message} Vérifier l’état de la mémoire avant de réessayer une écriture.`, true);
    if (["createManualNote", "updateManualNote"].includes(value.type)) window.dispatchEvent(new MessageEvent("message", { data: { type: "manualNoteSaveFailed" } }));
  });
  window.acquireVsCodeApi = () => ({ postMessage: post, getState: () => viewState, setState: (value) => { viewState = value; return value; } });
  const modal = (title) => {
    const dialog = element("dialog", undefined, "oneagent-host-dialog");
    const heading = element("h2", title), content = element("div"), actions = element("div", undefined, "oneagent-host-actions");
    dialog.setAttribute("aria-label", title);
    dialog.append(heading, content, actions); document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove()); dialog.showModal();
    return { dialog, content, actions };
  };
  const button = (text, action) => { const item = element("button", text); item.type = "button"; item.addEventListener("click", action); return item; };
  async function handle(message) {
    if (!ready) { queued.push(message); return; }
    if (message.type !== "host") { window.dispatchEvent(new MessageEvent("message", { data: message })); return; }
    if (message.kind === "dialog") {
      if (dialogs.has(message.id)) return;
      const { dialog, content, actions } = modal(message.title);
      dialogs.set(message.id, dialog);
      if (message.detail) content.append(element("p", message.detail));
      const error = element("p", message.error || "", "oneagent-host-error"); content.append(error);
      const respond = async (value) => {
        for (const item of dialog.querySelectorAll("button")) item.disabled = true;
        try { await api("answer", { id: message.id, value }); dialogs.delete(message.id); dialog.close(); }
        catch (failure) { error.textContent = failure.message; for (const item of dialog.querySelectorAll("button")) item.disabled = false; }
      };
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); void respond(null); });
      if (message.mode === "input") {
        const form = element("form"), input = element("input");
        input.type = message.password ? "password" : "text"; input.value = message.value || ""; input.placeholder = message.placeholder || "";
        input.setAttribute("aria-label", message.title); input.autocomplete = "off";
        form.append(input); content.append(form);
        form.addEventListener("submit", (event) => { event.preventDefault(); void respond(input.value); });
        actions.append(button("Valider", () => respond(input.value))); input.focus(); input.select();
      } else if (message.mode === "multiple") {
        const inputs = message.choices.map((choice, index) => { const label = element("label"), input = element("input"); input.type = "checkbox"; input.checked = message.picked?.includes(index); label.append(input, document.createTextNode(choice)); content.append(label); return input; });
        actions.append(button("Valider", () => respond(inputs.flatMap((input, index) => input.checked ? [index] : []))));
      } else {
        const search = element("input"); search.type = "search"; search.placeholder = "Filtrer les choix…"; search.setAttribute("aria-label", "Filtrer les choix");
        const choices = message.choices.map((choice, index) => button(choice, () => respond(index)));
        if (choices.length > 8) { content.append(search); search.addEventListener("input", () => choices.forEach((item) => { item.hidden = !item.textContent.toLowerCase().includes(search.value.toLowerCase()); })); }
        const list = element("div", undefined, "oneagent-host-choices"); list.append(...choices); content.append(list);
      }
      actions.append(button("Annuler", () => respond(null))); return;
    }
    if (message.kind === "dismiss") { dialogs.get(message.id)?.close(); dialogs.delete(message.id); return; }
    if (message.kind === "document") {
      const { dialog, content, actions } = modal(message.title);
      if (message.html) {
        const frame = element("iframe"); frame.setAttribute("sandbox", ""); frame.title = message.title;
        frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${message.html}`;
        content.append(frame);
      } else {
        const text = element("textarea"); text.value = message.content; text.readOnly = !message.editable; text.setAttribute("aria-label", message.title); content.append(text);
        if (message.editable) {
          const save = button("Enregistrer", async () => {
            save.disabled = true;
            try { const result = await api("document", { file: message.file, revision: message.revision, content: text.value }); message.revision = result.revision; banner("Fichier enregistré."); }
            catch (error) { banner(error.message, true); }
            finally { save.disabled = false; }
          }); actions.append(save);
        }
      }
      actions.append(button("Fermer", () => dialog.close())); return;
    }
    if (message.kind === "link") {
      const url = new URL(message.url);
      if (!["http:", "https:"].includes(url.protocol)) return;
      const { dialog, content, actions } = modal("Ouvrir le lien");
      const link = element("a", url.href); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; content.append(link);
      actions.append(button("Fermer", () => dialog.close())); return;
    }
    if (message.kind === "focus") { window.focus(); return; }
    banner(message.message || "", message.level === "error");
  }
  const events = new EventSource(`/events?token=${token}`);
  events.onmessage = (event) => { try { void handle(JSON.parse(event.data)); } catch { banner("Réponse OneAgent illisible.", true); } };
  events.onopen = () => { if (connected) banner("Connexion rétablie. Actualiser pour vérifier les dernières modifications."); connected = true; };
  events.onerror = () => banner("Connexion au plugin interrompue. Les écritures ne sont pas relancées automatiquement.", true);
  window.addEventListener("pagehide", () => events.close());
  async function onboard() {
    const root = document.getElementById("onboarding");
    if (!root) return;
    root.className = "oneagent-onboarding";
    root.append(element("p", "ONEAGENT"), element("h1", "Bienvenue dans ta mémoire professionnelle"), element("p", "Retrouve ton graphe, tes notes, tes tâches et tes priorités. Choisis où conserver ta mémoire sur ce Mac."));
    try {
      const status = await api("status");
      if (status.status === "ready") { location.reload(); return; }
      const message = element("p", status.message); root.append(message);
      if (status.managed) return;
      const form = element("form"), mode = element("select"), locationInput = element("input");
      for (const [value, text] of [["create", "Créer une mémoire"], ["connect", "Connecter une mémoire existante (par exemple celle de VS Code)"]]) { const option = element("option", text); option.value = value; mode.append(option); }
      const modeLabel = element("label", "Mémoire"), pathLabel = element("label", "Emplacement local"); modeLabel.append(mode); pathLabel.append(locationInput);
      locationInput.value = status.suggestedLocation || ""; locationInput.required = true;
      const submit = element("button", "Continuer"); submit.type = "submit";
      form.append(modeLabel, pathLabel, submit); root.append(form);
      mode.addEventListener("change", () => { locationInput.value = mode.value === "create" ? status.suggestedLocation || "" : ""; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); submit.disabled = true;
        try {
          const plan = await api("setup", { name: "oneagent_prepare_memory", input: { mode: mode.value, location: locationInput.value } });
          const { dialog, content, actions } = modal("Configurer cette mémoire"); content.append(element("p", plan.message));
          actions.append(button("Confirmer", async () => {
            for (const item of actions.querySelectorAll("button")) item.disabled = true;
            try { await api("setup", { name: "oneagent_finish_setup", input: { setupId: plan.setupId } }); location.reload(); }
            catch (error) { content.append(element("p", error.message)); actions.replaceChildren(button("Fermer", () => dialog.close())); }
          }), button("Retour", () => dialog.close()));
        } catch (error) { message.textContent = error.message; }
        finally { submit.disabled = false; }
      });
    } catch (error) { root.append(element("p", error.message)); }
  }
  const boot = () => {
    // Copilot owns its canvas layout; VS Code editor/sidebar controls do not apply.
    for (const id of ["openFullCockpit", "openSidebarCockpit"]) { const control = document.getElementById(id); if (control) control.style.display = "none"; }
    const status = element("div", "", "oneagent-host-status"); status.id = "oneagent-host-status"; status.setAttribute("role", "status"); status.hidden = true; document.body.append(status);
    ready = true; for (const value of queued.splice(0)) void handle(value); void onboard();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
