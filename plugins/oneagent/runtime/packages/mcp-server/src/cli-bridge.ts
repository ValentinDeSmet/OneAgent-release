import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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
  requireMemoryConfig(configPath);
  return JSON.parse(await runCliRequest(path.dirname(configPath), [...args, "--config", configPath, "--json"], input));
}

/** Initialize only a directory reserved by the onboarding service, using the shared CLI. */
export async function initializeMemory(directory: string): Promise<void> {
  await runCliRequest(directory, ["init"]);
}

async function runCliRequest(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // One short-lived worker per operation reuses the same CLI as VS Code. CLI main()
    // acquires/releases the shared lock. An idle MCP connection owns no DB or lock.
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, "daemon"], {
      cwd, stdio: ["pipe", "pipe", "pipe"], shell: false
    });
    let stdout = "";
    let bytes = 0;
    let failed = false;
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT) failed = true;
      else stdout += chunk;
    });
    // Drain diagnostics without returning raw process output or polluting MCP stdout.
    child.stderr.resume();
    child.on("close", (code, signal) => {
      try {
        if (code !== 0) throw new Error(`OneAgent worker stopped (${signal ?? code}). Check memory state before retrying a write.`);
        if (failed) throw new Error("OneAgent response exceeds 16 MiB. Narrow the requested entity or search.");
        const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
        const response = messages.find((message) => message.id === 1);
        if (!response) throw new Error("OneAgent worker returned no response.");
        if (!response.ok) throw new Error(String(response.error ?? "OneAgent operation failed."));
        resolve(response.stdout);
      } catch (error) { reject(error); }
    });
    // EOF makes the daemon drain its request and close every runtime normally.
    // Do not retry writes or kill a worker on client cancellation: it may have committed.
    child.stdin.end(JSON.stringify({ id: 1, args, input }) + "\n");
  });
}
