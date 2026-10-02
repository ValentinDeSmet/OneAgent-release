const fs = require("node:fs");
const path = require("node:path");

/** Embed the same priorities screen as the dedicated Copilot canvas in a shadow root. */
function prioritiesBootstrap() {
  const read = (name) => fs.readFileSync(path.join(__dirname, "priorities", name), "utf8");
  const body = read("index.html").match(/<body>([\s\S]*?)<\/body>/)[1];
  const html = `<style>${read("style.css").replaceAll(":root", ":host").replace(/\bbody\b/g, ":host")} :host {display:block;color:var(--text,#f4f1ea);font:14px/1.5 system-ui} main{padding:16px}</style>${body}`;
  const script = read("app.js")
    .replace('const $ = (selector) => document.querySelector(selector);', 'const $ = (selector) => root.querySelector(selector);')
    .replace('const token = $(\'meta[name="oneagent-token"]\').content;', '')
    .replaceAll('document.querySelectorAll(', 'root.querySelectorAll(')
    .replace(/async function api\(operation, input\) \{[\s\S]*?\n\}/, '')
    .replace('!document.hidden)', '!document.hidden && root.host.closest("[data-panel]").classList.contains("active"))');
  return `
  let prioritiesMounted = false;
  function mountPriorities() {
    if (prioritiesMounted) return;
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
  }`;
}

module.exports = { prioritiesBootstrap };
