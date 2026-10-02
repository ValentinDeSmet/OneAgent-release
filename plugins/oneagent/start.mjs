import fs from "node:fs";

try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error("OneAgent requires Node.js >=22.18.");
  const runtime = new URL("./runtime/packages/mcp-server/src/stdio.ts", import.meta.url);
  if (!fs.existsSync(runtime)) throw new Error("Missing OneAgent runtime. Build the plugin with pnpm copilot:prepare and install the generated directory.");
  // The server must be discoverable before a memory is chosen. Its onboarding
  // tools read/save the binding after installation, without restarting this host.
  await import(runtime.href);
} catch (error) {
  console.error(error instanceof Error ? error.message : "OneAgent plugin failed to start.");
  process.exitCode = 1;
}
