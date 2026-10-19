import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

const marker = "ONEAGENT_NODE_PROBE=";
const probe = `try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 18 || !process.features.typescript) throw Object.assign(new Error(), {code:'NODE_VERSION'});
  const {DatabaseSync} = await import('node:sqlite');
  const db = new DatabaseSync(':memory:'); db.close();
  console.log('${marker}'+JSON.stringify({ok:true}));
} catch (error) { console.log('${marker}'+JSON.stringify({ok:false,code:error.code})); process.exitCode=1; }`;

const executable = (file: string): boolean => {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
};

type NodeLocations = {
  env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform;
  /** Installation prefixes, injectable so tests never rely on the developer's Node. */
  installRoots?: string[];
};

/** Fixed installation layouts only. No shell startup files, recursive disk search,
 * downloads, or application executables are run to discover a worker. */
export function installedNodeCandidates(options: NodeLocations = {}): string[] {
  const env = options.env ?? process.env, home = options.home ?? os.homedir(), platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return [];
  const candidates: string[] = [];
  const absolute = (directory: string | undefined): directory is string => Boolean(directory && path.isAbsolute(directory));
  const add = (directory: string | undefined, ...parts: string[]) => { if (absolute(directory)) candidates.push(path.join(directory, ...parts, "node")); };
  const versions = (root: string | undefined, suffix: string[]) => {
    if (!absolute(root)) return;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(entry.name))
        .sort((a, b) => b.name.replace(/^v/, "").localeCompare(a.name.replace(/^v/, ""), "en", { numeric: true }));
      for (const entry of entries.slice(0, 8)) add(root, entry.name, ...suffix);
    } catch { /* An absent or inaccessible optional installation is not a memory error. */ }
  };
  const manager = (type: string, root: string | undefined) => {
    if (!absolute(root)) return;
    switch (type) {
      case "nvm": versions(path.join(root, "versions/node"), ["bin"]); break;
      case "fnm": versions(path.join(root, "node-versions"), ["installation", "bin"]); break;
      case "volta": versions(path.join(root, "tools/image/node"), ["bin"]); break;
      case "asdf": versions(path.join(root, "installs/nodejs"), ["bin"]); break;
      case "mise": versions(path.join(root, "installs/node"), ["bin"]); break;
      case "nodenv": versions(path.join(root, "versions"), ["bin"]); break;
    }
  };
  // Honor configured manager locations before looking in default locations.
  for (const [type, key] of [["nvm", "NVM_DIR"], ["fnm", "FNM_DIR"], ["volta", "VOLTA_HOME"], ["asdf", "ASDF_DATA_DIR"], ["mise", "MISE_DATA_DIR"], ["nodenv", "NODENV_ROOT"]]) manager(type, env[key]);
  const roots = [env.HOMEBREW_PREFIX, ...(options.installRoots ?? (platform === "darwin" ? ["/opt/homebrew", "/usr/local"] : ["/usr/local", "/usr"]))].filter(absolute);
  for (const root of roots) {
    add(root, "bin");
    // A keg-only Homebrew Node may have no bin/node symlink in the prefix.
    try {
      const packages = fs.readdirSync(path.join(root, "opt"), { withFileTypes: true })
        .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && /^node(?:@\d+)?$/.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }));
      for (const entry of packages.slice(0, 8)) add(root, "opt", entry.name, "bin");
    } catch { /* Not a Homebrew prefix. */ }
  }
  if (absolute(home)) {
    manager("nvm", path.join(home, ".nvm"));
    manager("fnm", path.join(home, "Library/Application Support/fnm"));
    manager("fnm", path.join(home, ".local/share/fnm"));
    manager("volta", path.join(home, ".volta"));
    manager("asdf", path.join(home, ".asdf"));
    manager("mise", path.join(home, ".local/share/mise"));
    manager("nodenv", path.join(home, ".nodenv"));
    add(home, "n", "bin");
  }
  return [...new Set(candidates)].filter(executable);
}

/** A canvas may be hosted by an app executable; it is not necessarily a Node CLI.
 * Do not launch that app a second time with the memory request as stdin. */
export function nodeCandidates(options: NodeLocations & { execPath?: string; versions?: Record<string, string | undefined> } = {}): string[] {
  const env = options.env ?? process.env, host = options.execPath ?? process.execPath, versions = options.versions ?? process.versions;
  if (env.ONEAGENT_NODE_PATH) {
    if (!path.isAbsolute(env.ONEAGENT_NODE_PATH)) throw new Error("ONEAGENT_NODE_PATH doit désigner un exécutable Node.js avec un chemin absolu.");
    return [env.ONEAGENT_NODE_PATH];
  }
  const candidates: string[] = [];
  if (/^node(?:\.exe)?$/i.test(path.basename(host)) && !versions.electron && !versions.bun) candidates.push(host);
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (path.isAbsolute(directory)) candidates.push(path.join(directory, process.platform === "win32" ? "node.exe" : "node"));
  }
  candidates.push(...installedNodeCandidates(options));
  return [...new Set(candidates)].filter(executable);
}

/** Return fixed diagnostic categories only: stderr can contain paths, secrets or notes. */
export function workerDiagnostic(stderr: string, code?: string): string {
  const has = (value: string) => code === value || new RegExp(`\\b${value}\\b`).test(stderr);
  if (has("NODE_VERSION") || has("ERR_UNKNOWN_FILE_EXTENSION")) return "Node.js incompatible : OneAgent exige Node.js ≥ 22.18 avec la prise en charge TypeScript active.";
  if (has("ERR_UNKNOWN_BUILTIN_MODULE") && stderr.includes("sqlite")) return "Le moteur Node.js ne fournit pas node:sqlite, nécessaire à OneAgent.";
  if (has("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING")) return "Node.js refuse le runtime TypeScript installé dans node_modules. Vérifier l’emplacement d’installation du plugin.";
  if (has("ERR_MODULE_NOT_FOUND") || has("MODULE_NOT_FOUND")) return "Un module du moteur OneAgent est introuvable. Vérifier l’intégrité du paquet installé.";
  if (has("ERR_ACCESS_DENIED") || has("EACCES") || has("EPERM") || /Operation not permitted|Permission denied/.test(stderr)) return "L’accès au moteur est refusé par le système ou les permissions de l’hôte.";
  if (has("ENOENT")) return "L’exécutable Node.js ou le dossier de travail est introuvable.";
  if (/bad option|unknown option|unrecognized option/i.test(stderr)) return "L’exécutable utilisé ne reconnaît pas les options Node.js nécessaires.";
  if (has("ERR_DLOPEN_FAILED")) return "Une bibliothèque native du moteur Node.js ne peut pas être chargée.";
  return "La cause n’est pas identifiée ; ce message ne démontre pas un problème de base de données.";
}

let cached: { key: string; result: Promise<string> } | undefined;
export function resolveWorkerNode(): Promise<string> {
  const candidates = nodeCandidates(), key = JSON.stringify([candidates, process.env.NODE_OPTIONS, process.env.NODE_EXTRA_CA_CERTS]);
  if (cached?.key === key) return cached.result;
  const result = (async () => {
    const failures: string[] = [];
    for (const command of candidates) {
      const diagnosis = await new Promise<string | undefined>((resolve) => {
        execFile(command, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8", timeout: 10000, maxBuffer: 16384 }, (error, stdout, stderr) => {
          let report;
          try { report = JSON.parse(stdout.split("\n").find(line => line.startsWith(marker))?.slice(marker.length) ?? "null"); } catch { /* invalid probe reply */ }
          if (!error && report?.ok === true) return resolve(undefined);
          resolve(workerDiagnostic(stderr + (report?.code === "ERR_UNKNOWN_BUILTIN_MODULE" ? " sqlite" : ""), report?.code ?? (error as NodeJS.ErrnoException | null)?.code));
        });
      });
      if (!diagnosis) return command;
      failures.push(diagnosis);
    }
    throw new Error(`Démarrage OneAgent impossible avant toute requête mémoire. ${failures[0] ?? "Aucun exécutable Node.js trouvé dans le PATH ou les emplacements d’installation reconnus. Installer Node.js ≥ 22.18, ou définir ONEAGENT_NODE_PATH avec le chemin absolu d’une installation existante."}`);
  })();
  cached = { key, result };
  void result.catch(() => { if (cached?.result === result) cached = undefined; });
  return result;
}
