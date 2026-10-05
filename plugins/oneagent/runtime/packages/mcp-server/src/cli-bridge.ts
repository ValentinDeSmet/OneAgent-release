import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveWorkerNode, workerDiagnostic } from "./node-runtime.ts";

const CLI = path.resolve(import.meta.dirname, "../../cli/src/index.ts");
const MAX_OUTPUT = 16 * 1024 * 1024;

/** A host must bind an existing memory explicitly; never discover one in a product cwd. */
export function requireMemoryConfig(value: string | undefined): string {
  if (!value || !path.isAbsolute(value) || !fs.statSync(value, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Le fichier de configuration OneAgent doit être un fichier existant avec un chemin absolu.");
  }
  return path.normalize(value);
}

/** Internal bridge only. The public MCP surface cannot supply CLI commands or flags. */
export async function runMemoryCommand(configPath: string, args: string[], input?: string): Promise<unknown> {
  return JSON.parse(await runMemoryTextCommand(configPath, [...args, "--json"], input));
}

/** Host controller bridge, never exposed as an agent-callable arbitrary CLI tool. */
export async function runMemoryTextCommand(configPath: string, args: string[], input?: string): Promise<string> {
  requireMemoryConfig(configPath);
  return runCliRequest(path.dirname(configPath), [...args, "--config", configPath], input);
}

/** Initialize only a directory reserved by the onboarding service, using the shared CLI. */
export async function initializeMemory(directory: string): Promise<void> {
  await runCliRequest(directory, ["init"]);
}

async function runCliRequest(cwd: string, args: string[], input?: string): Promise<string> {
  const node = await resolveWorkerNode();
  return new Promise((resolve, reject) => {
    // One short-lived worker per operation reuses the same CLI as VS Code. CLI main()
    // acquires/releases the shared lock. An idle MCP connection owns no DB or lock.
    const child = spawn(node, ["--disable-warning=ExperimentalWarning", CLI, "daemon"], {
      cwd, stdio: ["pipe", "pipe", "pipe"], shell: false
    });
    let stdout = "", stderr = "", lineBuffer = "";
    let bytes = 0;
    let failed = false;
    let sent = false, aborted = false;
    const failure = (detail: string): Error => new Error(sent
      ? `Le moteur OneAgent s’est arrêté après l’envoi de la requête. ${detail} Vérifier son résultat avant de relancer une écriture ; aucune répétition automatique.`
      : `Démarrage OneAgent impossible avant toute requête mémoire. ${detail}`);
    const startupTimer = setTimeout(() => { if (!sent) { aborted = true; child.kill(); reject(failure("Le moteur n’a pas confirmé son démarrage dans les 15 secondes.")); } }, 15000);
    child.on("error", (error: NodeJS.ErrnoException) => { clearTimeout(startupTimer); reject(failure(workerDiagnostic("", error.code))); });
    // An EPIPE is followed by close; keep its exit diagnostic instead of leaking
    // a raw system error or retrying a possibly delivered write.
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT) failed = true;
      else {
        stdout += chunk;
        if (!sent && !aborted) {
          lineBuffer += chunk;
          let end;
          while (!sent && (end = lineBuffer.indexOf("\n")) !== -1) {
            const line = lineBuffer.slice(0, end); lineBuffer = lineBuffer.slice(end + 1);
            let message;
            try { message = JSON.parse(line); } catch { continue; }
            if (message?.ready === true) {
              clearTimeout(startupTimer); sent = true;
              // EOF drains the daemon. Never send a request to an unready worker.
              child.stdin.end(JSON.stringify({ id: 1, args, input }) + "\n");
            }
          }
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-16384); });
    child.on("close", (code, signal) => {
      clearTimeout(startupTimer);
      try {
        if (code !== 0) throw failure(`Arrêt ${signal ?? code}. ${workerDiagnostic(stderr)}`);
        if (failed) throw new Error("OneAgent response exceeds 16 MiB. Narrow the requested entity or search.");
        let messages;
        try { messages = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
        catch { throw failure("Réponse du moteur invalide."); }
        const response = messages.find((message) => message?.id === 1);
        if (!response) throw failure("Le moteur n’a renvoyé aucune réponse exploitable.");
        if (!response.ok) throw new Error(String(response.error ?? "OneAgent operation failed."));
        resolve(response.stdout);
      } catch (error) { reject(error); }
    });
    // Do not kill or retry a worker after sending a request: it may have committed.
  });
}
