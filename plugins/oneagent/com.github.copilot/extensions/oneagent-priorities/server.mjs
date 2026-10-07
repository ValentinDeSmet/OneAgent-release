import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** SDK-free loopback surface. The injected caller owns the shared memory binding. */
export async function startPriorityServer(call) {
  const token = randomBytes(32).toString("hex");
  const assets = new Map(await Promise.all(["index.html", "app.js", "style.css"].map(async (name) => [name, await readFile(new URL(name, existsSync(new URL("index.html", import.meta.url)) ? import.meta.url : new URL("../../../../vscode-extension/src/priorities/", import.meta.url)), "utf8")])));
  let authority;
  const server = createServer(async (req, res) => {
    const send = (status, value, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'" });
      res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
    };
    try {
      if (req.headers.host !== authority) return send(403, { error: "Accès refusé." });
      const url = new URL(req.url, `http://${authority}`);
      const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (req.method === "GET" && assets.has(asset)) {
        if (url.searchParams.get("token") !== token) return send(403, { error: "Accès refusé." });
        return send(200, assets.get(asset).replaceAll("__ONEAGENT_TOKEN__", token), asset.endsWith(".js") ? "text/javascript; charset=utf-8" : asset.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
      }
      if (req.headers["x-oneagent-token"] !== token || (req.headers.origin && req.headers.origin !== `http://${authority}`)) return send(403, { error: "Accès refusé." });
      const operation = { "/api/list": "oneagent_list_priorities", "/api/save": "oneagent_save_priority", "/api/reorder": "oneagent_reorder_priority", "/api/delete": "oneagent_delete_priority", "/api/tasks": "oneagent_list_priority_tasks", "/api/task-attach": "oneagent_attach_priority_task", "/api/task-detach": "oneagent_detach_priority_task", "/api/task-save": "oneagent_save_priority_task", "/api/views": "oneagent_list_priority_views", "/api/view-save": "oneagent_save_priority_view", "/api/view-delete": "oneagent_delete_priority_view" }[url.pathname];
      if (req.method !== "POST" || !operation) return send(404, { error: "Action inconnue." });
      if (req.headers["content-type"] !== "application/json") return send(415, { error: "JSON requis." });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { send(413, { error: "Demande trop volumineuse." }); return; }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      send(200, await call(operation, input));
    } catch (error) {
      if (!res.headersSent) send(400, { error: error instanceof Error ? error.message : "Impossible de mettre à jour les priorités." });
    }
  });
  server.requestTimeout = 30000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  authority = `127.0.0.1:${server.address().port}`;
  return { url: `http://${authority}/?token=${token}`, close: () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }) };
}
