const fs = require("node:fs");
const path = require("node:path");

// Read only the location fields understood by the runtime's existing JSON/simple
// YAML parser. This avoids opening a runtime (and running migrations) for watchers.
function readMemoryLocations(configPath) {
  const absolute = path.resolve(configPath);
  const raw = fs.readFileSync(absolute, "utf8");
  let memoryRoot = ".work-memory";
  let databasePath = ".work-memory/work-memory.db";
  if (raw.trim().startsWith("{")) {
    const config = JSON.parse(raw);
    memoryRoot = config.workspace?.memoryRoot ?? memoryRoot;
    databasePath = config.storage?.databasePath ?? databasePath;
  } else {
    let section = "";
    for (const original of raw.split(/\r?\n/)) {
      const line = original.replace(/\s+#.*$/, "");
      if (/^[^\s].*:$/.test(line)) section = line.slice(0, -1);
      const field = line.match(/^\s+(memoryRoot|databasePath):\s*(.*)$/);
      if (!field) continue;
      const value = field[2].replace(/^["']|["']$/g, "");
      if (section === "workspace" && field[1] === "memoryRoot") memoryRoot = value;
      if (section === "storage" && field[1] === "databasePath") databasePath = value;
    }
  }
  if (typeof memoryRoot !== "string" || typeof databasePath !== "string") throw new Error("Invalid OneAgent memory paths.");
  const configDirectory = path.dirname(absolute);
  const workspaceRoot = path.basename(configDirectory) === path.basename(memoryRoot) ? path.dirname(configDirectory) : configDirectory;
  return { workspaceRoot, memoryRoot: path.resolve(workspaceRoot, memoryRoot), databasePath: path.resolve(workspaceRoot, databasePath) };
}

module.exports = { readMemoryLocations };
