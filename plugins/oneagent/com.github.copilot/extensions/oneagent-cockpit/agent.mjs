/** Same prompts, tools and action policy as VS Code, in an isolated SDK session. */
export async function runAgentLoop(request, createClient = async () => {
  const { CopilotClient } = await import("@github/copilot-sdk");
  return new CopilotClient();
}) {
  const client = await createClient();
  let session, active = true, count = 0;
  let queue = Promise.resolve();
  const toolsUsed = [], diagnostics = [];
  const record = (event) => { diagnostics.push(event); request.onDiagnostic?.(event); };
  try {
    session = await client.createSession({
      ...(request.model ? { model: request.model } : {}),
      // Never inherit shell, file writes, BMAD tools or MCP servers in this bounded pass.
      availableTools: request.tools.map((tool) => `custom:${tool.name}`),
      tools: request.tools.map((tool) => ({
        name: tool.name, description: tool.description, parameters: tool.inputSchema,
        skipPermission: true,
        handler: (args) => {
          const work = queue.then(async () => {
            if (!active || ++count > request.maxTurns * 4) throw new Error("OneAgent curation tool limit reached.");
            const event = { type: "tool_call", turn: count, tool: tool.name, action: String(args?.action || "default"), status: "ok" };
            toolsUsed.push(tool.name);
            try {
              if (!request.isAllowed(tool.name, args) || args?.allowBoundaryChange === true) throw new Error("Autonomous curation cannot accept proposals, write wiki pages or change the active context boundary.");
              const result = await request.invoke(tool.name, args);
              return result.content.map((part) => part.value || "").join("\n");
            } catch (error) {
              event.status = "error"; event.error = error.message;
              return `Tool error: ${error.message}`;
            } finally { record(event); }
          });
          queue = work.catch(() => {});
          return work;
        }
      })),
      onPermissionRequest: async () => ({ kind: "reject", feedback: "Only bounded OneAgent curation tools are permitted." })
    });
    await session.sendAndWait({ prompt: request.prompt }, 180000);
    const termination = count > request.maxTurns * 4 ? "turn_limit" : "assistant_stopped";
    record({ type: "termination", turn: count, reason: termination });
    return { toolsUsed, diagnostics, turns: count, termination };
  } finally {
    active = false;
    // A timed-out wait does not stop a model. Revoke tool access, abort, then drain writes.
    if (session) await session.abort().catch(() => {});
    await queue;
    if (session) await session.disconnect().catch(() => {});
    await client.stop();
  }
}
