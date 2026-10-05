const fs = require("node:fs");
const path = require("node:path");

/** Embed the same priorities screen as the dedicated Copilot canvas in a shadow root. */
function prioritiesBootstrap() {
  const read = (name) => fs.readFileSync(path.join(__dirname, "priorities", name), "utf8");
  const body = read("index.html").match(/<body>([\s\S]*?)<\/body>/)[1];
  // The embedded view inherits the exact cockpit tokens, including live theme
  // switches. Standalone canvas defaults must never override those variables.
  const css = read("style.css").replace(/\/\* standalone-theme:start \*\/[\s\S]*?\/\* standalone-theme:end \*\//, "").replace(/\bbody\b/g, ":host");
  const html = `<style>${css} :host {display:block;color:var(--text);font:inherit} main{padding:0}</style>${body}`;
  const script = read("app.js")
    .replace('const $ = (selector) => document.querySelector(selector);', 'const $ = (selector) => root.querySelector(selector);')
    .replace('const openExternal = null;', 'const openExternal = (url) => vscode?.postMessage({type:"openExternal",url});')
    .replace('const token = $(\'meta[name="oneagent-token"]\').content;', '')
    .replaceAll('document.querySelectorAll(', 'root.querySelectorAll(')
    .replace(/async function api\(operation, input\) \{[\s\S]*?\n\}/, '')
    .replace('!document.hidden)', '!document.hidden && root.host.closest("[data-panel]").classList.contains("active"))');
  return `
  let prioritiesMounted = false;
  let refreshPriorities;
  function mountPriorities() {
    if (prioritiesMounted) { refreshPriorities?.(); return; }
    prioritiesMounted = true;
    const root = document.querySelector("#priorities").attachShadow({mode:"open"});
    root.innerHTML = ${JSON.stringify(html).replace(/</g, "\\u003c")};
    const pending = new Map();
    window.addEventListener("message", (event) => {
      const value = event.data;
      if (value?.type !== "priorityResult") return;
      const entry = pending.get(value.requestId);
      if (!entry) return;
      pending.delete(value.requestId); clearTimeout(entry.timer);
      value.error ? entry.reject(new Error(value.error)) : entry.resolve(value.payload);
    });
    function api(operation, input) {
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Délai dépassé. Vérifier la liste avant de réessayer une écriture.")); }, 120000);
        pending.set(requestId, {resolve, reject, timer});
        vscode?.postMessage({type:"priorityRequest", operation, input:{...input,scope:"portfolio"}, requestId});
      });
    }
    ${script}
    refreshPriorities = () => { if (!loading && !saving && !reordering && !draggedId && !editor.open) refresh(); };
    window.addEventListener("message", (event) => { if (event.data?.type === "state") autoRefresh(); });
  }`;
}

module.exports = { prioritiesBootstrap };
