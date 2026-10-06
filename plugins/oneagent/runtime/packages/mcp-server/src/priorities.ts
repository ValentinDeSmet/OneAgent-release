import { runMemoryCommand } from "./cli-bridge.ts";
const text = (maxLength: number) => ({ type: "string", maxLength });
const multiple = (item: Record<string, unknown>) => ({ anyOf: [item, { type: "array", items: item, maxItems: 40, uniqueItems: true }], description: "One value or several alternatives (OR); empty means all. Combined fields use AND." });
const scope = { type: "string", enum: ["portfolio"], description: "Whole bound private memory; includes all subjects, independent of the VS Code selection." };
const schema = (properties: Record<string, unknown>, required = ["scope"]) => ({ type: "object", properties: { scope, ...properties }, required, additionalProperties: false });
export const priorityTools = [
  { name: "oneagent_list_priorities", description: "Read my explicit requests/tasks included in Priorities across the bound memory, in the shared manual order by default (or an explicit column sort), with description, linked entity, primary product, partner products/teams, requester, separate documentation and source URLs, subject/task classification, next action and revision. Returns existing entity choices for creation. Returns a global orderRevision for explicit reordering. Categorical filters accept one value or an array (OR within a field, AND across fields). Returns facets from matching rows before pagination, ignoring each facet’s own selection; entities remain the full choices for editing. Sort and filter before pagination. Estimated deadlines never count as overdue. Inbox proposals are excluded. Paginated. Use today's LOCAL date for date badges.", inputSchema: schema({
    today: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, query: text(500),
    view: { type: "string", enum: ["active", "done", "all", "excluded"], description: "Default active. all/done still exclude removed priorities. excluded reads only removed rows for explicit restoration of the same task." }, filter: multiple({ type: "string", enum: ["all", "urgent", "overdue", "soon", "clarify", "waiting", "unlinked"] }),
    sortBy: { type: "string", enum: ["manual", "title", "body", "entity", "product", "relatedEntities", "requester", "priority", "deadline", "url", "sourceUrl", "status", "nextAction", "itemType"], description: "Default manual order shared by both hosts. Other sorts do not alter it." },
    sortDirection: { type: "string", enum: ["asc", "desc"] },
    titleQuery: text(500), bodyQuery: text(500), requesterQuery: text(300), urlQuery: text(500), sourceUrlQuery: text(500),
    itemType: multiple({ type: "string", enum: ["all", "subject", "task"] }),
    involvedEntity: multiple({ ...text(512), description: "Exact product:id or team:id involved as primary product, attached product/team or partner." }),
    relatedEntity: multiple({ ...text(512), description: "Exact product:id or team:id among partners only." }),
    entity: multiple({ ...text(512), description: "Exact kind:id from entities returned by list_priorities." }), productId: multiple(text(256)),
    priority: multiple({ type: "string", enum: ["", "critical", "high", "medium", "low"] }),
    status: multiple({ type: "string", enum: ["", "pending", "candidate", "ready", "open", "in_progress", "blocked", "done"] }),
    deadlineKind: multiple({ type: "string", enum: ["", "unknown", "exact", "approximate"] }), deadlineFrom: text(10), deadlineTo: text(10),
    limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0, maximum: 1000000 }
  }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "oneagent_save_priority", description: "Create or edit one private request at the user's direction. New requests require a title and an existing entity (kind:id from list_priorities). Legacy unlinked requests must be attached when edited; edits require the exact taskId and revision returned by list_priorities. New rows default to subject; existing ordinary tasks keep their classification unless itemType is explicit. Rows removed from Priorities stay excluded on ordinary edits. To restore the same task, first list view=excluded, then save its taskId/revision with inPriorities=true. A visibility-only save preserves all fields and links, even for unlinked legacy tasks. Omitted fields are preserved; empty strings clear optional text and an empty relatedEntityRefs array clears partners. Never invent a requester or firm deadline. Use unknown if unspecified, approximate for estimates. No messages are sent. A retry of a creation creates another request.", inputSchema: schema({
    inPriorities: { type: "boolean", description: "Whether this task is shown in Priorities. Omit to preserve. false hides only from priorities, never deletes/archives/completes the native task or its links. true explicitly restores it." },
    entity: { ...text(512), description: "Required on creation; exact existing active kind:id. Never invent an entity." },
    productId: { ...text(256), description: "Existing product ID; optional for non-product entities. When entity is a product, use the same ID or omit it." },
    url: { ...text(2048), description: "Optional http(s) documentation/work-item link. Keep separate from the source Google Sheet URL. Empty string clears it." },
    sourceUrl: { ...text(2048), description: "Original source URL, e.g. the Google Sheet/tab/row from which the priority was imported. Preserve on later edits; never invent it or replace the documentation URL." },
    itemType: { type: "string", enum: ["subject", "task"], description: "Subject to develop versus an ordinary task; editable independently of advancement." },
    relatedEntityRefs: { type: "array", maxItems: 40, uniqueItems: true, items: text(512), description: "Existing active product:id or team:id partners from list_priorities.entities. The primary product stays productId. [] clears partners; omit to preserve." },
    taskId: text(256), revision: text(64), title: text(300), body: text(10000), requester: text(300),
    priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
    status: { type: "string", enum: ["pending", "candidate", "ready", "open", "in_progress", "blocked", "done"] },
    deadline: text(10), deadlineKind: { type: "string", enum: ["unknown", "exact", "approximate"] }, deadlineLabel: text(150), nextAction: text(2000)
  }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "oneagent_reorder_priority", description: "At the user's explicit direction, move one personal priority before or after another in the shared manual order. Read list_priorities first and pass its exact orderRevision. Filters and pages only hide rows: all other subjects/tasks keep their relative order. Does not change business priority, deadline, status, documentation, source or entity links. Never rank subjects autonomously or retry a failed write without reading the list again.", inputSchema: schema({
    taskId: text(256), targetTaskId: text(256), position: { type: "string", enum: ["before", "after"] },
    orderRevision: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Exact portfolio orderRevision from the latest list_priorities response, including filtered/paginated responses." }
  }, ["scope", "taskId", "targetTaskId", "position", "orderRevision"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } } ,
  { name: "oneagent_delete_priority", description: "At the user's explicit direction, remove one personal row from Priorities only. The native task remains in Tasks with its unchanged status, information and all links; entities, documentation, sources and notes remain. This is a visibility change, never a task deletion. Restore the same task with save_priority inPriorities=true after reading list_priorities view=excluded. First read list_priorities and use its exact taskId and revision. A changed row is refused. Never remove items merely because they disappear from an imported sheet; never automatically retry an uncertain removal.", inputSchema: schema({
    taskId: text(256), revision: { type: "string", pattern: "^[a-f0-9]{64}$" }
  }, ["scope", "taskId", "revision"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
];
export async function callPriorityTool(configPath: string, name: string, raw: unknown, options: { humanView?: boolean } = {}) {
  if (!priorityTools.some((tool) => tool.name === name)) throw new Error("Unknown priorities tool.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > 65536) throw new Error("Invalid priorities input.");
  const operations: Record<string, string> = { oneagent_list_priorities: "list", oneagent_save_priority: "save", oneagent_reorder_priority: "reorder", oneagent_delete_priority: "delete" };
  const operation = operations[name];
  return runMemoryCommand(configPath, ["priorities", operation!, "--stdin", ...(options.humanView ? [] : ["--context-scope", "active"])], JSON.stringify(raw));
}
