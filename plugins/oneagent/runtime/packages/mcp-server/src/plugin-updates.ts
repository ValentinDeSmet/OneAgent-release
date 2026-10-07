import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { RuntimeReload } from "./runtime-reload.ts";
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
interface Options { home?: string; copilotHome?: string; currentVersion?: string; invoke?: Invoke; fetch?: typeof fetch; manifestPath?: string; }
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

/** Only an unavailable lookup permits the UI to offer Copilot's own installer.
 * A malformed/unexpected catalogue is a different error and must not be ignored. */
class CatalogueLookupError extends Error {
  readonly canUpdateWithCopilot = true;
}
function catalogueNetworkError(error: unknown): Error {
  const codes = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || depth > 4) return;
    const item = value as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof item.code === "string") codes.add(item.code);
    if (item.name === "TimeoutError" || item.name === "AbortError") codes.add("ETIMEDOUT");
    visit(item.cause, depth + 1);
    if (Array.isArray(item.errors)) for (const nested of item.errors.slice(0, 8)) visit(nested, depth + 1);
  };
  visit(error);
  const certificate = ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].find(code => codes.has(code));
  const dns = ["ENOTFOUND", "EAI_AGAIN"].find(code => codes.has(code));
  const timeout = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].find(code => codes.has(code));
  const network = ["ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].find(code => codes.has(code));
  const detail = certificate ? `Certificat TLS refusé (${certificate}) ; vérifier la confiance du certificat d’entreprise pour Node.js.`
    : dns ? `Résolution DNS impossible (${dns}) ; vérifier le réseau ou le proxy du poste.`
    : timeout ? `Délai de connexion dépassé (${timeout}) ; vérifier le réseau ou le proxy du poste.`
    : network ? `Connexion réseau interrompue (${network}) ; vérifier le réseau ou le proxy du poste.`
    : "Connexion réseau impossible (fetch failed) ; le détail fourni ne permet pas de distinguer réseau, proxy ou certificat.";
  return new CatalogueLookupError(`La vérification du catalogue sur api.github.com a échoué avant toute installation. ${detail} Le plugin et la mémoire restent utilisables ; ouvrir un nouveau chat ne répare pas cet accès réseau. La mise à jour peut être demandée directement à Copilot avec oneagent_update_plugin ou les commandes copilot plugin marketplace update oneagent puis copilot plugin update oneagent.`);
}

/** Installation belongs to Copilot; the running memory server never rewrites its own files. */
export class PluginUpdates {
  readonly settingsPath: string;
  readonly currentVersion: string;
  private readonly invoke: Invoke;
  private readonly request: typeof fetch;
  private restart = false;
  readonly reload: RuntimeReload;
  private readonly manifest: string | undefined;
  private readonly initialRequest: string | undefined;

  constructor(options: Options = {}) {
    const home = options.home ?? os.homedir();
    const copilotHome = options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(home, ".copilot");
    this.settingsPath = path.join(copilotHome, "settings.json");
    if (!path.isAbsolute(copilotHome)) throw new Error("COPILOT_HOME doit désigner un dossier absolu.");
    this.manifest = options.manifestPath ?? (options.currentVersion === undefined ? manifestPath : undefined);
    this.currentVersion = options.currentVersion ?? JSON.parse(fs.readFileSync(this.manifest!, "utf8")).version;
    this.reload = new RuntimeReload(path.join(copilotHome, "oneagent-runtime"), this.currentVersion);
    this.initialRequest = this.reload.request()?.id;
    version(this.currentVersion);
    this.request = options.fetch ?? fetch;
    this.invoke = options.invoke ?? ((args) => new Promise((resolve, reject) => {
      const child = execFile("copilot", args, {
        cwd: home, env: { ...process.env, COPILOT_HOME: copilotHome },
        encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000
      }, (error, stdout) => {
        if (error) reject(new Error((error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Copilot CLI est introuvable. Installer le CLI et le rendre accessible à l’application pour utiliser cette commande."
          : args[0] === "plugin" && args[1] === "update"
            ? "Copilot n’a pas confirmé la fin de l’installation. Consulter le gestionnaire de plugins, puis recharger les plugins dans cette conversation, sans relancer automatiquement l’installation."
            : "Copilot n’a pas terminé la lecture ou l’actualisation du catalogue, avant installation. Vérifier son accès GitHub et ses règles d’entreprise. Aucun redémarrage de session requis pour cet échec."));
        else resolve(stdout);
      });
      child.stdin?.end(); // Host management must not wait for terminal input from MCP.
    }));
  }

  reloadRequired(): boolean {
    if (this.manifest) {
      try { if (JSON.parse(fs.readFileSync(this.manifest, "utf8")).version !== this.currentVersion) this.restart = true; }
      catch { this.restart = true; }
    }
    const request = this.reload.request();
    if (request && (request.installedVersion ? newerVersion(request.installedVersion, this.currentVersion) : request.id !== this.initialRequest)) this.restart = true;
    return this.restart;
  }

  assertSessionCurrent(): void {
    if (this.reloadRequired()) throw new Error("OneAgent attend son rechargement dans cette conversation. Enregistrer les brouillons puis fermer les Canvas OneAgent ; le plugin demandera à Copilot de recharger ses outils ici. Sinon demander à Copilot de recharger les plugins, extensions et serveurs MCP dans ce chat. Ne pas relancer l’installation ni fermer le chat.");
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const end = this.reload.begin();
    try { this.assertSessionCurrent(); return await operation(); }
    finally { end(); }
  }

  status(): Record<string, unknown> {
    const reloadRequired = this.reloadRequired();
    const target = this.reload.request()?.installedVersion;
    let installedVersion = target && newerVersion(target, this.currentVersion) ? target : this.currentVersion;
    if (this.manifest) {
      try {
        const disk = JSON.parse(fs.readFileSync(this.manifest, "utf8")).version;
        if (newerVersion(disk, installedVersion)) installedVersion = disk;
      } catch { /* Reload/manager inspection still required; do not claim success. */ }
    }
    const { value } = readCopilotSettings(this.settingsPath);
    const entry = value.extraKnownMarketplaces?.[MARKETPLACE];
    const official = officialSource(entry?.source);
    return {
      currentVersion: this.currentVersion, marketplace: MARKETPLACE,
      marketplaceUrl: `https://github.com/${RELEASE_REPOSITORY}`,
      automaticUpdates: official && typeof entry?.autoUpdate === "boolean" ? entry.autoUpdate : null,
      officialSourceConfigured: official,
      restartRequired: false, reloadRequired,
      installedVersion: target === null && reloadRequired ? null : installedVersion,
      reloadMode: "current_conversation",
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
    let response: Response;
    try {
      response = await this.request(catalogueUrl, {
        headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "OneAgent-Copilot" },
        signal: AbortSignal.timeout(10000), redirect: "error"
      });
    } catch (error) { throw catalogueNetworkError(error); }
    if ([403, 429].includes(response.status) || response.status >= 500) throw new CatalogueLookupError(`La vérification du catalogue sur api.github.com a échoué (HTTP ${response.status}), avant installation. Le plugin reste utilisable. Demander la mise à jour directement à Copilot ; aucune nouvelle session n’est nécessaire pour cet échec de vérification.`);
    if (!response.ok) throw new Error(response.status === 404
      ? "Le catalogue OneAgent n’est pas encore publié. Le plugin installé reste utilisable."
      : "Impossible de vérifier le catalogue GitHub. Le plugin installé reste utilisable ; réessayer plus tard.");
    if (!response.body) throw new Error("Catalogue GitHub vide.");
    const chunks: Uint8Array[] = []; let size = 0;
    const tooLarge = new Error("Catalogue GitHub trop volumineux.");
    try {
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 65536) throw tooLarge; chunks.push(chunk);
      }
    } catch (error) { if (error === tooLarge) throw error; throw catalogueNetworkError(error); }
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
    const end = this.reload.begin();
    try {
      // The installer owns catalogue refresh and package retrieval. A separate
      // Node fetch to the GitHub API must not block Copilot's network configuration.
      if (!this.status().officialSourceConfigured) throw new Error("Configurer d’abord les mises à jour OneAgent (automatiques ou manuelles) pour relier le catalogue officiel. Aucun plugin modifié.");
      const installed = JSON.parse(await this.invoke(["plugin", "list", "--json"]));
      const matches = Array.isArray(installed) ? installed.filter((item) => item.name === "oneagent") : [];
      if (matches.length !== 1 || matches[0].marketplace !== MARKETPLACE || matches[0].enabled === false) {
        throw new Error("Installer ou activer OneAgent depuis le catalogue officiel avant de le mettre à jour. Pour une ancienne installation ZIP, suivre le passage au catalogue décrit dans le guide ; aucun plugin n’a été désinstallé.");
      }
      const beforeVersion = matches[0].version;
      version(beforeVersion);
      // Refresh is distinct from installation. Both operations are scoped to OneAgent.
      await this.invoke(["plugin", "marketplace", "update", MARKETPLACE]);
      this.restart = true; // Also after an uncertain/partial failure: no mixed runtime.
      await this.invoke(["plugin", "update", "oneagent"]);
      const after = JSON.parse(await this.invoke(["plugin", "list", "--json"]));
      const candidates = Array.isArray(after) ? after.filter((item) => item.name === "oneagent") : [];
      const item = candidates[0];
      if (candidates.length !== 1 || item.marketplace !== MARKETPLACE || item.enabled === false ||
        newerVersion(this.currentVersion, item.version) || newerVersion(beforeVersion, item.version)) {
        throw new Error("Copilot n’a pas confirmé une version valide. Vérifier le gestionnaire de plugins puis recharger les plugins dans ce chat ; ne pas répéter l’installation.");
      }
      const updated = newerVersion(item.version, this.currentVersion);
      this.restart = updated;
      if (updated) this.reload.requestReload(item.version);
      return { updated, installedVersion: item.version, runningVersion: this.currentVersion, restartRequired: false, reloadRequired: updated, reloadMode: "current_conversation",
        message: updated
          ? "Mise à jour installée par Copilot. OneAgent va demander le rechargement des plugins et outils dans cette conversation dès que ses opérations sont terminées et ses Canvas fermés. Enregistrer les brouillons avant de fermer les Canvas, puis les rouvrir si nécessaire. Le chat et la liaison de mémoire sont conservés. Si le rechargement automatique est indisponible, demander à Copilot de recharger les plugins, extensions et serveurs MCP ici, sans réinstaller."
          : `Copilot confirme OneAgent ${item.version} déjà installé après actualisation du catalogue. Aucune nouvelle session nécessaire.` };
    } catch (error) {
      if (this.restart) this.reload.requestReload(null);
      throw error;
    } finally { end(); }
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
  tool("oneagent_update_plugin", "After the user requests a plugin update, let Copilot CLI refresh and update only OneAgent from its official marketplace. Uses Copilot directly without requiring a separate GitHub API check. A failed catalogue lookup is not a reason to restart. A changed version schedules a host reload in this conversation after OneAgent operations finish and its canvases close. update_status reports running/currentVersion, installedVersion and reloadRequired. The extension exposes oneagent_reload_plugin for an explicit same-chat reload request; host support is experimental. Never require a new chat merely for an update, retry installation automatically, or uninstall other plugins.", {}, [], false)
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
