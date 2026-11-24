/**
 * The Copilot application gives plugins a connection to the current conversation
 * only: a separate SDK client cannot start its own Copilot runtime there (its
 * platform package is not provided). Such a failure is reported as unavailable,
 * so captures stay pending for the conversation agent instead of failing.
 */
export const AGENT_RUNTIME_UNAVAILABLE = "La curation automatique n’est pas disponible dans l’application Copilot. Demande à l’agent de la conversation : « cure mes captures en attente ».";
function unavailable(error) {
  return /copilot-sdk-[a-z0-9-]+|platform package|Copilot CLI not found|runtime bundle/i.test(error?.message || String(error))
    ? Object.assign(new Error(AGENT_RUNTIME_UNAVAILABLE), { code: "agent_runtime_unavailable", cause: error })
    : error;
}
async function startClient(createClient) {
  try { return await createClient(); } catch (error) { throw unavailable(error); }
}

/** Same prompts, tools and action policy as VS Code, in an isolated SDK session. */
export async function runAgentLoop(request, createClient = async () => {
  const { CopilotClient } = await import("@github/copilot-sdk");
  return new CopilotClient();
}) {
  const client = await startClient(createClient);
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
    }).catch((error) => { throw unavailable(error); });
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
    await client.stop().catch(() => {});
  }
}

/** A separate read-only draft pass; it cannot call tools or mutate the user's memory. */
export async function runCareerDraft(prompt, model, createClient=async()=>{
  const {CopilotClient}=await import('@github/copilot-sdk');return new CopilotClient();
}) {
  const client=await startClient(createClient);let session;
  try {
    session=await client.createSession({...(model?{model}:{}),availableTools:[],tools:[],onPermissionRequest:async()=>({kind:'reject',feedback:'Read-only drafting: no tools or external actions.'})}).catch((error)=>{throw unavailable(error);});
    const response=await session.sendAndWait({prompt},180000);
    const content=response?.data?.content;
    if(typeof content!=='string'||!content.trim())throw new Error('Le modèle n’a pas renvoyé de proposition.');return content;
  } finally{if(session){await session.abort().catch(()=>{});await session.disconnect().catch(()=>{});}await client.stop().catch(()=>{});}
}
