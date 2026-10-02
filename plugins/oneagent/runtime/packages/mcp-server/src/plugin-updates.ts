import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { readCopilotSettings, saveMarketplace } from "./copilot-settings.ts";

export const RELEASE_REPOSITORY = "ValentinDeSmet/OneAgent-release";
export const MARKETPLACE = "oneagent";
const source = { source: "github", repo: RELEASE_REPOSITORY };
const catalogueUrl = `https://api.github.com/repos/${RELEASE_REPOSITORY}/contents/marketplace.json`;
const runtimeRoot = path.resolve(import.meta.dirname, "../../..");
const pluginRoot = path.dirname(runtimeRoot);
const manifestPath = fs.existsSync(path.join(pluginRoot, "plugin.json"))
  ? path.join(pluginRoot, "plugin.json") : path.join(runtimeRoot, "apps/copilot-plugin/plugin.json");
type Invoke = (args: string[]) => Promise<string>;
interface Options { home?: string; copilotHome?: string; currentVersion?: string; invoke?: Invoke; fetch?: typeof fetch; }
const object = (value: any): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const officialSource = (value: unknown): boolean => {
  if (!object(value)) return false;
  if (value.source === "github") return typeof value.repo === "string"
    && value.repo.toLowerCase() === RELEASE_REPOSITORY.toLowerCase()
    && Object.keys(value).every((key) => key === "source" || key === "repo");
  if (value.source === "git") return typeof value.url === "string"
    && [`https://github.com/${RELEASE_REPOSITORY}`, `https://github.com/${RELEASE_REPOSITORY}.git`].some((url) => url.toLowerCase() === value.url.toLowerCase().replace(/\/$/, ""))
    && Object.keys(value).every((key) => key === "source" || key === "url");
  return false;
};
const version = (value: unknown): number[] => {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error("Version stable OneAgent invalide.");
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error("Version OneAgent invalide.");
  return parts;
};
export const newerVersion = (next: string, current: string): boolean => {
  const a = version(next), b = version(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** Installation belongs to Copilot; the running memory server never rewrites its own files. */
export class PluginUpdates {
  readonly settingsPath: string;
  readonly currentVersion: string;
  private readonly invoke: Invoke;
  private readonly request: typeof fetch;
  private restart = false;
  private readonly inspectManifest: boolean;

  constructor(options: Options = {}) {
    const home = options.home ?? os.homedir();
    const copilotHome = options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(home, ".copilot");
    this.settingsPath = path.join(copilotHome, "settings.json");
    if (!path.isAbsolute(copilotHome)) throw new Error("COPILOT_HOME doit désigner un dossier absolu.");
    this.currentVersion = options.currentVersion ?? JSON.parse(fs.readFileSync(manifestPath, "utf8")).version;
    this.inspectManifest = options.currentVersion === undefined;
    version(this.currentVersion);
    this.request = options.fetch ?? fetch;
    this.invoke = options.invoke ?? ((args) => new Promise((resolve, reject) => {
      const child = execFile("copilot", args, {
        cwd: home, env: { ...process.env, COPILOT_HOME: copilotHome },
        encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000
      }, (error, stdout) => {
        if (error) reject(new Error((error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Copilot CLI est introuvable. Installer le CLI et le rendre accessible à l’application pour utiliser cette commande."
          : "Copilot n’a pas terminé l’opération. Vérifier ses règles d’entreprise et son accès GitHub ; consulter le gestionnaire de plugins avant de réessayer."));
        else resolve(stdout);
      });
      child.stdin?.end(); // Host management must not wait for terminal input from MCP.
    }));
  }

  assertSessionCurrent(): void {
    if (this.inspectManifest) {
      try { if (JSON.parse(fs.readFileSync(manifestPath, "utf8")).version !== this.currentVersion) this.restart = true; }
      catch { this.restart = true; }
    }
    if (this.restart) throw new Error("Une mise à jour du plugin a été lancée. Ouvrir une nouvelle session Copilot avant d’utiliser la mémoire ; ne pas relancer automatiquement l’installation.");
  }

  status(): Record<string, unknown> {
    const { value } = readCopilotSettings(this.settingsPath);
    const entry = value.extraKnownMarketplaces?.[MARKETPLACE];
    const official = officialSource(entry?.source);
    return {
      currentVersion: this.currentVersion, marketplace: MARKETPLACE,
      marketplaceUrl: `https://github.com/${RELEASE_REPOSITORY}`,
      automaticUpdates: official && typeof entry?.autoUpdate === "boolean" ? entry.autoUpdate : null,
      officialSourceConfigured: official,
      restartRequired: this.restart,
      automaticUpdateScope: "Préférence utilisateur pour les sessions Copilot CLI compatibles. Les politiques d’entreprise priment. Le déclenchement automatique dans l’application macOS reste à valider.",
      globallyDisabled: value.autoUpdate === false || process.env.COPILOT_AUTO_UPDATE === "false"
    };
  }

  configure(automatic: boolean): Record<string, unknown> {
    const { raw, value } = readCopilotSettings(this.settingsPath);
    const markets = value.extraKnownMarketplaces;
    if (markets !== undefined && !object(markets)) throw new Error("Le catalogue Copilot existant est invalide ; aucun réglage remplacé.");
    const entry = markets?.[MARKETPLACE];
    if (entry !== undefined && (!object(entry) || !officialSource(entry.source))) {
      throw new Error("Un autre catalogue utilise déjà le nom oneagent. Vérifier sa source dans Copilot ; il ne sera pas remplacé.");
    }
    saveMarketplace(this.settingsPath, raw, MARKETPLACE, { ...entry, source: entry?.source ?? source, autoUpdate: automatic });
    return { ...this.status(), saved: true, message: "Préférence OneAgent enregistrée pour les prochaines sessions compatibles. Aucun réglage BMAD, aucune permission ni mémoire modifiés." };
  }

  async check(): Promise<Record<string, unknown>> {
    const response = await this.request(catalogueUrl, {
      headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "OneAgent-Copilot" },
      signal: AbortSignal.timeout(10000), redirect: "error"
    });
    if (!response.ok) throw new Error(response.status === 404
      ? "Le catalogue OneAgent n’est pas encore publié. Le plugin installé reste utilisable."
      : "Impossible de vérifier le catalogue GitHub. Le plugin installé reste utilisable ; réessayer plus tard.");
    if (!response.body) throw new Error("Catalogue GitHub vide.");
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; if (size > 65536) throw new Error("Catalogue GitHub trop volumineux."); chunks.push(chunk);
    }
    const catalogue = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const entries = catalogue?.plugins?.filter((item: any) => item.name === "oneagent");
    const plugin = entries?.[0];
    if (catalogue?.name !== MARKETPLACE || entries?.length !== 1 || !object(plugin?.source)
      || plugin.source.source !== "github" || plugin.source.repo !== RELEASE_REPOSITORY
      || plugin.source.path !== "plugins/oneagent" || !/^[a-f0-9]{40}$/.test(plugin.source.sha)) {
      throw new Error("Le catalogue publié ne correspond pas à la distribution OneAgent attendue.");
    }
    version(plugin.version);
    return { ...this.status(), latestVersion: plugin.version,
      updateAvailable: newerVersion(plugin.version, this.currentVersion),
      releaseUrl: `https://github.com/${RELEASE_REPOSITORY}/releases`, checked: true };
  }

  async update(): Promise<Record<string, unknown>> {
    this.assertSessionCurrent();
    const available = await this.check();
    if (!available.updateAvailable) return { ...available, updated: false };
    if (!available.officialSourceConfigured) throw new Error("Configurer d’abord les mises à jour OneAgent (automatiques ou manuelles) pour relier le catalogue officiel. Aucun plugin modifié.");
    const installed = JSON.parse(await this.invoke(["plugin", "list", "--json"]));
    const matches = Array.isArray(installed) ? installed.filter((item) => item.name === "oneagent") : [];
    if (matches.length !== 1 || matches[0].marketplace !== MARKETPLACE || matches[0].enabled === false) {
      throw new Error("Installer ou activer OneAgent depuis le catalogue officiel avant de le mettre à jour. Pour une ancienne installation ZIP, suivre le passage au catalogue décrit dans le guide ; aucun plugin n’a été désinstallé.");
    }
    // Refresh is distinct from installation. Both operations are scoped to OneAgent.
    await this.invoke(["plugin", "marketplace", "update", MARKETPLACE]);
    this.restart = true; // Also after an uncertain/partial failure: no mixed runtime.
    await this.invoke(["plugin", "update", "oneagent"]);
    const after = JSON.parse(await this.invoke(["plugin", "list", "--json"]));
    const item = Array.isArray(after) ? after.find((item) => item.name === "oneagent" && item.marketplace === MARKETPLACE) : undefined;
    if (!item || !newerVersion(item.version, this.currentVersion) || newerVersion(String(available.latestVersion), item.version)) {
      throw new Error("Copilot n’a pas confirmé la version attendue. Ouvrir une nouvelle session et vérifier le gestionnaire de plugins.");
    }
    return { updated: true, installedVersion: item.version, restartRequired: true,
      message: "Mise à jour installée par Copilot. Ouvrir une nouvelle session pour charger le plugin et son skill. La liaison de mémoire est conservée." };
  }
}

const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = [], readOnly = true) => ({
  name, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: true }
});
export const updateTools = [
  tool("oneagent_update_status", "Read the installed plugin version and user update preference without network access or memory access. Use during onboarding to offer updates once; null means not chosen yet."),
  tool("oneagent_check_updates", "Check the official OneAgent GitHub catalogue for a stable plugin update. Does not install or change settings."),
  tool("oneagent_configure_updates", "Save the user's automatic/manual update choice for only the official OneAgent marketplace in Copilot user settings. Preserve other settings and company policies. CLI automation is documented; macOS app automation remains to be validated.", { automatic: { type: "boolean" } }, ["automatic"], false),
  tool("oneagent_update_plugin", "After the user requests a plugin update, let Copilot CLI refresh and update only OneAgent from its official marketplace. Requires a new session afterwards, including after uncertain installation errors. Never retry automatically or uninstall other plugins.", {}, [], false)
];
export async function callUpdateTool(updates: PluginUpdates, name: string, raw: unknown): Promise<unknown> {
  const definition = updateTools.find((tool) => tool.name === name);
  if (!definition || !object(raw)) throw new Error("Invalid update tool arguments.");
  if (Object.keys(raw).some((key) => !Object.hasOwn(definition.inputSchema.properties, key))) throw new Error("Unknown update argument.");
  if (name === "oneagent_update_status") return updates.status();
  if (name === "oneagent_check_updates") return updates.check();
  if (name === "oneagent_configure_updates") {
    if (typeof raw.automatic !== "boolean") throw new Error("Choose automatic true or false.");
    return updates.configure(raw.automatic);
  }
  return updates.update();
}
