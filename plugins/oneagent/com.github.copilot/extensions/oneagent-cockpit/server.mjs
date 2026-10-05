import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { createCockpitHost, cockpitRoot } from "./host.mjs";
import { runAgentLoop } from "./agent.mjs";

const require = createRequire(import.meta.url);
const { renderCockpitHtml } = require(path.join(cockpitRoot, "src/cockpit.js"));
// Derived from the shared controller, not a second list of independently implemented actions.
const controllerSource = fs.readFileSync(path.join(cockpitRoot, "src/extension.js"), "utf8");
export const cockpitActions = new Set([...controllerSource.matchAll(/message\.type === "([^"]+)"/g)].map((match) => match[1]));

export async function startCockpitServer({ connection, updates, callOnboarding, openFile, agentLoop = runAgentLoop }) {
  const token = randomBytes(32).toString("hex"), nonce = randomBytes(24).toString("hex");
  const clients = new Set();
  let authority, closed = false;
  const emit = (value) => { for (const client of clients) client.write(`data: ${JSON.stringify(value)}\n\n`); };
  const host = createCockpitHost({ connection, updates, emit, openFile, runAgentLoop: agentLoop });
  const assets = new Map([
    ["/bridge.js", [fs.readFileSync(new URL("bridge.js", import.meta.url), "utf8"), "text/javascript"]],
    ["/host.css", [fs.readFileSync(new URL("host.css", import.meta.url), "utf8"), "text/css"]],
    ["/graph.js", [fs.readFileSync(path.join(cockpitRoot, "media/graph-viewer.bundle.js"), "utf8"), "text/javascript"]]
  ]);
  const server = createServer(async (req, res) => {
    const headers = {
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self' about:; base-uri 'none'; form-action 'none'`
    };
    const send = (status, value, type = "application/json") => { res.writeHead(status, { ...headers, "Content-Type": `${type}; charset=utf-8` }); res.end(type === "application/json" ? JSON.stringify(value) : value); };
    try {
      if (closed || req.headers.host !== authority) return send(403, { error: "Accès refusé." });
      const url = new URL(req.url, `http://${authority}`);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${authority}`) return send(403, { error: "Accès refusé." });
      const authenticated = req.headers["x-oneagent-token"] === token || req.method === "GET" && url.searchParams.get("token") === token;
      if (!authenticated) return send(403, { error: "Accès refusé." });
      if (req.method === "GET" && assets.has(url.pathname)) return send(200, ...assets.get(url.pathname));
      if (req.method === "GET" && url.pathname === "/") {
        updates.assertSessionCurrent();
        const status = connection.status();
        let html;
        if (status.status === "ready") {
          let state;
          try { state = await host.state(); } catch (error) { state = await host.fallback(error); }
          html = renderCockpitHtml(state, { nonce, graphViewerScript: `/graph.js?token=${token}`, hostBridgeScript: `/bridge.js?token=${token}` });
        } else {
          html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneAgent · Bienvenue</title><script src="/bridge.js?token=${token}" defer></script></head><body><main id="onboarding"></main></body></html>`;
        }
        html = html.replace("</head>", `<meta name="oneagent-token" content="${token}"><link rel="stylesheet" href="/host.css?token=${token}"></head>`);
        return send(200, html, "text/html");
      }
      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, { ...headers, "Content-Type": "text/event-stream", Connection: "keep-alive" });
        res.write(": connected\n\n"); clients.add(res);
        host.replayDialogs();
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method !== "POST") return send(404, { error: "Action inconnue." });
      if (req.headers["content-type"] !== "application/json") return send(415, { error: "JSON requis." });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) return send(413, { error: "Demande trop volumineuse." }); chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Objet JSON requis.");
      if (url.pathname === "/api/message") {
        if (!cockpitActions.has(data.type)) return send(400, { error: "Action inconnue." });
        // Return before a possible human dialog. Never retry an uncertain write.
        void host.dispatch(data).catch(() => {});
        return send(202, { accepted: true });
      }
      if (url.pathname === "/api/answer") { host.answer(data.id, data.value); return send(200, { accepted: true }); }
      if (url.pathname === "/api/document") return send(200, await host.saveDocument(data));
      if (url.pathname === "/api/status") return send(200, connection.status());
      if (url.pathname === "/api/setup") {
        updates.assertSessionCurrent();
        if (!["oneagent_prepare_memory", "oneagent_finish_setup"].includes(data.name)) throw new Error("Action de configuration inconnue.");
        return send(200, await callOnboarding(data.name, data.input));
      }
      return send(404, { error: "Action inconnue." });
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); }
  });
  server.requestTimeout = 30000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  authority = `127.0.0.1:${server.address().port}`;
  const keepalive = setInterval(() => { for (const client of clients) client.write(": keepalive\n\n"); }, 15000);
  keepalive.unref();
  return { url: `http://${authority}/?token=${token}`, async close() {
    if (closed) return; closed = true; clearInterval(keepalive);
    for (const client of clients) client.end(); clients.clear();
    await host.close();
    await new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); });
  } };
}
