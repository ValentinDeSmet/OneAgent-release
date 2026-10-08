(() => {
  const token = document.querySelector('meta[name="oneagent-token"]')?.content;
  if (!token) return;
  let locked = false, reporting = false, bar, label, retry, overlay;
  const roots = () => [document, document.getElementById("priorities")?.shadowRoot].filter(Boolean);
  const blocked = () => {
    if (window.oneagentCanReload) return !window.oneagentCanReload();
    return roots().some(root => root.querySelector("dialog[open]") || root.querySelector('[data-manual-note-editor-dirty="true"]')
      || [...root.querySelectorAll("textarea:not([readonly]), .field input:not([readonly]), .field select")].some(el => {
        if (el.disabled || el.type === "password" || el.type === "hidden") return false;
        if (["checkbox", "radio"].includes(el.type)) return el.checked !== el.defaultChecked;
        if (el.tagName === "SELECT") return [...el.options].some(option => option.selected !== option.defaultSelected) && [...el.options].some(option => option.defaultSelected);
        return el.value !== el.defaultValue;
      }));
  };
  const api = async (route, input) => {
    const response = await fetch("/api/" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-OneAgent-Token": token }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error("Mise à jour indisponible"); return response.json();
  };
  const start = () => {
    bar = document.createElement("aside"); bar.id = "oneagent-update-progress"; bar.hidden = true; bar.setAttribute("role", "status");
    label = document.createElement("span"); retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Réessayer le rechargement"; retry.hidden = true;
    retry.addEventListener("click", async () => { retry.disabled = true; try { await api("update-retry", {}); } catch { label.textContent = "Copilot n’a pas accepté le rechargement. Tu peux réessayer ici sans réinstaller."; } finally { retry.disabled = false; } });
    bar.append(label, retry); overlay = document.createElement("div"); overlay.id = "oneagent-update-lock"; overlay.hidden = true; document.body.append(overlay, bar);
    // The existing entry point becomes one action on Copilot. VS Code keeps its native updater.
    const relabel = () => { for (const button of document.querySelectorAll('[data-setting-action="checkForUpdates"], [data-documentation-action="checkForUpdates"]')) if (button.textContent !== "Mettre à jour OneAgent") button.textContent = "Mettre à jour OneAgent"; };
    new MutationObserver(relabel).observe(document.body, { childList: true, subtree: true }); relabel();
    const report = async () => {
      if (reporting) return; reporting = true;
      try {
        const state = await api("reload-ui", { action: "report", blocked: blocked(), locked });
        locked = state.pause && !blocked(); overlay.hidden = !locked;
        bar.hidden = !state.message && !state.pause;
        label.textContent = state.message || "Préparation de la mise à jour…";
        retry.hidden = !state.retry;
      } catch { /* Preserve editors and the last progress while the host replaces this process. */ }
      finally { reporting = false; }
    };
    document.addEventListener("keydown", event => { if (locked && !bar.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    document.addEventListener("input", () => { void report(); }, true);
    document.addEventListener("change", () => { void report(); }, true);
    const timer = setInterval(report, 500); window.addEventListener("pagehide", () => clearInterval(timer)); void report();
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
