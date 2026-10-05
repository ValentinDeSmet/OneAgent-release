import fs from "node:fs";
import path from "node:path";
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

/** A canvas may be hosted by an app executable; it is not necessarily a Node CLI.
 * Do not launch that app a second time with the memory request as stdin. */
export function nodeCandidates(options: { execPath?: string; versions?: Record<string, string | undefined>; env?: NodeJS.ProcessEnv } = {}): string[] {
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
    throw new Error(`Démarrage OneAgent impossible avant toute requête mémoire. ${failures[0] ?? "Aucun exécutable Node.js trouvé. Rendre Node.js ≥ 22.18 accessible à Copilot, ou définir ONEAGENT_NODE_PATH avec son chemin absolu."}`);
  })();
  cached = { key, result };
  void result.catch(() => { if (cached?.result === result) cached = undefined; });
  return result;
}
