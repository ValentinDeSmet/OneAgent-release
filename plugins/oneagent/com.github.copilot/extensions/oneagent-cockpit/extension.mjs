import { createCanvasHandoff, createCanvasManager } from "./reload-canvases.mjs";
import { createHostInstaller } from "./host-installer.mjs";
import { createSessionReloader, reloadTool } from "./reload.mjs";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { startCockpitServer } from "./server.mjs";
import { startDocumentServer } from "./document-server.mjs";
import { createDocumentStore, createDocumentOpener } from "./documents.mjs";
import { cockpitRoot } from "./host.mjs";
import { MemoryConnection, callSetupTool } from "../../../runtime/packages/mcp-server/src/onboarding.ts";
import { PluginUpdates } from "../../../runtime/packages/mcp-server/src/plugin-updates.ts";

const connection = new MemoryConnection({ configPath: process.env.ONEAGENT_CONFIG, settingsPath: process.env.ONEAGENT_COPILOT_SETTINGS });
const updates = new PluginUpdates({ invoke: createHostInstaller(() => session) }), instances = new Map();
const documentInstances = new Map();
const store = createDocumentStore({ connection, updates, assetsRoot: cockpitRoot });
const openFile = (extensionId, file) => createDocumentOpener(session, extensionId, store)(file);
const handoff = createCanvasHandoff(updates.reload.directory, process.env.SESSION_ID, updates.currentVersion), releases = new Map();
const joined = Promise.resolve().then(() => session);
const canvasManager = createCanvasManager(joined, handoff);
const reload = createSessionReloader({ session: joined, updates, canvasManager, notify: (status) => {
  for (const entry of [...instances.values(), ...[...documentInstances.values()].map(entry => entry.server)]) void entry.then(server => server.notifyReload(status)).catch(() => {});
} });
const session = joinSession({ tools: [reloadTool(reload)], canvases: [createCanvas({
  id: "oneagent-cockpit", displayName: "OneAgent · Cockpit",
  description: "Interface complète OneAgent, commune avec VS Code : graphe 2D/3D, notes, priorités, tâches, inbox, sources, Today, contexte, aide et réglages. Ouvrir aussi pour configurer la mémoire après installation.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  // UI controller messages and confirmation replies are deliberately not agent-callable actions.
  open: async (ctx) => {
    updates.assertSessionCurrent();
    releases.set(ctx.instanceId, handoff.register(ctx));
    let entry = instances.get(ctx.instanceId);
    if (!entry) {
      entry = startCockpitServer({ connection, updates, manageUpdate: () => reload.install(), retryUpdate: () => reload.request(), openFile: (file) => openFile(ctx.extensionId, file), callOnboarding: (name, input) => callSetupTool(connection, name, input) });
      instances.set(ctx.instanceId, entry); entry.catch(() => instances.delete(ctx.instanceId));
    }
    return { title: "OneAgent · Cockpit", url: (await entry).url };
  },
  onClose: async (ctx) => { const entry = instances.get(ctx.instanceId); try { if (entry) await (await entry).close(); } finally { instances.delete(ctx.instanceId); releases.get(ctx.instanceId)?.(); releases.delete(ctx.instanceId); } }
}), createCanvas({
  id: "oneagent-document", displayName: "OneAgent · Document",
  description: "Ouvrir un fichier Markdown de la mémoire OneAgent ou de ses dépôts dans un onglet de lecture formatée, avec édition du fichier original.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Chemin absolu du fichier local." } }, required: ["path"], additionalProperties: false },
  open: async (ctx) => {
    const document = store.read(ctx.input?.path);
    releases.set(ctx.instanceId, handoff.register(ctx));
    let entry = documentInstances.get(ctx.instanceId);
    if (entry && entry.file !== document.file) throw new Error("Cet onglet est déjà associé à un autre fichier.");
    if (!entry) {
      const server = startDocumentServer({ connection, updates, retryUpdate: () => reload.request(), file: document.file, assetsRoot: cockpitRoot, openFile: (file) => openFile(ctx.extensionId, file) });
      entry = { file: document.file, server }; documentInstances.set(ctx.instanceId, entry);
      server.catch(() => documentInstances.delete(ctx.instanceId));
    }
    const server = await entry.server;
    return { title: server.title, url: server.url };
  },
  onClose: async (ctx) => { const entry = documentInstances.get(ctx.instanceId); try { if (entry) await (await entry.server).close(); } finally { documentInstances.delete(ctx.instanceId); releases.get(ctx.instanceId)?.(); releases.delete(ctx.instanceId); } }
})] });
await session;
let closing = false;
async function shutdown() {
  if (closing) return; closing = true; reload.stop();
  await Promise.allSettled([...instances.values(), ...[...documentInstances.values()].map((entry) => entry.server)].map(async (entry) => (await entry).close()));
  process.exit(0);
}
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
