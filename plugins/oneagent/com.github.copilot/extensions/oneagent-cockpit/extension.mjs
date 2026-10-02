import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { startCockpitServer } from "./server.mjs";
import { MemoryConnection, callSetupTool } from "../../../runtime/packages/mcp-server/src/onboarding.ts";
import { PluginUpdates } from "../../../runtime/packages/mcp-server/src/plugin-updates.ts";

const connection = new MemoryConnection({ configPath: process.env.ONEAGENT_CONFIG, settingsPath: process.env.ONEAGENT_COPILOT_SETTINGS });
const updates = new PluginUpdates(), instances = new Map();
await joinSession({ canvases: [createCanvas({
  id: "oneagent-cockpit", displayName: "OneAgent · Cockpit",
  description: "Interface complète OneAgent, commune avec VS Code : graphe 2D/3D, notes, priorités, tâches, inbox, sources, Today, contexte, aide et réglages. Ouvrir aussi pour configurer la mémoire après installation.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  // UI controller messages and confirmation replies are deliberately not agent-callable actions.
  open: async (ctx) => {
    let entry = instances.get(ctx.instanceId);
    if (!entry) {
      entry = startCockpitServer({ connection, updates, callOnboarding: (name, input) => callSetupTool(connection, name, input) });
      instances.set(ctx.instanceId, entry); entry.catch(() => instances.delete(ctx.instanceId));
    }
    return { title: "OneAgent · Cockpit", url: (await entry).url };
  },
  onClose: async (ctx) => { const entry = instances.get(ctx.instanceId); instances.delete(ctx.instanceId); if (entry) await (await entry).close(); }
})] });
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  await Promise.allSettled([...instances.values()].map(async (entry) => (await entry).close()));
  process.exit(0);
}
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
