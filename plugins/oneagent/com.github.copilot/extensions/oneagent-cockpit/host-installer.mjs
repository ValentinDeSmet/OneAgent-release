/** Use the joined app's account, network and policy; no terminal CLI is needed. */
export function createHostInstaller(session) {
  const invoke = async (operation, message) => {
    try { return await operation(); }
    catch (error) {
      const unsupported = error?.code === -32601 || /method not found|unknown method/i.test(error?.message || "");
      throw Object.assign(new Error("Copilot management request failed"), { userMessage: unsupported
        ? "L’application Copilot ne prend pas encore en charge cette API de mise à jour. Mettre à jour Copilot avant de réessayer."
        : message });
    }
  };
  return async (args) => {
    const plugins = (await session()).rpc?.plugins;
    if (![plugins?.list, plugins?.update, plugins?.marketplaces?.refresh, plugins?.reload].every(value => typeof value === "function")) {
      throw Object.assign(new Error("Host update API unavailable"), { userMessage: "Cette version de Copilot ne fournit pas les API de mise à jour intégrée. Mettre à jour l’application Copilot ; aucune installation OneAgent n’a été lancée." });
    }
    switch (args.join(" ")) {
      case "plugin list --json": {
        const result = await invoke(() => plugins.list(), "Copilot n’a pas pu lire les plugins installés. Vérifie le gestionnaire de plugins ; aucune installation lancée.");
        if (!Array.isArray(result?.plugins)) throw new Error("Copilot n’a pas fourni la liste des plugins installés.");
        return JSON.stringify(result.plugins);
      }
      case "plugin marketplace update oneagent": {
        const result = await invoke(() => plugins.marketplaces.refresh({ name: "oneagent" }), "Copilot n’a pas pu actualiser le catalogue OneAgent. Vérifie son accès GitHub ; aucune installation lancée.");
        if (result?.results?.length !== 1 || result.results[0].name !== "oneagent" || result.results[0].success !== true) throw new Error("Copilot n’a pas confirmé l’actualisation du catalogue OneAgent. Aucune installation lancée.");
        return "";
      }
      case "plugin update oneagent":
        await invoke(() => plugins.update({ name: "oneagent@oneagent" }), "Copilot n’a pas confirmé l’installation. Utilise Réessayer le rechargement pour charger les fichiers présents ; l’installation ne sera pas rejouée.");
        return "";
      default: throw new Error("Opération de mise à jour inconnue.");
    }
  };
}
