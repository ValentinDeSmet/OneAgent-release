import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
export const pluginRoot = path.resolve(import.meta.dirname, "../../..");
export const cockpitRoot = path.join(pluginRoot, "cockpit");
const { createCockpitRuntime } = require(path.join(cockpitRoot, "src/extension.js"));
const { createCopilotTools } = require(path.join(cockpitRoot, "src/copilot-tools.js"));
const { readMemoryLocations } = require(path.join(cockpitRoot, "src/memory-location.js"));
const { runMemoryTextCommand } = await import(pathToFileURL(path.join(pluginRoot, "runtime/packages/mcp-server/src/cli-bridge.ts")));
const { loadConfig } = await import(pathToFileURL(path.join(pluginRoot, "runtime/packages/registry/src/config.ts")));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const inside = (file, root) => file === root || file.startsWith(root + path.sep);

/** One UI instance, one injected host. No VS Code module or real workspace activation. */
export function createCockpitHost({ connection, updates, emit, runAgentLoop, runCommand = runMemoryTextCommand }) {
  const pending = new Map(), tools = new Map();
  let closed = false, cli, controller;
  let operationQueue = Promise.resolve();
  const log = [];
  const stateFile = path.join(path.dirname(connection.settingsPath), "copilot-cockpit.json");
  let state = {};
  if (fs.existsSync(stateFile)) {
    const stat = fs.lstatSync(stateFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Invalid cockpit settings file.");
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Invalid cockpit settings.");
  }
  const saveState = (key, value) => {
    // Read-merge-write preserves changes made by another open canvas.
    const latest = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
    state = { ...latest, [key]: value };
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temp = `${stateFile}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, stateFile);
  };
  const emitHost = (message) => emit({ type: "host", ...message });
  const output = {
    appendLine: (line) => { log.push(String(line)); if (log.length > 500) log.shift(); },
    show: () => emitHost({ kind: "document", title: "OneAgent · Journal", content: log.join("\n") })
  };
  const ask = (question) => {
    if (closed) return Promise.resolve(undefined);
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve(undefined); emitHost({ kind: "dismiss", id }); }, 10 * 60 * 1000);
      timer.unref();
      pending.set(id, { question, resolve: (value) => { clearTimeout(timer); resolve(value); } });
      emitHost({ kind: "dialog", id, ...question });
    });
  };
  const notify = async (level, message, ...rest) => {
    const options = typeof rest[0] === "object" && !Array.isArray(rest[0]) ? rest.shift() : {};
    if (!rest.length && !options.modal) { emitHost({ kind: "notice", level, message }); return undefined; }
    const answer = await ask({ mode: "choice", title: message, detail: options.detail, choices: rest.map((choice) => typeof choice === "string" ? choice : choice.title) });
    return Number.isInteger(answer) ? rest[answer] : undefined;
  };
  const input = async (options = {}) => {
    let error;
    for (;;) {
      const value = await ask({ mode: "input", title: options.title || options.prompt || "OneAgent", detail: options.prompt, value: options.value || "", placeholder: options.placeHolder, password: options.password, error });
      if (value === undefined) return undefined;
      if (typeof value !== "string") throw new Error("Invalid input response.");
      error = await options.validateInput?.(value);
      if (!error) return value;
      error = typeof error === "string" ? error : error.message;
      options = { ...options, value };
    }
  };
  const uri = (file) => ({ fsPath: file, scheme: "file", toString: () => pathToFileURL(file).href });
  const allowedPath = (file) => {
    const config = loadConfig(connection.requireConfig());
    const roots = [config.workspaceRoot, cockpitRoot, ...config.products.flatMap((p) => p.repositories.map((r) => r.path))]
      .filter((p) => fs.existsSync(p)).map((p) => fs.realpathSync(p));
    const physical = fs.realpathSync(file);
    if (!roots.some((root) => inside(physical, root))) throw new Error("Ce fichier est hors de la mémoire et de ses dépôts configurés.");
    return physical;
  };
  const openDocument = async (target) => {
    if (target.content !== undefined) return { content: String(target.content), title: "OneAgent", language: target.language };
    const file = allowedPath(target.fsPath || target);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      return { title: file, content: fs.readdirSync(file).join("\n") };
    }
    if (stat.size > 2 * 1024 * 1024) throw new Error("Fichier trop volumineux pour l’aperçu (2 Mio maximum).");
    const bytes = fs.readFileSync(file), content = bytes.toString("utf8");
    if (bytes.includes(0) || !bytes.equals(Buffer.from(content))) throw new Error("L’aperçu prend en charge les fichiers texte UTF-8.");
    return { title: file, content, file, revision: digest(bytes), editable: /\.(md|txt)$/i.test(file) && !inside(file, fs.realpathSync(cockpitRoot)) };
  };
  const showDocument = async (document) => { emitHost({ kind: "document", ...document }); return { document }; };
  const host = {
    TreeItem: class {}, ThemeIcon: class {}, ProgressLocation: { Notification: 1 }, ViewColumn: { One: 1, Beside: 2 }, ConfigurationTarget: { Workspace: 1 },
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)), parse: (value) => { const url = new URL(value); return { scheme: url.protocol.slice(0, -1), toString: () => url.href }; } },
    window: {
      showInformationMessage: (...args) => notify("info", ...args), showWarningMessage: (...args) => notify("warning", ...args), showErrorMessage: (...args) => notify("error", ...args),
      showInputBox: input,
      showQuickPick: async (items, options = {}) => {
        items = await items;
        const value = await ask({ mode: options.canPickMany ? "multiple" : "choice", title: options.title || options.placeHolder || "Choisir", choices: items.map((item) => typeof item === "string" ? item : [item.label, item.description, item.detail].filter(Boolean).join(" · ")), picked: items.map((item, index) => item.picked ? index : -1).filter((index) => index >= 0) });
        return Array.isArray(value) ? value.map((i) => items[i]) : Number.isInteger(value) ? items[value] : undefined;
      },
      showOpenDialog: async (options) => {
        const value = await input({ title: options.title || options.openLabel, prompt: options.canSelectFolders ? "Chemin du dossier sur ce Mac" : "Chemin du fichier sur ce Mac", value: options.defaultUri?.fsPath, validateInput: (p) => !path.isAbsolute(p) || !fs.existsSync(p) ? "Indiquer un chemin absolu existant." : options.canSelectFolders && !fs.statSync(p).isDirectory() ? "Choisir un dossier." : undefined });
        return value ? [uri(value)] : undefined;
      },
      showTextDocument: showDocument,
      withProgress: async (options, work) => { emitHost({ kind: "progress", message: options.title }); try { return await work({ report: (value) => emitHost({ kind: "progress", message: value.message || options.title }) }, {}); } finally { emitHost({ kind: "progress", message: "" }); } },
      createWebviewPanel: (_id, title) => ({ webview: { set html(value) { emitHost({ kind: "document", title, html: value }); } } }),
      createTerminal: () => ({ show() {}, sendText: (content) => emitHost({ kind: "document", title: "Commande à exécuter dans Terminal", content }) })
    },
    workspace: {
      get workspaceFolders() { try { return [{ uri: uri(readMemoryLocations(connection.requireConfig()).workspaceRoot) }]; } catch { return []; } },
      getConfiguration: () => ({ get: (name, fallback) => name === "configPath" ? connection.requireConfig() : state[`setting.${name}`] ?? fallback, update: (name, value) => saveState(`setting.${name}`, value) }),
      openTextDocument: openDocument
    },
    env: { openExternal: async (target) => { const url = new URL(target.toString()); if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP(S) link required."); emitHost({ kind: "link", url: url.href }); return true; } },
    commands: { executeCommand: async (command, target) => {
      if (["workMemory.openCockpit", "workMemory.cockpit.focus", "workMemory.refresh"].includes(command)) return emitHost({ kind: "focus" });
      if (command === "revealFileInOS") return showDocument(await openDocument(target));
      if (command === "workMemory.checkForUpdates") {
        const result = await updates.check();
        if (!result.updateAvailable) return notify("info", `OneAgent ${result.currentVersion} est à jour.`);
        if (await notify("info", `OneAgent ${result.latestVersion} est disponible.`, { modal: true }, "Mettre à jour") !== "Mettre à jour") return;
        if (!result.officialSourceConfigured) updates.configure(false);
        const installed = await updates.update();
        return notify("info", installed.message);
      }
      throw new Error(`Unsupported OneAgent host command: ${command}`);
    } },
    lm: {
      selectChatModels: async () => [{ id: "copilot", name: "GitHub Copilot" }],
      registerTool: (name, tool) => { tools.set(name, tool); return { dispose: () => tools.delete(name) }; },
      get tools() { return manifest.contributes.languageModelTools.map((tool) => ({ name: tool.name, description: tool.modelDescription, inputSchema: tool.inputSchema })); }
    },
    LanguageModelTextPart: class { constructor(value) { this.value = value; } },
    LanguageModelToolResult: class { constructor(content) { this.content = content; } },
    MarkdownString: class { constructor(value) { this.value = value; } },
    oneagentAgentLoop: (request) => runAgentLoop({ ...request, model: state["setting.agentModel"], invoke: async (name, args) => {
      updates.assertSessionCurrent(); connection.requireConfig();
      const registered = tools.get(name);
      if (!registered) throw new Error(`Unknown curation tool: ${name}`);
      return registered.invoke({ input: { ...args, __oneAgentInternalPass: "bounded_agent_loop" } }, {});
    } })
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(cockpitRoot, "package.json"), "utf8"));
  controller = createCockpitRuntime(host);
  class CopilotCli extends controller.WorkMemoryCli {
    configuredConfigPath() { return connection.requireConfig(); }
    projectRoot() { return path.join(pluginRoot, "runtime"); }
    extensionVersion() { return updates.currentVersion; }
    ensureDefaultConfig() { connection.requireConfig(); }
    run(args, options = {}) {
      return this.enqueueCommand(async () => {
        if (closed) throw new Error("Le cockpit a été fermé.");
        updates.assertSessionCurrent();
        const value = await runCommand(connection.requireConfig(), args, options.input);
        if (options.logOutput !== false && value.trim()) output.appendLine(value.trim());
        return value;
      });
    }
  }
  const ensureCli = () => {
    if (!cli) {
      cli = new CopilotCli({ extensionPath: cockpitRoot, globalStorageUri: uri(path.dirname(stateFile)), globalState: { get: (name, fallback) => state[name] ?? fallback, update: saveState }, workspaceState: { get: (name, fallback) => state[`workspace.${digest(connection.requireConfig())}.${name}`] ?? fallback, update: (name, value) => saveState(`workspace.${digest(connection.requireConfig())}.${name}`, value) } }, output);
      cli.broadcastDocumentationState = (payload) => emit({ type: "documentationState", payload });
      createCopilotTools(host).registerLanguageModelTools(cli);
    }
    return cli;
  };
  const webview = { postMessage: async (value) => { emit(value); return true; } };
  return {
    async state() { updates.assertSessionCurrent(); connection.requireConfig(); return controller.loadCockpitState(ensureCli(), { silent: true, includeDocumentation: true }); },
    fallback(error) { output.appendLine(`Cockpit: ${error.message}`); const local = ensureCli(); return Promise.all([local.documentationPayload(), local.documentationState()]).then(([documentation]) => controller.createDocumentationOnlyCockpitState({ documentation, extensionVersion: updates.currentVersion })); },
    dispatch(message) {
      const next = operationQueue.then(async () => { if (closed) throw new Error("Cockpit fermé."); updates.assertSessionCurrent(); connection.requireConfig(); await controller.handleCockpitMessage(ensureCli(), webview, message); });
      operationQueue = next.catch((error) => emitHost({ kind: "notice", level: "error", message: error.message }));
      return next;
    },
    answer(id, value) {
      const entry = pending.get(id);
      if (!entry) throw new Error("Cette demande a expiré.");
      const question = entry.question;
      if (value !== null && value !== undefined) {
        const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < (question.choices?.length || 0);
        if (question.mode === "input" ? typeof value !== "string" : question.mode === "multiple" ? !Array.isArray(value) || !value.every(validIndex) : !validIndex(value)) throw new Error("Réponse invalide.");
      }
      pending.delete(id); entry.resolve(value ?? undefined);
    },
    replayDialogs() { for (const [id, entry] of pending) emitHost({ kind: "dialog", id, ...entry.question }); },
    async saveDocument({ file, revision, content }) {
      updates.assertSessionCurrent();
      const current = await openDocument(uri(file));
      if (!current.editable || typeof content !== "string" || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("Modification de fichier refusée.");
      if (current.revision !== revision) throw new Error("Le fichier a changé. Fermer puis rouvrir l’aperçu avant de réessayer.");
      fs.writeFileSync(current.file, content, "utf8");
      return { revision: digest(content) };
    },
    async close() { closed = true; for (const entry of pending.values()) entry.resolve(undefined); pending.clear(); await operationQueue; if (cli) await cli.commandQueue; }
  };
}
