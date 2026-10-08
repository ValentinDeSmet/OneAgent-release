/** Only the joined extension has access to the host's existing conversation. */
export function createSessionReloader({ session, updates, canvases = () => 0, canvasManager, notify = () => {}, interval = 1000 }) {
  let stopped = false, checking = false, attempted, explicit = false, state = "current", notice, hostBusy = false, unsubscribe, watchdog, installPending = false, restoring = false, restoreFailures = 0, detail = "";
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
    reloadState: state, newConversationRequired: false, retryReload: state === "unavailable" && (updates.reloadRequired() || restoreFailures >= 10),
    message: detail || (state === "unavailable"
      ? "Copilot n’a pas confirmé le rechargement dans ce chat. Utiliser « Réessayer le rechargement » dans OneAgent. Aucune nouvelle installation ni nouvelle conversation nécessaire."
      : state === "waiting_for_turn"
        ? "Le rechargement attend la fin de la réponse et des outils du chat. La conversation reste ouverte."
      : state === "waiting_for_canvases"
        ? "Enregistre ou abandonne les brouillons ouverts dans OneAgent. La mise à jour reprendra automatiquement, sans fermer les onglets ni le chat."
        : state === "installing" ? "Installation de la nouvelle version… La conversation est conservée."
        : state === "current" ? "OneAgent est prêt dans cette conversation."
        : "Rechargement de OneAgent… Les onglets vont se réouvrir automatiquement dans cette conversation.") });
  const announce = () => {
    const next = `${detail}:${state}:${updates.reload.request()?.id ?? updates.currentVersion}`;
    if (next !== notice) { notice = next; notify(status()); }
  };
  async function tick() {
    if (stopped || checking || state === "reloading") return;
    checking = true;
    try {
      if (!explicit && !installPending && !updates.reloadRequired()) {
        if (canvasManager && !restoring && restoreFailures < 10) {
          restoring = true;
          try { if (await canvasManager.restore(updates.currentVersion)) { state = "current"; detail = ""; restoreFailures = 0; announce(); } }
          catch (error) { restoreFailures++; if (restoreFailures >= 10) throw error; }
          finally { restoring = false; }
        }
        return;
      }
      const id = updates.reload.request()?.id ?? "manifest";
      if (!explicit && !installPending && attempted === id) return;
      const joined = await joinedSession;
      if (hostBusy) { state = "waiting_for_turn"; announce(); return; }
      if (updates.reload.busy()) { state = "waiting_for_operations"; announce(); return; }
      if (canvasManager ? !await canvasManager.prepare() : canvases()) { state = "waiting_for_canvases"; announce(); return; }
      if (typeof joined?.rpc?.plugins?.reload !== "function") throw new Error("Host reload API unavailable");
      if (installPending) {
        installPending = false; state = "installing"; announce();
        if (!updates.status().officialSourceConfigured) updates.configure(false);
        const result = await updates.update();
        if (!result.reloadRequired) { state = "current"; await canvasManager?.resume(); announce(); return; }
      }
      // A user can start another chat turn while the catalogue downloads.
      // Recheck immediately before the host-wide restart and include new tabs.
      if (hostBusy) { state = "waiting_for_turn"; announce(); return; }
      if (updates.reload.busy()) { state = "waiting_for_operations"; announce(); return; }
      if (canvasManager && !await canvasManager.prepare()) { state = "waiting_for_canvases"; announce(); return; }
      canvasManager?.save(updates.status().installedVersion ?? null);
      attempted = updates.reload.request()?.id ?? id; explicit = false;
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
        if (!stopped) { state = "unavailable"; void canvasManager?.resume(); announce(); }
      }, 5_000);
      watchdog.unref();
    } catch (error) {
      detail = error?.userMessage || (error?.code === -32601 ? "Cette application Copilot ne prend pas encore en charge le rechargement intégré. Mettre à jour Copilot avant de réessayer."
        : !updates.reloadRequired() ? "La mise à jour n’a pas abouti. OneAgent reste utilisable. Le bouton de mise à jour permet de réessayer sans intervenir dans le chat." : "");
      installPending = false; explicit = false; attempted = updates.reload.request()?.id ?? "manifest";
      state = "unavailable"; await canvasManager?.resume(); announce();
    } finally { checking = false; }
  }
  const timer = setInterval(() => { void tick(); }, interval); timer.unref();
  return {
    status,
    install() {
      if (installPending || state === "installing" || state === "reloading") return status();
      if (updates.reloadRequired()) return this.request();
      detail = ""; installPending = true; state = "scheduled"; announce(); return status();
    },
    request() {
      clearTimeout(watchdog); detail = ""; restoreFailures = 0;
      explicit = true;
      // Return the tool response before a host RPC that can stop its caller.
      // The next timer also waits for the current memory operation's lease.
      state = "scheduled";
      announce(); return { ...status(), reloadScheduled: true };
    },
    tick,
    stop() { stopped = true; clearInterval(timer); clearTimeout(watchdog); unsubscribe?.(); }
  };
}

export const reloadTool = (reload) => ({
  name: "oneagent_reload_plugin",
  description: "Reload the installed OneAgent plugin in THIS Copilot conversation, without installing again or clearing chat history. OneAgent automatically prepares and reopens its canvases; unsaved editors defer the operation until saved or dismissed. The host refreshes its plugin paths, skills, MCP connections and extension processes; other extensions/MCP in this chat may restart too. Verify oneagent_update_status afterwards: currentVersion must equal installedVersion and reloadRequired must be false. A scheduled reload is not proof that the new runtime loaded.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: (args) => {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("Aucun paramètre attendu.");
    return reload.request();
  }
});
