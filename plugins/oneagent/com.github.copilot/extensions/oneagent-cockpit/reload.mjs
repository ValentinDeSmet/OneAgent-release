/** Only the joined extension has access to the host's existing conversation. */
export function createSessionReloader({ session, updates, canvases = () => 0, notify = () => {}, interval = 1000 }) {
  let stopped = false, checking = false, attempted, explicit = false, state = "current", notice, hostBusy = false, unsubscribe, watchdog;
  // A global runtime refresh must also wait for the chat's tool turn, including
  // BMAD/other MCP work. Never send, clear or resume a conversation to reload it.
  const joinedSession = Promise.resolve(session).then(joined => {
    if (typeof joined.on === "function") unsubscribe = joined.on(event => {
      if (["assistant.turn_start", "tool.execution_start"].includes(event.type)) hostBusy = true;
      if (event.type === "session.idle") hostBusy = false;
    });
    return joined;
  });
  const status = () => ({ runningVersion: updates.currentVersion, reloadRequired: updates.reloadRequired(),
    reloadState: state, newConversationRequired: false,
    message: state === "unavailable"
      ? "Copilot n’a pas confirmé le rechargement. Demander à l’agent de recharger les plugins, extensions et serveurs MCP dans ce chat, puis vérifier oneagent_update_status. Ne pas réinstaller ni fermer le chat."
      : state === "waiting_for_turn"
        ? "Le rechargement attend la fin de la réponse et des outils du chat. La conversation reste ouverte."
      : state === "waiting_for_canvases"
        ? "Enregistrer les brouillons puis fermer les onglets Canvas OneAgent. Le rechargement se fera dans ce chat ; rouvrir ensuite le Canvas."
        : "Le rechargement conserve cette conversation. Copilot peut relancer les autres extensions et serveurs MCP du chat ; leurs réglages ne sont pas modifiés." });
  const announce = () => {
    const next = `${state}:${updates.reload.request()?.id ?? updates.currentVersion}`;
    if (next !== notice) { notice = next; notify(status()); }
  };
  async function tick() {
    if (stopped || checking || state === "reloading") return;
    checking = true;
    try {
      if (!explicit && !updates.reloadRequired()) return;
      const id = updates.reload.request()?.id ?? "manifest";
      if (!explicit && attempted === id) return;
      const joined = await joinedSession;
      if (hostBusy) { state = "waiting_for_turn"; announce(); return; }
      if (canvases()) { state = "waiting_for_canvases"; announce(); return; }
      if (updates.reload.busy()) { state = "waiting_for_operations"; announce(); return; }
      attempted = id; explicit = false;
      if (typeof joined?.rpc?.plugins?.reload !== "function") throw new Error("Host reload API unavailable");
      state = "reloading"; announce();
      // Refresh the installed plugin paths and skills cache BEFORE relaunching
      // extensions/MCP. Restarting the old extension path alone can reload A.
      // Hook/custom-agent configuration is unrelated to this runtime change.
      let timeout;
      try {
        await Promise.race([
          joined.rpc.plugins.reload({ reloadMcp: true, reloadExtensions: true, reloadCustomAgents: false, reloadHooks: false }),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Host reload timed out")), 15_000); timeout.unref(); })
        ]);
      } finally { clearTimeout(timeout); }
      // A host normally terminates this old process during the RPC. Do not
      // claim that this cached runtime became B just because the RPC resolved.
      watchdog = setTimeout(() => {
        if (!stopped) { state = "unavailable"; announce(); }
      }, 5_000);
      watchdog.unref();
    } catch {
      state = "unavailable"; announce();
    } finally { checking = false; }
  }
  const timer = setInterval(() => { void tick(); }, interval); timer.unref();
  return {
    status,
    request() {
      clearTimeout(watchdog);
      explicit = true;
      // Return the tool response before a host RPC that can stop its caller.
      // The next timer also waits for the current memory operation's lease.
      state = canvases() ? "waiting_for_canvases" : "scheduled";
      announce(); return { ...status(), reloadScheduled: true };
    },
    tick,
    stop() { stopped = true; clearInterval(timer); clearTimeout(watchdog); unsubscribe?.(); }
  };
}

export const reloadTool = (reload) => ({
  name: "oneagent_reload_plugin",
  description: "Reload the installed OneAgent plugin in THIS Copilot conversation, without installing again or clearing chat history. Save drafts and close OneAgent canvases first. The host refreshes its plugin paths, skills, MCP connections and extension processes; other extensions/MCP in this chat may restart too. Verify oneagent_update_status afterwards: currentVersion must equal installedVersion and reloadRequired must be false. A scheduled reload is not proof that the new runtime loaded.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: (args) => {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("Aucun paramètre attendu.");
    return reload.request();
  }
});
