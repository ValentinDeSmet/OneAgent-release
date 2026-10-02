import { MemoryConnection } from "./onboarding.ts";
import { serveStdio } from "./protocol.ts";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--config")) throw new Error("Usage: stdio.ts [--config /absolute/config.yaml]");
  const connection = new MemoryConnection({
    configPath: args.length ? args[1] : process.env.ONEAGENT_CONFIG,
    settingsPath: process.env.ONEAGENT_COPILOT_SETTINGS
  });
  await serveStdio(connection);
} catch (error) {
  console.error(error instanceof Error ? error.message : "OneAgent MCP failed.");
  process.exitCode = 1;
}
