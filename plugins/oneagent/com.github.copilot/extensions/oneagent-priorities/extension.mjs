import { createCanvasHandoff } from "../oneagent-cockpit/reload-canvases.mjs";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { startPriorityServer } from "./server.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || major === 22 && minor < 18) throw new Error("OneAgent requires Node.js >=22.18.");
const { MemoryConnection } = await import("../../../runtime/packages/mcp-server/src/onboarding.ts");
const { PluginUpdates } = await import("../../../runtime/packages/mcp-server/src/plugin-updates.ts");
const { callPriorityTool, priorityTools } = await import("../../../runtime/packages/mcp-server/src/priorities.ts");
const connection = new MemoryConnection({ configPath: process.env.ONEAGENT_CONFIG, settingsPath: process.env.ONEAGENT_COPILOT_SETTINGS });
const updates = new PluginUpdates();
const instances = new Map(), releases = new Map();
const handoff = createCanvasHandoff(updates.reload.directory, process.env.SESSION_ID, updates.currentVersion);
let queue = Promise.resolve();
const call = (name, input) => {
  const operation = queue.then(() => {
    return updates.run(async () => {
      // The human canvas is an explicit portfolio view, like the shared cockpit.
      // Agent MCP calls retain the active context boundary.
      return callPriorityTool(connection.requireConfig(), name, input, { humanView: true });
    });
  });
  queue = operation.catch(() => {});
  return operation;
};
await joinSession({ canvases: [createCanvas({
  id: "oneagent-priorities", displayName: "OneAgent · Priorités",
  description: "Suivre mes sollicitations : qui attend quoi, priorité, échéance et prochaine action. Mémoire privée partagée avec OneAgent.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  actions: priorityTools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    handler: (ctx) => call(tool.name, ctx.input ?? {}) })),
  open: async (ctx) => {
    let entry = instances.get(ctx.instanceId);
    if (!entry) {
      updates.assertSessionCurrent();
      releases.set(ctx.instanceId, handoff.register(ctx));
      entry = startPriorityServer(call);
      instances.set(ctx.instanceId, entry);
      entry.catch(() => instances.delete(ctx.instanceId));
    }
    return { title: "OneAgent · Priorités", url: (await entry).url };
  },
  onClose: async (ctx) => {
    const entry = instances.get(ctx.instanceId);
    instances.delete(ctx.instanceId);
    try { if (entry) await (await entry).close(); } finally { releases.get(ctx.instanceId)?.(); releases.delete(ctx.instanceId); }
  }
})] });
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await Promise.allSettled([...instances.values()].map(async (entry) => (await entry).close()));
  await queue;
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
