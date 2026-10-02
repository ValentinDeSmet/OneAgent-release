import { runMemoryCommand } from "./cli-bridge.ts";
const text = (maxLength: number) => ({ type: "string", maxLength });
const scope = { type: "string", enum: ["portfolio"], description: "Whole bound private memory; includes all subjects, independent of the VS Code selection." };
const schema = (properties: Record<string, unknown>, required = ["scope"]) => ({ type: "object", properties: { scope, ...properties }, required, additionalProperties: false });
export const priorityTools = [
  { name: "oneagent_list_priorities", description: "Read my explicit requests/tasks across the bound memory, ordered by priority and deadline, with requester, next action and revision. Estimated deadlines never count as overdue. Inbox proposals are excluded. Paginated. Use today's LOCAL date for date badges.", inputSchema: schema({
    today: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, query: text(500),
    view: { type: "string", enum: ["active", "done", "all"] }, filter: { type: "string", enum: ["all", "urgent", "overdue", "soon", "clarify", "waiting"] },
    limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0, maximum: 1000000 }
  }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "oneagent_save_priority", description: "Create or edit one private request at the user's direction. New requests require a title; edits require the exact taskId and revision returned by list_priorities. Omitted fields are preserved; empty strings clear optional text. Never invent a requester or firm deadline. Use unknown if unspecified, approximate for estimates. No messages are sent. A retry of a creation creates another request.", inputSchema: schema({
    taskId: text(256), revision: text(64), title: text(300), body: text(10000), requester: text(300),
    priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
    status: { type: "string", enum: ["pending", "candidate", "ready", "open", "blocked", "done"] },
    deadline: text(10), deadlineKind: { type: "string", enum: ["unknown", "exact", "approximate"] }, deadlineLabel: text(150), nextAction: text(2000)
  }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
];
export async function callPriorityTool(configPath: string, name: string, raw: unknown) {
  if (!priorityTools.some((tool) => tool.name === name)) throw new Error("Unknown priorities tool.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > 65536) throw new Error("Invalid priorities input.");
  return runMemoryCommand(configPath, ["priorities", name === "oneagent_list_priorities" ? "list" : "save", "--stdin"], JSON.stringify(raw));
}
