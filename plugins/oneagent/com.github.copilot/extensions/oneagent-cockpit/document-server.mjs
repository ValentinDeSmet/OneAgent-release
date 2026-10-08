import { createCanvasGuard } from "./reload-canvases.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createDocumentStore, documentLimit } from "./documents.mjs";

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export async function startDocumentServer({ connection, updates, file, assetsRoot, openFile, retryUpdate }) {
  const store = createDocumentStore({ connection, updates, assetsRoot });
  const initial = store.read(file);
  if (!initial.file) throw new Error("Choisir un fichier texte.");
  file = initial.file;
  const token = randomBytes(32).toString("hex");
  let authority, closed = false;
  const guard = createCanvasGuard();
  const assets = new Map(["document.js", "document.css", "markdown.bundle.mjs", "reload-ui.js", "reload-ui.css"].map((name) => ["/" + name, fs.readFileSync(new URL(name, import.meta.url))]));
  const server = createServer(async (req, res) => {
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-src 'none'" };
    const send = (status, value, type = "application/json") => { res.writeHead(status, { ...headers, "Content-Type": type + "; charset=utf-8" }); res.end(type === "application/json" ? JSON.stringify(value) : value); };
    try {
      if (closed || req.headers.host !== authority) return send(403, { error: "Accès refusé." });
      const url = new URL(req.url, `http://${authority}`);
      if (req.headers.origin && req.headers.origin !== `http://${authority}`) return send(403, { error: "Accès refusé." });
      if (!(req.headers["x-oneagent-token"] === token || req.method === "GET" && url.searchParams.get("token") === token)) return send(403, { error: "Accès refusé." });
      if (req.method === "GET" && assets.has(url.pathname)) return send(200, assets.get(url.pathname), url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
      if (req.method === "GET" && url.pathname === "/api/document") return send(200, store.read(file));
      if (req.method === "GET" && url.pathname === "/") return send(200, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="oneagent-token" content="${token}"><script src="/reload-ui.js?token=${token}" defer></script><link rel="stylesheet" href="/reload-ui.css?token=${token}"><title>${escape(initial.title)}</title><link rel="stylesheet" href="/document.css?token=${token}"><script type="module" src="/document.js?token=${token}"></script></head><body><header><div><strong id="title">${escape(initial.title)}</strong><small id="path"></small></div><nav aria-label="Document"><button id="read" aria-pressed="true">Lecture</button><button id="edit" aria-pressed="false" hidden>Modifier</button><button id="refresh">Actualiser</button><button id="save" hidden>Enregistrer</button></nav></header><p id="status" role="status"></p><main><article id="preview" aria-label="Document Markdown"></article><textarea id="source" aria-label="Source du document" hidden spellcheck="false"></textarea></main></body></html>`, "text/html");
      if (req.method !== "POST" || req.headers["content-type"] !== "application/json") return send(404, { error: "Action inconnue." });
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > documentLimit + 65536) return send(413, { error: "Demande trop volumineuse." }); chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Objet JSON requis.");
      if (url.pathname === "/api/reload-ui") return send(200, guard.handle(data));
      if (url.pathname === "/api/update-retry" && retryUpdate) return send(200, retryUpdate());
      if (url.pathname === "/api/save") return send(200, store.save({ file, revision: data.revision, content: data.content }));
      if (url.pathname === "/api/open" && typeof data.href === "string" && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(data.href)) {
        const target = path.resolve(path.dirname(file), decodeURIComponent(data.href.split(/[?#]/)[0]));
        const next = store.read(target);
        if (!next.markdown || !next.file) throw new Error("Choisir un lien vers un fichier Markdown.");
        if (!openFile) throw new Error("L’ouverture d’un autre onglet est indisponible.");
        await openFile(next.file); return send(200, { opened: true });
      }
      return send(404, { error: "Action inconnue." });
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); }
  });
  server.requestTimeout = 30000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  authority = `127.0.0.1:${server.address().port}`;
  return { notifyReload: value => guard.notify(value), title: initial.title, url: `http://${authority}/?token=${token}`, async close() {
    if (closed) return; closed = true;
    await new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); });
  } };
}
