const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// Each host gets its own controller state and injected UI/model services.
function createCockpitRuntime(vscode) {
const { readMemoryLocations } = require("./memory-location.js");
const { renderCockpitHtml } = require("./cockpit.js");
const { registerCopilotIntegration } = require("./copilot-tools.js").createCopilotTools(vscode);
const { curateCaptureWithAgent, lintWikiWithAgent } = require("./curation.js").createCurationRuntime(vscode);
const { createDocumentationFallback, loadDocumentationBundle } = require("./documentation.js");
const {
  acknowledgeDocumentationState,
  acknowledgedDocumentationState,
  readAndMarkDocumentationState
} = require("./documentation-state.js");
const {
  GitHubReleaseUpdater,
  INSTALLED_UPDATE_VERSION_KEY,
  LAST_UPDATE_CHECK_KEY
} = require("./github-updater.js");
const { DailyRepositoryUpdater } = require("./repository-updater.js");

function resolveNodeRuntime(configuredPath = "node", options = {}) {
  const environment = { ...(options.env || process.env) };
  const isExecutable = options.isExecutable || isExecutableFile;
  const requested = String(configuredPath || "node").trim() || "node";
  if (requested !== "node") {
    return {
      command: requested.startsWith(`~${path.sep}`) && environment.HOME
        ? path.join(environment.HOME, requested.slice(2))
        : requested,
      env: environment,
      source: "configured setting"
    };
  }

  const pathNode = findExecutableOnPath("node", environment, isExecutable, options.platform || process.platform);
  if (pathNode) {
    return { command: pathNode, env: environment, source: "PATH" };
  }

  const hostExecutable = String(options.execPath || process.execPath || "").trim();
  if (hostExecutable && isExecutable(hostExecutable)) {
    const electron = options.electron ?? Boolean(process.versions.electron);
    if (electron) environment.ELECTRON_RUN_AS_NODE = "1";
    return {
      command: hostExecutable,
      env: environment,
      source: electron ? "VS Code embedded runtime" : "extension host runtime"
    };
  }

  return { command: requested, env: environment, source: "unresolved" };
}

function findExecutableOnPath(command, environment, isExecutable, platform) {
  const separator = platform === "win32" ? ";" : ":";
  const extensions = platform === "win32"
    ? String(environment.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const directory of String(environment.PATH || "").split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, platform === "win32" ? `${command}${extension}` : command);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function activate(context) {
  const output = vscode.window.createOutputChannel("OneAgent");
  const cli = new WorkMemoryCli(context, output);
  const extensionUpdater = new GitHubReleaseUpdater(context, vscode, output);
  const repositoryUpdater = new DailyRepositoryUpdater(context, vscode, cli, {
    onUpdated: () => refreshAll({ auto: true })
  });
  const contextProvider = new ContextProvider(cli);
  const productsProvider = new ProductsProvider(cli);
  const wikiProvider = new WikiProvider(cli);
  const tasksProvider = new TasksProvider(cli);
  const inboxProvider = new InboxProvider(cli);
  const cockpitViewProvider = new CockpitViewProvider(cli);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(database) OneAgent";
  status.tooltip = "Open OneAgent cockpit";
  let cockpitPanel;
  let refreshTimer;
  let refreshRunning = false;
  let refreshQueued = false;
  let ignoreDatabaseEventsUntil = 0;
  const muteDatabaseWatcher = (durationMs = 2500) => {
    ignoreDatabaseEventsUntil = Math.max(ignoreDatabaseEventsUntil, Date.now() + durationMs);
  };
  const sentinelPath = path.join(path.dirname(cli.memoryDatabasePath()), "last-write.json");
  const sentinelMtime = () => {
    try {
      return fs.statSync(sentinelPath).mtimeMs;
    } catch {
      return 0;
    }
  };
  let consumedSentinelMtime = sentinelMtime();
  const scheduleRefresh = (options = {}) => {
    if (!options.force && Date.now() < ignoreDatabaseEventsUntil) {
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(async () => {
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }
      refreshRunning = true;
      try {
        await refreshAll({ auto: true });
      } catch (error) {
        cli.output.appendLine(`Auto-refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        refreshRunning = false;
        muteDatabaseWatcher(1500);
        if (refreshQueued) {
          refreshQueued = false;
          // Only rerun when a real write landed while we were refreshing; plain
          // database-file churn from our own reads must not queue another pass.
          if (sentinelMtime() > consumedSentinelMtime) {
            scheduleRefresh({ force: true });
          }
        }
      }
    }, 650);
  };
  const rememberCockpitPanel = (panel) => {
    cockpitPanel = panel;
    if (!panel.__workMemoryDisposeBound) {
      panel.__workMemoryDisposeBound = true;
      panel.onDidDispose(() => {
        if (cockpitPanel === panel) {
          cockpitPanel = undefined;
        }
      });
    }
  };
  cli.broadcastDocumentationState = async (documentationState) => {
    const targets = [cockpitViewProvider.webview(), cockpitPanel?.webview].filter(Boolean);
    await Promise.allSettled(targets.map((webview) =>
      webview.postMessage({ type: "documentationState", payload: documentationState })
    ));
  };
  const openDocumentation = async (guideId) => {
    await vscode.commands.executeCommand("workMemory.cockpit.focus");
    let target = cockpitViewProvider.webview();
    if (!target) {
      rememberCockpitPanel(await openCockpit(cli, cockpitPanel));
      target = cockpitPanel?.webview;
    }
    await target?.postMessage({
      type: "openDocumentation",
      id: typeof guideId === "string" ? guideId : undefined
    });
  };
  const register = (command, handler) => vscode.commands.registerCommand(command, async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      await showCliError(cli, error);
    }
  });

  status.command = "workMemory.showContext";
  status.show();

  context.subscriptions.push(
    output,
    status,
    createDatabaseWatcher(cli, scheduleRefresh),
    createSentinelWatcher(cli, () => {
      if (sentinelMtime() <= consumedSentinelMtime) {
        return;
      }
      scheduleRefresh({ force: true });
    }),
    createWikiReviewWatcher(cli, scheduleRefresh),
    vscode.window.registerWebviewViewProvider("workMemory.cockpit", cockpitViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    register("workMemory.refresh", refreshAll),
    register("workMemory.showContext", showContext),
    register("workMemory.openInbox", () => vscode.commands.executeCommand("workMemory.cockpit.focus")),
    register("workMemory.openCockpit", async () => {
      rememberCockpitPanel(await openCockpit(cli, cockpitPanel));
    }),
    register("workMemory.openHelp", openDocumentation),
    register("workMemory.refreshGraphify", async () => {
      rememberCockpitPanel(await openCockpit(cli, cockpitPanel, { refreshGraphify: true }));
    }),
    register("workMemory.setConfigPath", async () => {
      await setConfigPath(cli);
      await refreshAll();
    }),
    register("workMemory.useFixtureConfig", async () => {
      await useFixtureConfig(cli);
      await refreshAll();
    }),
    register("workMemory.addProduct", async () => {
      await addProduct(cli);
      await refreshAll();
    }),
    register("workMemory.upsertEntity", async () => {
      await upsertEntity(cli);
      await refreshAll();
    }),
    register("workMemory.deleteEntity", async () => {
      await deleteEntity(cli);
      await refreshAll();
    }),
    register("workMemory.upsertEntityLink", async () => {
      await upsertEntityLink(cli);
      await refreshAll();
    }),
    register("workMemory.deleteEntityLink", async () => {
      await deleteEntityLink(cli);
      await refreshAll();
    }),
    register("workMemory.createTask", async () => {
      await createTask(cli);
      await refreshAll();
    }),
    register("workMemory.createNote", async (item) => {
      await vscode.commands.executeCommand("workMemory.cockpit.focus");
      let target = cockpitViewProvider.webview();
      if (!target) {
        rememberCockpitPanel(await openCockpit(cli, cockpitPanel));
        target = cockpitPanel?.webview;
      }
      const entity = item?.entity || item;
      const primary = entity?.kind && entity?.id ? `${entity.kind}:${entity.id}` : undefined;
      await target?.postMessage({ type: "openNewManualNote", primary });
    }),
    register("workMemory.captureMemory", async () => {
      await captureMemory(cli);
      await refreshAll();
    }),
    register("workMemory.resetMemory", async () => {
      await resetMemory(cli);
      await refreshAll();
    }),
    register("workMemory.diagnoseRuntime", async () => {
      await diagnoseRuntime(cli);
    }),
    register("workMemory.runIngestionSmokeTest", async () => {
      await runIngestionSmokeTest(cli);
      await refreshAll();
    }),
    register("workMemory.checkForUpdates", () => extensionUpdater.checkForUpdates()),
    register("workMemory.syncRepositories", () => repositoryUpdater.runNow()),
    register("workMemory.addRepository", async (item) => {
      await addRepository(cli, item);
      await refreshAll();
    }),
    register("workMemory.reindexRepository", async (item) => {
      await reindexRepository(cli, item);
      await refreshAll();
    }),
    register("workMemory.ingestCurrentFile", async () => {
      await ingestCurrentFile(cli);
      await refreshAll();
    }),
    register("workMemory.curatePending", async () => {
      await curatePendingCaptures(cli);
      await refreshAll();
    }),
    register("workMemory.lintWiki", async () => {
      await lintWikiWithProgress(cli);
      await refreshAll();
    }),
    register("workMemory.searchMemory", () => searchMemory(cli)),
    register("workMemory.openWikiPage", openWikiPage),
    register("workMemory.reindexWikiPage", async (item) => {
      await reindexWikiPage(cli, item);
      await refreshAll();
    }),
    register("workMemory.showRelatedGraph", async () => {
      rememberCockpitPanel(await openCockpit(cli, cockpitPanel));
    }),
    register("workMemory.previewProposal", (item) => previewProposal(cli, item)),
    register("workMemory.acceptProposal", async (item) => {
      await runInboxAction(cli, item, "accept");
      await refreshAll();
    }),
    register("workMemory.rejectProposal", async (item) => {
      await runInboxAction(cli, item, "reject");
      await refreshAll();
    })
  );

  registerCopilotIntegration(context, cli);
  context.subscriptions.push(extensionUpdater, repositoryUpdater, { dispose: () => cli.stopDaemon() });

  void initializeWorkspace();

  async function showContext() {
    const data = await cli.json(["context", "--json", "--scope", "portfolio"]);
    const product = data.activeProduct ? `${data.activeProduct.id} (${data.activeProduct.label})` : "portfolio";
    const included = data.scope?.includedProductIds?.join(", ") || "none";
    await vscode.window.showInformationMessage(`OneAgent: ${data.mode}; product=${product}; scope=${included}`);
  }

  async function refreshAll(options = {}) {
    muteDatabaseWatcher();
    const sentinelMtimeAtStart = sentinelMtime();
    let monitoredContext;
    if (options.auto) {
      try {
        monitoredContext = await refreshActiveMonitoredContext(cli);
      } catch (error) {
        cli.output.appendLine(`Monitored Context refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    contextProvider.refresh();
    productsProvider.refresh();
    wikiProvider.refresh();
    tasksProvider.refresh();
    inboxProvider.refresh();
    const targets = [];
    const sidebarWebview = cockpitViewProvider.webview();
    if (sidebarWebview) {
      targets.push(sidebarWebview);
    }
    if (cockpitPanel) {
      targets.push(cockpitPanel.webview);
    }
    if (targets.length > 0) {
      const payload = await loadCockpitState(cli, { silent: Boolean(options.auto) });
      await Promise.all(targets.map((webview) => webview.postMessage({ type: "state", payload })));
      if ((monitoredContext?.suggestions || []).length > 0) {
        const message = `${monitoredContext.suggestions.length} new Context proposal(s) are ready for review in ${monitoredContext.view.name}.`;
        await Promise.all(targets.map((webview) => postOperation(webview, "success", message)));
      }
    }
    consumedSentinelMtime = Math.max(consumedSentinelMtime, sentinelMtimeAtStart);
    muteDatabaseWatcher();
  }

  async function initializeWorkspace() {
    try {
      await cli.ensureDefaultConfig();
      // The newly installed VSIX becomes active only after a window reload.
      // Complete its one-time data migration before loading views or recovering
      // pending publications. Other CLI entry points use the same guard.
      const migration = await cli.json(["migrate-knowledge", "--ensure", "--json"]);
      if (migration?.status === "migrated") {
        const backupPath = migration.report?.backupPath;
        cli.output.appendLine(`Markdown knowledge migration completed. Backup: ${backupPath || "unknown"}`);
        void vscode.window.showInformationMessage(
          `OneAgent migrated your knowledge to Markdown. Backup: ${backupPath || ".work-memory/backups"}`
        );
      }
      const recovery = await cli.json(["inbox", "recover-publications", "--json"]);
      if (Number(recovery?.pending || 0) > 0) {
        cli.output.appendLine(`Publication recovery: ${(recovery.recovered || []).length}/${recovery.pending} completed.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cli.output.appendLine(`Initialization failed: ${message}`);
      await vscode.window.showErrorMessage(`OneAgent could not initialize this workspace: ${message}`);
      return;
    }
    await refreshAll();
    const documentationState = await cli.documentationState();
    if (documentationState.shouldNotifyUpdate) {
      const choice = await vscode.window.showInformationMessage(
        `OneAgent was updated to ${documentationState.currentVersion}.`,
        "What's new"
      );
      if (choice === "What's new") {
        await openDocumentation("whats-new");
      }
    }
    extensionUpdater.start();
    repositoryUpdater.start();
    void offerCurationBacklog(cli);
  }
}

async function refreshActiveMonitoredContext(cli) {
  const listing = await cli.json(["context-view", "list", "--json"]);
  const activeViewId = typeof listing?.activeViewId === "string" ? listing.activeViewId : undefined;
  if (!activeViewId) return undefined;
  const view = (listing.views || []).find((candidate) => candidate?.id === activeViewId);
  if (!view || view.refreshPolicy !== "monitored") return undefined;
  const result = await cli.json(["context-view", "refresh", activeViewId, "--json"]);
  if ((result?.suggestions || []).length > 0) {
    cli.output.appendLine(`Monitored Context ${activeViewId}: ${result.suggestions.length} proposal(s) added for review.`);
  }
  return result;
}

/** On activation, surface a non-blocking prompt when captures are waiting for curation. */
async function offerCurationBacklog(cli) {
  try {
    if (vscode.workspace.getConfiguration("workMemory").get("autoCurate") === false) {
      return;
    }
    const queue = await cli.json(["curation", "queue", "--json"]);
    if (!queue || queue.length === 0) {
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `OneAgent: ${queue.length} capture(s) are waiting for agent curation.`,
      "Curate now",
      "Later"
    );
    if (choice === "Curate now") {
      await curatePendingCaptures(cli);
    }
  } catch (error) {
    cli.output.appendLine(`Curation backlog check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function deactivate() {}

function createDatabaseWatcher(cli, onChange) {
  const databasePath = cli.memoryDatabasePath();
  const pattern = new vscode.RelativePattern(path.dirname(databasePath), `${path.basename(databasePath)}*`);
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const trigger = () => onChange();
  watcher.onDidChange(trigger);
  watcher.onDidCreate(trigger);
  watcher.onDidDelete(trigger);
  return watcher;
}

// The storage layer touches last-write.json only when a statement actually
// changes data, so these events bypass the mute window that protects the
// noisier database-file watcher above from read-triggered WAL churn.
function createSentinelWatcher(cli, onChange) {
  const pattern = new vscode.RelativePattern(path.dirname(cli.memoryDatabasePath()), "last-write.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const trigger = () => onChange();
  watcher.onDidChange(trigger);
  watcher.onDidCreate(trigger);
  return watcher;
}

function createWikiReviewWatcher(cli, onChange) {
  const pattern = new vscode.RelativePattern(cli.memoryWorkspaceRoot(), "**/docs/wiki/**/*.md");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const timers = new Map();
  const enqueue = (uri) => {
    const filePath = uri?.fsPath;
    if (!filePath || cli.isWikiReviewMuted()) return;
    clearTimeout(timers.get(filePath));
    timers.set(filePath, setTimeout(async () => {
      timers.delete(filePath);
      if (cli.isWikiReviewMuted()) return;
      try {
        const created = await createExternalWikiReview(cli, filePath);
        if (created) {
          onChange({ force: true });
        }
      } catch (error) {
        cli.output.appendLine(`External wiki review failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 1200));
  };
  watcher.onDidCreate(enqueue);
  watcher.onDidChange(enqueue);
  return watcher;
}

async function createExternalWikiReview(cli, filePath) {
  if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== ".md") {
    return false;
  }
  const match = await resolveWikiReviewTarget(cli, filePath);
  if (!match) {
    return false;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const hash = sha256Text(`${match.productId}\0${match.targetPath}\0${content}`);
  const id = `inbox_ext_wiki_${hash.slice(0, 24)}`;
  await cli.json([
    "inbox", "add",
    "--id", id,
    "--type", "wiki_proposal",
    "--title", `Review external wiki change: ${match.relativePath}`,
    "--body", "A wiki page was created or modified outside the OneAgent review flow. Review it before considering the memory accepted.",
    "--product", match.productId,
    "--payload", JSON.stringify({
      proposalKind: "external_wiki_change",
      reviewPath: match.targetPath,
      contentHash: hash,
      agentAction: "external_file_write"
    }),
    "--json"
  ]);
  return true;
}

async function resolveWikiReviewTarget(cli, filePath) {
  const products = await cli.json(["products", "--json"]);
  for (const product of products || []) {
    for (const repository of product.repositories || []) {
      const wikiRoot = repository.wikiRoot || "docs/wiki";
      const wikiPath = path.resolve(repository.path, wikiRoot);
      if (!isPathInsideOrEqual(filePath, wikiPath)) {
        continue;
      }
      const relativePath = path.relative(wikiPath, filePath).split(path.sep).join("/");
      return {
        productId: product.id,
        repositoryId: repository.id,
        relativePath,
        targetPath: path.join(wikiRoot, relativePath).split(path.sep).join("/")
      };
    }
  }
  return undefined;
}

function isPathInsideOrEqual(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class CockpitViewProvider {
  constructor(cli) {
    this.cli = cli;
    this.view = undefined;
  }

  async resolveWebviewView(view) {
    this.view = view;
    await attachCockpitWebview(this.cli, view.webview);
  }

  webview() {
    return this.view?.webview;
  }
}

class WorkMemoryCli {
  constructor(context, output) {
    this.context = context;
    this.output = output;
    this.commandQueue = Promise.resolve();
    this.wikiReviewMutedUntil = 0;
    try {
      this.documentation = loadDocumentationBundle(context.extensionPath);
    } catch (error) {
      this.documentation = createDocumentationFallback(error);
      output.appendLine(`Documentation warning: ${error instanceof Error ? error.message : String(error)}`);
    }
    const currentVersion = this.extensionVersion();
    this.documentationStateOptions = {
      hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length),
      knownExistingInstallation: context.globalState.get(INSTALLED_UPDATE_VERSION_KEY) === currentVersion ||
        Number(context.globalState.get(LAST_UPDATE_CHECK_KEY, 0)) > 0
    };
    this.documentationStatePromise = readAndMarkDocumentationState(
      context,
      currentVersion,
      this.documentationStateOptions
    );
  }

  args(args) {
    const configPath = this.activeConfigPath();
    return configPath ? [...args, "--config", configPath] : args;
  }

  projectRoot() {
    const config = vscode.workspace.getConfiguration("workMemory");
    const configured = config.get("projectRoot");
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (configured) {
      return resolveConfiguredPath(configured, workspaceRoot || process.cwd());
    }

    if (workspaceRoot && fs.existsSync(path.join(workspaceRoot, "packages", "cli", "src", "index.ts"))) {
      return workspaceRoot;
    }

    const embeddedRuntime = path.join(this.context.extensionPath, "runtime");
    if (fs.existsSync(path.join(embeddedRuntime, "packages", "cli", "src", "index.ts"))) {
      return embeddedRuntime;
    }

    return path.resolve(this.context.extensionPath, "..", "..");
  }

  cliPath() {
    return path.join(this.projectRoot(), "packages", "cli", "src", "index.ts");
  }

  fixtureConfigPath() {
    return path.join(this.projectRoot(), "fixtures", "sample-config.yaml");
  }

  graphifyCommand() {
    const configured = vscode.workspace.getConfiguration("workMemory").get("graphifyCommand");
    if (configured) {
      return resolveConfiguredPath(configured, this.projectRoot());
    }

    const workspaceCommand = path.join(this.memoryWorkspaceRoot(), ".work-memory", "graphify-venv", "bin", "graphify");
    if (fs.existsSync(workspaceCommand)) {
      return workspaceCommand;
    }

    const runtimeCommand = path.join(this.projectRoot(), ".work-memory", "graphify-venv", "bin", "graphify");
    return fs.existsSync(runtimeCommand) ? runtimeCommand : "";
  }

  configuredConfigPath() {
    const configPath = vscode.workspace.getConfiguration("workMemory").get("configPath");
    if (configPath) return resolveConfiguredPath(configPath, this.projectRoot());
    if (process.env.ONEAGENT_CONFIG !== undefined) {
      if (!process.env.ONEAGENT_CONFIG.trim() || !path.isAbsolute(process.env.ONEAGENT_CONFIG)) {
        throw new Error("ONEAGENT_CONFIG must be an absolute path to a OneAgent configuration file.");
      }
      return process.env.ONEAGENT_CONFIG;
    }
    return "";
  }

  defaultConfigPath() {
    return path.join(this.memoryWorkspaceRoot(), ".work-memory", "config.yaml");
  }

  activeConfigPath() {
    const configured = this.configuredConfigPath();
    if (configured) {
      return configured;
    }
    const defaultConfig = this.defaultConfigPath();
    return fs.existsSync(defaultConfig) ? defaultConfig : "";
  }

  memoryWorkspaceRoot() {
    const configured = this.configuredConfigPath();
    if (configured) return readMemoryLocations(configured).workspaceRoot;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this.context.globalStorageUri.fsPath;
  }

  memoryDatabasePath() {
    const configured = this.configuredConfigPath();
    return configured ? readMemoryLocations(configured).databasePath : path.join(this.memoryWorkspaceRoot(), ".work-memory", "work-memory.db");
  }

  commandCwd() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this.memoryWorkspaceRoot();
  }

  extensionVersion() {
    try {
      const manifestPath = path.join(this.context.extensionPath, "package.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return manifest.version || "unknown";
    } catch {
      return "unknown";
    }
  }

  documentationState() {
    return this.documentationStatePromise;
  }

  async acknowledgeDocumentation(options = {}) {
    const state = await this.documentationState();
    await acknowledgeDocumentationState(this.context, state, options);
    this.documentationStatePromise = Promise.resolve(acknowledgedDocumentationState(state, options));
    return this.documentationStatePromise;
  }

  async documentationPayload() {
    return {
      ...this.documentation,
      launchState: await this.documentationState()
    };
  }

  muteWikiReviewWatcher(durationMs = 5000) {
    this.wikiReviewMutedUntil = Math.max(this.wikiReviewMutedUntil, Date.now() + durationMs);
  }

  isWikiReviewMuted() {
    return Date.now() < this.wikiReviewMutedUntil;
  }

  async ensureDefaultConfig() {
    if (this.configuredConfigPath()) {
      return;
    }

    const memoryRoot = path.dirname(this.defaultConfigPath());
    fs.mkdirSync(memoryRoot, { recursive: true });
    fs.mkdirSync(path.join(memoryRoot, "cache"), { recursive: true });
    fs.mkdirSync(path.join(memoryRoot, "logs"), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(this.memoryWorkspaceRoot(), ".work-memory", "work-memory.db")), { recursive: true });

    if (!fs.existsSync(this.defaultConfigPath())) {
      fs.writeFileSync(this.defaultConfigPath(), defaultConfig(), "utf8");
      this.output.appendLine(`Created ${this.defaultConfigPath()}`);
    }
  }

  async updateWorkspaceSetting(name, value) {
    await vscode.workspace.getConfiguration("workMemory").update(name, value, vscode.ConfigurationTarget.Workspace);
  }

  run(args, options = {}) {
    return this.enqueueCommand(() => this.runViaDaemonOrExec(args, options));
  }

  enqueueCommand(work) {
    const next = this.commandQueue.then(work, work);
    this.commandQueue = next.catch(() => undefined);
    return next;
  }

  daemonEnabled() {
    return vscode.workspace.getConfiguration("workMemory").get("useDaemon") !== false;
  }

  async runViaDaemonOrExec(args, options = {}) {
    if (!this.daemonEnabled()) {
      return this.runNow(args, options);
    }
    try {
      return await this.runViaDaemon(args, options);
    } catch (error) {
      // A lost reply does not prove that a write failed. Never replay a dispatched
      // command: it could create a duplicate note or repeat a completed mutation.
      if (error && error.daemonTransport) {
        this.output.appendLine(`Daemon unavailable (${error.message}); command was not replayed.`);
        this.stopDaemon();
      }
      throw error;
    }
  }

  ensureDaemon() {
    const config = vscode.workspace.getConfiguration("workMemory");
    const nodeRuntime = resolveNodeRuntime(config.get("nodePath") || "node");
    const nodePath = nodeRuntime.command;
    const cliPath = this.cliPath();
    const signature = `${nodePath}::${nodeRuntime.source}::${cliPath}::${this.commandCwd()}`;
    if (this.daemon && this.daemon.signature === signature && this.daemon.child.exitCode === null && !this.daemon.child.killed) {
      return this.daemon;
    }
    this.stopDaemon();

    const child = cp.spawn(nodePath, ["--disable-warning=ExperimentalWarning", cliPath, "daemon"], {
      cwd: this.commandCwd(),
      env: nodeRuntime.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const daemon = { child, signature, pending: new Map(), nextId: 1, buffer: "" };
    child.stdout.on("data", (chunk) => {
      daemon.buffer += String(chunk);
      let index;
      while ((index = daemon.buffer.indexOf("\n")) >= 0) {
        const line = daemon.buffer.slice(0, index);
        daemon.buffer = daemon.buffer.slice(index + 1);
        this.handleDaemonLine(daemon, line);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.output.appendLine(`[daemon] ${text}`);
      }
    });
    const failPending = (reason) => {
      for (const pending of daemon.pending.values()) {
        pending.reject(daemonTransportError(reason));
      }
      daemon.pending.clear();
      if (this.daemon === daemon) {
        this.daemon = undefined;
      }
    };
    child.stdin.on("error", (error) => failPending(`daemon input error: ${error.message}`));
    child.on("error", (error) => failPending(`daemon error: ${error.message}`));
    child.on("exit", (code) => failPending(`daemon exited (code ${code})`));

    child.once("spawn", () => {
      this.output.appendLine(`Started OneAgent CLI daemon (pid ${child.pid}, ${nodeRuntime.source}).`);
    });
    this.daemon = daemon;
    return daemon;
  }

  runViaDaemon(args, options = {}) {
    const daemon = this.ensureDaemon();
    const id = daemon.nextId++;
    const fullArgs = this.args(args);
    const logOutput = options.logOutput !== false;
    if (logOutput) {
      this.output.appendLine(`$ [daemon] ${formatCommand("wm", fullArgs)}`);
    }
    const payload = { id, args: fullArgs };
    if (options.input !== undefined) {
      payload.input = options.input;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        daemon.pending.delete(id);
        this.stopDaemon();
        reject(daemonTransportError("daemon request timed out after 120s"));
      }, 120000);
      daemon.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          if (logOutput && value.trim()) {
            this.output.appendLine(value.trim());
          }
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      try {
        daemon.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        daemon.pending.delete(id);
        clearTimeout(timer);
        reject(daemonTransportError(`daemon write failed: ${error.message}`));
      }
    });
  }

  handleDaemonLine(daemon, line) {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.output.appendLine(`[daemon] ${line}`);
      return;
    }
    if (message.ready) {
      return;
    }
    const pending = daemon.pending.get(message.id);
    if (!pending) {
      return;
    }
    daemon.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(String(message.stdout || "").trim());
    } else {
      pending.reject(new Error(message.error || "CLI error"));
    }
  }

  stopDaemon() {
    if (!this.daemon) {
      return;
    }
    try {
      // EOF drains the current request and releases the database + file lock.
      // SIGTERM here used to strand an operation lock during disposal/timeouts.
      this.daemon.child.stdin.end();
    } catch {
      // Already gone.
    }
    this.daemon = undefined;
  }

  runNow(args, options = {}) {
    const config = vscode.workspace.getConfiguration("workMemory");
    const nodeRuntime = resolveNodeRuntime(config.get("nodePath") || "node");
    const nodePath = nodeRuntime.command;
    const commandArgs = ["--disable-warning=ExperimentalWarning", this.cliPath(), ...this.args(args)];
    const logOutput = options.logOutput !== false;
    if (logOutput) {
      this.output.appendLine(`$ ${formatCommand(nodePath, commandArgs)}`);
    }
    return new Promise((resolve, reject) => {
      const child = cp.execFile(nodePath, commandArgs, { cwd: this.commandCwd(), env: nodeRuntime.env, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (logOutput && stdout.trim()) {
          this.output.appendLine(stdout.trim());
        }
        if (logOutput && stderr.trim()) {
          this.output.appendLine(stderr.trim());
        }
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve(stdout.trim());
      });
      if (options.input !== undefined && child.stdin) {
        child.stdin.write(options.input);
        child.stdin.end();
      }
    });
  }

  async json(args) {
    const output = await this.run(args, { logOutput: false });
    return output ? JSON.parse(output) : null;
  }
}

function defaultConfig() {
  return `workspace:
  name: OneAgent
  memoryRoot: .work-memory

storage:
  databasePath: .work-memory/work-memory.db

products: []
`;
}

function resolveConfiguredPath(value, basePath) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || basePath;
  let expanded = String(value).replace(/\$\{workspaceFolder\}/g, workspaceRoot);
  if (expanded === "~" || expanded.startsWith("~/")) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }
  return path.isAbsolute(expanded) ? expanded : path.resolve(basePath, expanded);
}

function formatCommand(command, args) {
  return [command, ...args].map((arg) => {
    if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
      return arg;
    }
    return JSON.stringify(arg);
  }).join(" ");
}

/** Failure of the daemon channel: the command outcome may be unknown. */
function daemonTransportError(message) {
  const error = new Error(`${message}. The command was not replayed automatically. It may still finish; check the memory state before retrying.`);
  error.daemonTransport = true;
  return error;
}

class StaticItem extends vscode.TreeItem {
  constructor(label, description, icon) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon ? new vscode.ThemeIcon(icon) : undefined;
  }
}

class ProductItem extends vscode.TreeItem {
  constructor(product) {
    super(product.label || product.id, vscode.TreeItemCollapsibleState.Collapsed);
    this.product = product;
    this.description = product.id;
    this.contextValue = "productItem";
    this.iconPath = new vscode.ThemeIcon("package");
  }
}

class WikiProductItem extends vscode.TreeItem {
  constructor(product, groups) {
    super(product.label || product.id, vscode.TreeItemCollapsibleState.Expanded);
    this.product = product;
    this.groups = groups;
    this.description = product.id;
    this.iconPath = new vscode.ThemeIcon("book");
    this.contextValue = "wikiProduct";
  }
}

class WikiGroupItem extends vscode.TreeItem {
  constructor(product, label, pages) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.product = product;
    this.group = label;
    this.pages = pages;
    this.description = `${pages.length}`;
    this.iconPath = new vscode.ThemeIcon("folder");
    this.contextValue = "wikiGroup";
  }
}

class WikiPageItem extends vscode.TreeItem {
  constructor(product, page) {
    super(page.label, vscode.TreeItemCollapsibleState.None);
    this.product = product;
    this.page = page;
    this.description = path.relative(page.repositoryPath, page.filePath);
    this.tooltip = page.filePath;
    this.iconPath = new vscode.ThemeIcon("markdown");
    this.contextValue = "wikiPage";
    this.command = {
      command: "workMemory.openWikiPage",
      title: "Open Wiki Page",
      arguments: [this]
    };
  }
}

class InboxItem extends vscode.TreeItem {
  constructor(item) {
    super(item.title, vscode.TreeItemCollapsibleState.None);
    this.inboxItem = item;
    this.description = item.type;
    this.tooltip = item.body;
    this.contextValue = "inboxItem";
    this.iconPath = iconForInboxType(item.type);
    this.command = {
      command: "workMemory.previewProposal",
      title: "Preview Proposal",
      arguments: [this]
    };
  }
}

class CurationPackageItem extends vscode.TreeItem {
  constructor(detail) {
    const packageRecord = detail.package || {};
    super(packageRecord.title || packageRecord.id || "Curation package", vscode.TreeItemCollapsibleState.None);
    const pending = Number(detail.counts?.proposed || 0) + Number(detail.counts?.captured || 0);
    this.description = `${pending} observation(s) · ${packageRecord.status || "pending"}`;
    this.tooltip = `${detail.source?.title || packageRecord.sourceId || "Source"}\n${Number(detail.counts?.accepted || 0)} accepted · ${Number(detail.counts?.rejected || 0)} rejected · ${pending} pending`;
    this.contextValue = "curationPackage";
    this.iconPath = new vscode.ThemeIcon("references");
    this.command = { command: "workMemory.openCockpit", title: "Review Curation Package" };
  }
}

class TaskItem extends vscode.TreeItem {
  constructor(task) {
    super(task.title, vscode.TreeItemCollapsibleState.None);
    this.description = task.status;
    this.tooltip = task.body || task.title;
    this.iconPath = new vscode.ThemeIcon("checklist");
  }
}

class ContextProvider {
  constructor(cli) {
    this.cli = cli;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  async getChildren() {
    try {
      const data = await this.cli.json(["context", "--json", "--scope", "portfolio"]);
      const included = data.scope?.includedProductIds || [];
      return [
        new StaticItem("Mode", data.mode, "window"),
        new StaticItem("Active Product", data.activeProduct?.label || "portfolio", "target"),
        new StaticItem("Scope", included.length ? included.join(", ") : "none", "symbol-namespace")
      ];
    } catch (error) {
      return [new StaticItem("Unavailable", error.message, "warning")];
    }
  }

  getTreeItem(item) {
    return item;
  }
}

class ProductsProvider {
  constructor(cli) {
    this.cli = cli;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  async getChildren(element) {
    try {
      if (element instanceof ProductItem) {
        const repos = element.product.repositories || [];
        const deps = element.product.dependencies || [];
        return [
          ...deps.map((dep) => new StaticItem("Dependency", dep, "references")),
          ...repos.map((repo) => new StaticItem(repo.role || "repo", `${repo.id} - ${repo.path}`, "repo"))
        ];
      }
      const products = await this.cli.json(["products", "--json"]);
      if (!products || products.length === 0) {
        return [new StaticItem("No Products", "Use OneAgent: Add Product later", "info")];
      }
      return products.map((product) => new ProductItem(product));
    } catch (error) {
      return [new StaticItem("Unavailable", error.message, "warning")];
    }
  }

  getTreeItem(item) {
    return item;
  }
}

class WikiProvider {
  constructor(cli) {
    this.cli = cli;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  async getChildren(element) {
    try {
      if (element instanceof WikiProductItem) {
        return element.groups.map((group) => new WikiGroupItem(element.product, group.label, group.pages));
      }
      if (element instanceof WikiGroupItem) {
        return element.pages.map((page) => new WikiPageItem(element.product, page));
      }

      const products = await this.cli.json(["products", "--json"]);
      if (!products || products.length === 0) {
        return [new StaticItem("No Products", "Add a product or set a config path", "info")];
      }

      const roots = products
        .map((product) => ({ product, groups: scanWikiGroups(product) }))
        .filter((entry) => entry.groups.some((group) => group.pages.length > 0));

      if (roots.length === 0) {
        return [new StaticItem("No Wiki Pages", "No docs/wiki pages found", "info")];
      }

      return roots.map((entry) => new WikiProductItem(entry.product, entry.groups));
    } catch (error) {
      return [new StaticItem("Unavailable", error.message, "warning")];
    }
  }

  getTreeItem(item) {
    return item;
  }
}

class InboxProvider {
  constructor(cli) {
    this.cli = cli;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  async getChildren() {
    try {
      const [items, pendingPackages, partialPackages] = await Promise.all([
        this.cli.json(["inbox", "--json", "--scope", "portfolio", "--context-scope", "active"]),
        this.cli.json(["curation-package", "list", "--status", "pending", "--context-scope", "active", "--json"]),
        this.cli.json(["curation-package", "list", "--status", "partially_accepted", "--context-scope", "active", "--json"])
      ]);
      const packages = [...(pendingPackages || []), ...(partialPackages || [])];
      if ((!items || items.length === 0) && packages.length === 0) {
        return [new StaticItem("Inbox Empty", "No pending proposals", "pass")];
      }
      return [...packages.map((detail) => new CurationPackageItem(detail)), ...(items || []).map((item) => new InboxItem(item))];
    } catch (error) {
      return [new StaticItem("Unavailable", error.message, "warning")];
    }
  }

  getTreeItem(item) {
    return item;
  }
}

class TasksProvider {
  constructor(cli) {
    this.cli = cli;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  async getChildren() {
    try {
      const tasks = await this.cli.json(["tasks", "--json", "--scope", "portfolio"]);
      if (!tasks || tasks.length === 0) {
        return [new StaticItem("No Tasks", "No pending tasks", "pass")];
      }
      return tasks.map((task) => new TaskItem(task));
    } catch (error) {
      return [new StaticItem("Unavailable", error.message, "warning")];
    }
  }

  getTreeItem(item) {
    return item;
  }
}

async function setConfigPath(cli) {
  const currentPath = cli.activeConfigPath() || cli.defaultConfigPath();
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.dirname(currentPath)),
    filters: {
      "OneAgent Config": ["yaml", "yml", "json"]
    },
    title: "Select OneAgent config"
  });
  if (!selected || selected.length === 0) {
    return;
  }

  await cli.updateWorkspaceSetting("configPath", selected[0].fsPath);
  await vscode.window.showInformationMessage(`OneAgent config set to ${selected[0].fsPath}`);
}

async function useFixtureConfig(cli) {
  const fixturePath = cli.fixtureConfigPath();
  if (!fs.existsSync(fixturePath)) {
    await vscode.window.showWarningMessage(`Fixture config not found: ${fixturePath}`);
    return;
  }

  await cli.updateWorkspaceSetting("configPath", fixturePath);
  await vscode.window.showInformationMessage("OneAgent is now using the fixture config for this workspace.");
}

// `initiative` remains readable for legacy workspaces, but new work is always a project.
const ENTITY_KINDS = ["oneagent", "domain", "subdomain", "team", "product", "repository", "project", "discovery", "feature", "feature_request", "practice", "mission", "insight", "person"];
const ORG_ENTITY_KINDS = new Set(["domain", "subdomain", "team"]);
const OUTCOME_ENTITY_KINDS = new Set(["okr", "kpi"]);
const ENTITY_STATUSES = ["active", "inactive", "candidate", "archived"];

async function upsertEntity(cli) {
  const existing = await cli.json(["entity", "list", "--json"]);
  const pick = await vscode.window.showQuickPick(
    [{ label: "Create new entity", entity: undefined }, ...(existing || []).map((entity) => ({ label: entity.label || entity.id, description: `${entity.kind} · ${entity.status || "active"}`, detail: entity.id, entity }))],
    { title: "Entity" }
  );
  if (!pick) return;
  const current = pick.entity;
  if (current && OUTCOME_ENTITY_KINDS.has(current.kind)) {
    await vscode.window.showInformationMessage(
      `${current.kind.toUpperCase()} entities use structured outcome fields. Edit them from Today or ask the OneAgent Outcomes agent tool.`
    );
    return;
  }
  const id = current?.id || await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Entity id", placeHolder: "valentin-mission-2026", validateInput: validateId });
  if (!id) return;
  const kind = current?.kind || await vscode.window.showQuickPick(ENTITY_KINDS, {
    title: "Entity kind",
    placeHolder: "A product is an entity that also carries a git repository and BMAD."
  });
  if (!kind) return;
  const label = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Label", value: current?.label || humanizeId(id) });
  if (label === undefined) return;
  const description = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Description", placeHolder: "Short explanation used by the agent, search and graph", value: current?.description || "" });
  if (description === undefined) return;
  const status = await vscode.window.showQuickPick(ENTITY_STATUSES, { title: "Status", placeHolder: current?.status || "active" });
  if (!status) return;
  const tags = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Tags, comma-separated", value: (current?.tags || []).join(", ") });
  if (tags === undefined) return;

  const args = ["entity", "upsert", id, "--kind", kind, "--label", label || humanizeId(id), "--status", status];
  if (description.trim()) args.push("--description", description.trim());
  if (tags.trim()) args.push("--tags", tags.trim());
  if (ORG_ENTITY_KINDS.has(kind)) {
    const parent = await pickEntityId(cli, "Parent entity", current?.parentId, true);
    if (parent === undefined) return;
    if (parent) args.push("--parent", parent);
  }
  const repoPath = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Optional: git repo path to project this entity's curated wiki into (leave empty for global wiki only)",
    value: current?.repoPath || ""
  });
  if (repoPath === undefined) return;
  if (repoPath.trim()) {
    args.push("--repo", repoPath.trim(), "--wiki-root", current?.wikiRoot || "docs/wiki");
  }
  await runCliTask(cli, `Saving entity ${kind}:${id}`, args);
}

async function deleteEntity(cli) {
  const existing = await cli.json(["entity", "list", "--json"]);
  if (!existing || existing.length === 0) {
    await vscode.window.showWarningMessage("No entities to delete.");
    return;
  }
  const pick = await vscode.window.showQuickPick(
    existing.map((entity) => ({ label: entity.label || entity.id, description: `${entity.kind} · ${entity.status || "active"}`, detail: entity.id, entity })),
    { title: "Delete entity" }
  );
  if (!pick) return;
  const { kind, id } = pick.entity;
  const choice = await vscode.window.showWarningMessage(
    `Delete entity ${kind}:${id}? Captures referencing it will be reassigned to OneAgent.`,
    { modal: true },
    "Delete"
  );
  if (choice !== "Delete") return;
  await runCliTask(cli, `Deleting entity ${kind}:${id}`, ["entity", "delete", id, "--kind", kind, "--reassign-oneagent"]);
}

async function upsertEntityLink(cli) {
  const existing = await cli.json(["links", "--json"]);
  const pick = await vscode.window.showQuickPick(
    [{ label: "Create new link", link: undefined }, ...(existing || []).map((link) => ({ label: link.id, description: `${link.sourceId} --${link.type}--> ${link.targetId}`, detail: link.description, link }))],
    { title: "Organization link" }
  );
  if (!pick) return;
  const current = pick.link;
  const source = await pickEntityId(cli, "Link source", current?.sourceId, false, true);
  if (!source) return;
  const target = await pickEntityId(cli, "Link target", current?.targetId, false, true);
  if (!target) return;
  const type = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Link type", value: current?.type || "depends_on" });
  if (!type) return;
  const description = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Link description", value: current?.description || "" });
  if (description === undefined) return;
  const args = ["link", "upsert", "--source", source, "--target", target, "--type", type.trim()];
  if (current?.id) args.push("--id", current.id);
  if (description.trim()) args.push("--description", description.trim());
  await runCliTask(cli, `Saving link ${source} -> ${target}`, args);
}

async function deleteEntityLink(cli) {
  const links = await cli.json(["links", "--json"]);
  if (!links || links.length === 0) {
    await vscode.window.showWarningMessage("No organization links configured.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    links.map((link) => ({ label: link.id, description: `${link.sourceId} --${link.type}--> ${link.targetId}`, link })),
    { title: "Delete organization link" }
  );
  if (!picked) return;
  await runCliTask(cli, `Deleting link ${picked.link.id}`, ["link", "delete", picked.link.id]);
}

async function deleteGraphEntity(cli, webview, message) {
  const ref = String(message.ref || "").trim();
  const [kind, ...idParts] = ref.split(":");
  const id = idParts.join(":");
  if (!kind || !id) {
    await vscode.window.showWarningMessage("No deletable entity selected.");
    return;
  }
  const label = String(message.label || ref);
  const choice = await vscode.window.showWarningMessage(
    `Delete entity ${label} (${kind}:${id})? Captures referencing it will be reassigned to OneAgent.`,
    { modal: true },
    "Delete"
  );
  if (choice !== "Delete") return;
  await postOperation(webview, "running", `Deleting entity ${kind}:${id}...`);
  await cli.run(["entity", "delete", id, "--kind", kind, "--reassign-oneagent"]);
  await postOperation(webview, "success", `Deleted entity ${kind}:${id}.`);
}

async function updateGraphEntity(cli, webview, message) {
  const ref = String(message.ref || "").trim();
  const [oldKind, ...idParts] = ref.split(":");
  const id = idParts.join(":");
  const newKind = String(message.kind || oldKind || "").trim();
  const label = String(message.label || id || "").trim() || id;
  const description = String(message.description || "");
  const status = String(message.status || "active").trim();
  const focusLevel = String(message.focusLevel || "informational").trim();
  const ownerIds = Array.isArray(message.ownerIds)
    ? message.ownerIds.map((owner) => String(owner).trim()).filter(Boolean)
    : undefined;
  const contributorIds = Array.isArray(message.contributorIds)
    ? message.contributorIds.map((contributor) => String(contributor).trim()).filter(Boolean)
    : undefined;
  if (!oldKind || !id || !newKind) {
    throw new Error("Missing entity reference or target type.");
  }
  if (OUTCOME_ENTITY_KINDS.has(oldKind) || OUTCOME_ENTITY_KINDS.has(newKind)) {
    throw new Error("OKR and KPI entities must be edited through the structured Today outcome controls; their type cannot be changed here.");
  }
  if (oldKind !== newKind && ["oneagent", "repository", "discovery"].includes(oldKind)) {
    throw new Error(`Entity type for ${oldKind}:${id} is controlled by the workspace configuration.`);
  }
  const targetRef = `${newKind}:${id}`;
  const existing = await findEntityRecord(cli, oldKind, id);
  const existingTarget = oldKind === newKind ? existing : await findEntityRecord(cli, newKind, id);
  if (oldKind !== newKind && existingTarget) {
    throw new Error(`Cannot move ${ref}: target ${targetRef} already exists. Use the explicit merge action instead.`);
  }
  const args = ["entity", "upsert", id, "--kind", newKind, "--label", label, "--description", description];
  if (status) {
    args.push("--status", status);
  }
  if (focusLevel) {
    args.push("--focus-level", focusLevel);
  }
  if (existing?.aliases?.length) {
    args.push("--aliases", existing.aliases.join(","));
  }
  if (existing?.parentId) {
    args.push("--parent", existing.parentId);
  }
  if (ownerIds !== undefined) {
    args.push("--owners", ownerIds.join(","));
  } else if (existing?.ownerIds?.length) {
    args.push("--owners", existing.ownerIds.join(","));
  }
  if (contributorIds !== undefined) {
    args.push("--contributors", contributorIds.join(","));
  } else if (existing?.contributorIds?.length) {
    args.push("--contributors", existing.contributorIds.join(","));
  }
  if (existing?.tags?.length) {
    args.push("--tags", existing.tags.join(","));
  }
  let metadata = existing?.metadata && typeof existing.metadata === "object" ? { ...existing.metadata } : undefined;
  if (newKind === "discovery") {
    const previous = metadata?.discovery && typeof metadata.discovery === "object" && !Array.isArray(metadata.discovery)
      ? metadata.discovery
      : {};
    const phase = String(message.discoveryPhase || previous.phase || "framing").trim();
    const outcome = Object.hasOwn(message, "discoveryOutcome")
      ? String(message.discoveryOutcome || "").trim()
      : String(previous.outcome || "").trim();
    const lifecycle = {
      ...previous,
      schemaVersion: 1,
      phase,
      conclusionCriteria: Array.isArray(message.discoveryConclusionCriteria)
        ? message.discoveryConclusionCriteria.map((criterion) => String(criterion).trim()).filter(Boolean)
        : Array.isArray(previous.conclusionCriteria) ? previous.conclusionCriteria : []
    };
    if (phase === "concluded" && outcome) lifecycle.outcome = outcome;
    else delete lifecycle.outcome;
    for (const [key, value] of [
      ["startedAt", message.discoveryStartedAt],
      ["targetEndAt", message.discoveryTargetEndAt],
      ["concludedAt", message.discoveryConcludedAt]
    ]) {
      const messageKey = key === "startedAt" ? "discoveryStartedAt" : key === "targetEndAt" ? "discoveryTargetEndAt" : "discoveryConcludedAt";
      if (!Object.hasOwn(message, messageKey)) continue;
      const normalized = String(value || "").trim();
      if (normalized) lifecycle[key] = normalized;
      else delete lifecycle[key];
    }
    metadata = { ...(metadata || {}), discovery: lifecycle };
  } else if (oldKind === "discovery" && metadata) {
    delete metadata.discovery;
  }
  if (metadata && Object.keys(metadata).length > 0) {
    args.push("--metadata", JSON.stringify(metadata));
  }
  if (existing?.repoPath) {
    args.push("--repo", existing.repoPath);
  }
  if (existing?.wikiRoot) {
    args.push("--wiki-root", existing.wikiRoot);
  }

  await postOperation(webview, "running", oldKind === newKind ? `Updating ${ref}...` : `Moving ${ref} to ${targetRef}...`);
  if (oldKind === "product" && newKind !== oldKind && !existing) {
    const seedArgs = ["entity", "upsert", id, "--kind", oldKind, "--label", label, "--description", description];
    if (status) {
      seedArgs.push("--status", status);
    }
    if (focusLevel) {
      seedArgs.push("--focus-level", focusLevel);
    }
    await cli.run(seedArgs);
  }
  let targetCreated = false;
  try {
    await cli.run(args);
    targetCreated = oldKind !== newKind;
    if (oldKind !== newKind) {
      await cli.run(["entity", "merge", ref, "--into", targetRef]);
      targetCreated = false;
      if (oldKind === "product") {
        await cli.run(["product", "delete", id]);
      }
    }
  } catch (error) {
    if (targetCreated) {
      try {
        await cli.run(["entity", "delete", id, "--kind", newKind, "--reassign-oneagent"], { logOutput: false });
      } catch (cleanupError) {
        cli.output.appendLine(`Could not roll back temporary ${targetRef}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    throw error;
  }
  await postOperation(webview, "success", oldKind === newKind ? `Updated ${targetRef}.` : `Moved ${ref} to ${targetRef}.`);
  await postEntityContext(cli, webview, targetRef);
  return targetRef;
}

async function findEntityRecord(cli, kind, id) {
  try {
    const entities = await cli.json(["entity", "list", "--json"]);
    return (entities || []).find((entity) => entity.kind === kind && entity.id === id);
  } catch (error) {
    cli.output.appendLine(`Entity lookup failed for ${kind}:${id}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function deleteGraphRelation(cli, webview, message) {
  const relationId = String(message.relationId || "").trim();
  const linkId = String(message.linkId || "").trim();
  const label = String(message.label || relationId || linkId || "relation");
  if (!relationId && !linkId) {
    await vscode.window.showWarningMessage("This graph relation is derived and cannot be deleted directly. Hide its relation type from the graph filters instead.");
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Delete relation ${label}?`,
    { modal: true },
    "Delete"
  );
  if (choice !== "Delete") return;
  if (relationId) {
    await postOperation(webview, "running", `Deleting relation ${relationId}...`);
    await cli.run(["relation", "delete", relationId]);
    await postOperation(webview, "success", `Deleted relation ${label}.`);
    return;
  }
  await postOperation(webview, "running", `Deleting organization link ${linkId}...`);
  await cli.run(["link", "delete", linkId]);
  await postOperation(webview, "success", `Deleted organization link ${label}.`);
}

async function updateGraphRelation(cli, webview, message) {
  const relationId = String(message.relationId || "").trim();
  const source = String(message.source || "").trim();
  const target = String(message.target || "").trim();
  const relationType = String(message.relationType || "").trim();
  const description = String(message.description || "");
  const originalSource = String(message.originalSource || "").trim();
  const originalTarget = String(message.originalTarget || "").trim();
  const originalRelationType = String(message.originalRelationType || "").trim();
  if (!relationId || !source || !target || !relationType || source === target) {
    throw new Error("A relation needs two distinct entities and a relation type.");
  }

  const args = ["relation", "upsert", "--source", source, "--target", target, "--type", relationType, "--description", description];
  const capturedFrom = Array.isArray(message.capturedFrom)
    ? message.capturedFrom.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (capturedFrom.length > 0) {
    args.push("--metadata", JSON.stringify({ capturedFrom }));
  }

  const identityChanged = source !== originalSource || target !== originalTarget || relationType !== originalRelationType;
  await postOperation(webview, "running", `Updating relation ${relationId}...`);
  await cli.run(args);
  if (identityChanged) {
    await cli.run(["relation", "delete", relationId]);
  }
  await postOperation(webview, "success", `Updated ${source} —${relationType}→ ${target}.`);
  await postEntityContext(cli, webview, source);
  if (target !== source) await postEntityContext(cli, webview, target);
}

/** Drive `wm taxonomy` from the cockpit Settings › Taxonomy section. */
async function runTaxonomyAction(cli, webview, message) {
  const action = String(message.action || "");
  const args = ["taxonomy"];

  if (action === "addKind") {
    args.push("add-kind", String(message.id || ""), "--description", String(message.description || ""));
    if (message.label) args.push("--label", String(message.label));
    if (message.color) args.push("--color", String(message.color));
  } else if (action === "updateKind") {
    args.push("update-kind", String(message.id || ""));
    if (message.label) args.push("--label", String(message.label));
    if (message.color) args.push("--color", String(message.color));
    if (typeof message.description === "string" && message.description) args.push("--description", String(message.description));
  } else if (action === "mergeKind") {
    const choice = await vscode.window.showWarningMessage(
      `Merge entity type "${String(message.from)}" into "${String(message.into)}"? All its entities are retyped; the type ${String(message.builtin ? "becomes an alias" : "is removed")}.`,
      { modal: true },
      "Merge"
    );
    if (choice !== "Merge") return;
    args.push("merge-kind", String(message.from || ""), "--into", String(message.into || ""));
  } else if (action === "deleteKind") {
    const choice = await vscode.window.showWarningMessage(
      `Delete entity type "${String(message.id)}"? (Only possible while no entity uses it.)`,
      { modal: true },
      "Delete"
    );
    if (choice !== "Delete") return;
    args.push("delete-kind", String(message.id || ""));
  } else if (action === "unaliasKind") {
    args.push("unalias-kind", String(message.id || ""));
  } else if (action === "addRelation") {
    args.push("add-relation", String(message.relationType || ""), "--category", String(message.category || "work"));
    if (message.reading) args.push("--reading", String(message.reading));
    if (message.description) args.push("--description", String(message.description));
    if (message.absorb) args.push("--absorb", String(message.absorb));
  } else if (action === "updateRelation") {
    args.push("update-relation", String(message.relationType || ""));
    if (message.category) args.push("--category", String(message.category));
    if (typeof message.reading === "string") args.push("--reading", String(message.reading));
    if (typeof message.description === "string") args.push("--description", String(message.description));
  } else if (action === "mergeRelation") {
    const choice = await vscode.window.showWarningMessage(
      `Merge relation type "${String(message.from)}" into "${String(message.into)}"${message.swap ? " (source and target swapped)" : ""}? All its relations are rewritten.`,
      { modal: true },
      "Merge"
    );
    if (choice !== "Merge") return;
    args.push("merge-relation", String(message.from || ""), "--into", String(message.into || ""));
    if (message.swap) args.push("--swap");
  } else if (action === "unaliasRelation") {
    args.push("unalias-relation", String(message.from || ""));
  } else {
    throw new Error(`Unknown taxonomy action: ${action}`);
  }

  await postOperation(webview, "running", `Taxonomy: ${action}...`);
  await cli.run(args);
  await postOperation(webview, "success", `Taxonomy updated (${action}).`);
}

async function postEntityContext(cli, webview, ref, requestId) {
  const cleanRef = String(ref || "").trim();
  if (!cleanRef) return;
  try {
    // Human graph inspection uses the same portfolio as graph-view. Reading a
    // card must not activate, expand or clear the agent's strict context scope.
    const payload = await cli.json(["entity", "context", cleanRef, "--json"]);
    if (!payload?.entity || `${payload.entity.kind}:${payload.entity.id}` !== cleanRef) {
      throw new Error("OneAgent returned an invalid entity context.");
    }
    await webview.postMessage({ type: "entityContext", ref: cleanRef, requestId, payload });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    cli.output?.appendLine?.(`Entity context failed for ${cleanRef}: ${detail}`);
    await webview.postMessage({ type: "entityContext", ref: cleanRef, requestId, error: detail });
  }
}

async function pickEntityId(cli, title, selectedId, allowNone, includeProducts = false) {
  const entities = await cli.json(["entities", "--json"]);
  const products = includeProducts ? await cli.json(["products", "--json"]) : [];
  const options = [
    ...(allowNone ? [{ label: "None", description: "No parent", id: "" }] : []),
    ...(entities || []).map((entity) => ({ label: entity.label || entity.id, description: entity.kind, detail: entity.id, id: entity.id })),
    ...(products || []).map((product) => ({ label: product.label || product.id, description: "product", detail: product.id, id: product.id }))
  ];
  if (options.length === 0) {
    if (allowNone) return "";
    await vscode.window.showWarningMessage("No organization entities configured.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(options, { title, placeHolder: selectedId || undefined });
  return picked?.id;
}

async function addProduct(cli) {
  const id = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "checkout-api",
    prompt: "Product id",
    validateInput: validateId
  });
  if (!id) {
    return;
  }

  const label = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Product label",
    value: humanizeId(id)
  });
  if (label === undefined) {
    return;
  }

  const description = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "Optional short product description",
    prompt: "Product description"
  });
  if (description === undefined) {
    return;
  }

  const parentEntityId = await pickEntityId(cli, "Parent organization entity", undefined, true);
  if (parentEntityId === undefined) {
    return;
  }

  const dependencies = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "product-a,product-b",
    prompt: "Direct dependencies"
  });
  if (dependencies === undefined) {
    return;
  }

  const setupMode = await vscode.window.showQuickPick(
    [
      {
        label: "Clone a Git repository",
        description: "Recommended",
        detail: "Clone the product repository into the current workspace, create wiki/BMAD folders, then register it.",
        mode: "clone"
      },
      {
        label: "Use an existing local folder",
        description: "Register an already cloned repository",
        detail: "Pick a folder on disk and register it as this product repository.",
        mode: "existing"
      },
      {
        label: "Config only",
        description: "Create the product without a repository",
        detail: "Useful if you want to attach repositories later.",
        mode: "config"
      }
    ],
    { placeHolder: "How should OneAgent set up this product?" }
  );
  if (!setupMode) {
    return;
  }

  let repoPath;
  let gitRemote;
  let repoId;

  if (setupMode.mode === "clone") {
    gitRemote = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: "git@github.com:org/repository.git",
      prompt: "Git repository URL to clone"
    });
    if (!gitRemote || !gitRemote.trim()) {
      return;
    }

    const defaultFolderName = repositoryNameFromRemote(gitRemote.trim()) || id;
    const folderName = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Folder name inside the current workspace",
      value: defaultFolderName,
      validateInput: validateFolderName
    });
    if (!folderName) {
      return;
    }

    repoPath = path.join(cli.memoryWorkspaceRoot(), folderName.trim());
    repoId = folderName.trim();
    if (fs.existsSync(repoPath) && fs.readdirSync(repoPath).length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `Folder already exists and is not empty: ${repoPath}`,
        { modal: true },
        "Use Existing Folder",
        "Cancel"
      );
      if (choice !== "Use Existing Folder") {
        return;
      }
    } else if (!fs.existsSync(repoPath)) {
      const cloned = await cloneRepository(gitRemote.trim(), repoPath);
      if (!cloned) {
        return;
      }
    }
  }

  if (setupMode.mode === "existing") {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(cli.memoryWorkspaceRoot()),
      title: `Select repository folder for ${id}`
    });
    if (!selected || selected.length === 0) {
      return;
    }
    repoPath = selected[0].fsPath;
    repoId = path.basename(repoPath);
  }

  const args = ["product", "add", id, "--label", label || humanizeId(id)];
  if (description.trim()) {
    args.push("--description", description.trim());
  }
  if (parentEntityId) {
    args.push("--parent", parentEntityId);
  }
  if (dependencies.trim()) {
    args.push("--dependencies", dependencies.trim());
  }

  await runCliTask(cli, `Adding product ${id}`, args);

  if (repoPath) {
    const repositoryId = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Repository id",
      value: sanitizeId(repoId || id),
      validateInput: validateId
    });
    if (!repositoryId) {
      await vscode.window.showInformationMessage(`Product added without repository: ${id}`);
      return;
    }

    const repoArgs = [
      "repo",
      "add",
      id,
      repositoryId,
      "--path",
      repoPath,
      "--role",
      "specs",
      "--wiki-root",
      "docs/wiki",
      "--specs-root",
      "_specs/planning-artifacts"
    ];
    if (gitRemote) {
      repoArgs.push("--git-remote", gitRemote.trim());
    }
    await runCliTask(cli, `Registering repository ${repositoryId}`, repoArgs);
    await vscode.window.showInformationMessage(`Product added: ${id}. Repository registered at ${repoPath}`);
    return;
  }

  await vscode.window.showInformationMessage(`Product added: ${id}`);
}

async function createTask(cli) {
  const title = await vscode.window.showInputBox({
    title: "Create OneAgent Task",
    prompt: "Task title",
    placeHolder: "Review contract ownership before accepting wiki proposal",
    validateInput: (value) => {
      if (!value.trim()) return "A task title is required.";
      if (value.trim().length > 180) return "Use 180 characters or less.";
      return undefined;
    }
  });
  if (!title) return;

  const body = await vscode.window.showInputBox({
    title: "Create OneAgent Task",
    prompt: "Description",
    placeHolder: "What should be done, and why?"
  });

  const priority = await vscode.window.showQuickPick(["medium", "high", "critical", "low"], {
    title: "Create OneAgent Task",
    placeHolder: "Priority"
  });
  if (!priority) return;

  const assignee = await vscode.window.showQuickPick(["me", "agent"], {
    title: "Create OneAgent Task",
    placeHolder: "Assignee"
  });
  if (!assignee) return;

  const deadline = await vscode.window.showInputBox({
    title: "Create OneAgent Task",
    prompt: "Deadline (optional)",
    placeHolder: "YYYY-MM-DD"
  });
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline.trim())) {
    throw new Error("Task deadline must use YYYY-MM-DD.");
  }

  const args = ["tasks", "create", title.trim(), "--priority", priority, "--assignee", assignee];
  if (body?.trim()) args.push("--body", body.trim());
  if (deadline?.trim()) args.push("--deadline", deadline.trim());
  await runCliTask(cli, `Creating task ${title.trim()}`, args);
}

async function captureMemory(cli) {
  const product = await pickProduct(cli);
  if (!product) return;

  const captureType = await vscode.window.showQuickPick(captureTypeOptions(), {
    title: "Capture Memory",
    placeHolder: "Input type"
  });
  if (!captureType) return;

  const title = await vscode.window.showInputBox({
    title: "Capture Memory",
    prompt: "Title",
    placeHolder: "Contract sync",
    validateInput: (value) => value.trim() ? undefined : "A title is required."
  });
  if (!title) return;

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: `# ${title.trim()}\n\nPaste the capture content here, then run OneAgent: Ingest Current File or use the cockpit Capture form for one-step save.\n`
  });
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.window.showInformationMessage(
    `Capture target: ${product.id} / ${captureType.label}. Use the cockpit form to save and ingest in one step.`
  );
}

async function resetMemory(cli) {
  const choice = await vscode.window.showWarningMessage(
    "Reset OneAgent test data for this workspace?",
    { modal: true, detail: "Reset Memory keeps products/repositories config. Reset Everything removes the whole .work-memory folder, including config." },
    "Reset Memory",
    "Reset Everything"
  );
  if (!choice) {
    return false;
  }

  if (choice === "Reset Everything") {
    await runCliTask(cli, "Resetting OneAgent workspace", ["reset", "--all"]);
    await cli.ensureDefaultConfig();
    await vscode.window.showInformationMessage("OneAgent reset complete. Configuration was recreated empty.");
    return true;
  }

  await runCliTask(cli, "Resetting OneAgent memory", ["reset"]);
  await vscode.window.showInformationMessage("OneAgent memory reset complete. Product configuration was preserved.");
  return true;
}

async function addRepository(cli, item) {
  const product = productFromItem(item) || await pickProduct(cli);
  if (!product) {
    return;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(cli.projectRoot()),
    title: `Select repository for ${product.id}`
  });
  if (!selected || selected.length === 0) {
    return;
  }
  const repoPath = selected[0].fsPath;

  const repoId = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Repository id",
    value: path.basename(repoPath),
    validateInput: validateId
  });
  if (!repoId) {
    return;
  }

  const role = await vscode.window.showQuickPick(
    ["specs", "code", "docs", "lib", "external-context"].map((label) => ({ label })),
    { placeHolder: "Repository role" }
  );
  if (!role) {
    return;
  }

  const wikiRoot = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "docs/wiki",
    prompt: "Wiki root inside repository"
  });
  if (wikiRoot === undefined) {
    return;
  }

  const specsRoot = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "_specs/planning-artifacts",
    prompt: "Specs root inside repository"
  });
  if (specsRoot === undefined) {
    return;
  }

  const args = ["repo", "add", product.id, repoId, "--path", repoPath, "--role", role.label];
  if (wikiRoot.trim()) {
    args.push("--wiki-root", wikiRoot.trim());
  }
  if (specsRoot.trim()) {
    args.push("--specs-root", specsRoot.trim());
  }

  await runCliTask(cli, `Adding repository ${repoId}`, args);
  await vscode.window.showInformationMessage(`Repository added to ${product.id}: ${repoId}`);
}

async function reindexRepository(cli, item) {
  const itemEntity = item?.entity || item;
  let repository = itemEntity?.kind === "repository" && typeof itemEntity.id === "string"
    ? itemEntity
    : undefined;
  if (!repository) {
    const repositories = await cli.json(["entity", "list", "--kind", "repository", "--json"]);
    const indexableRepositories = (repositories || []).filter(
      (candidate) => typeof candidate.id === "string" && typeof candidate.repoPath === "string" && candidate.repoPath.trim()
    );
    if (indexableRepositories.length === 0) {
      await vscode.window.showWarningMessage("No repository entity with a repoPath is available.");
      return;
    }
    if (indexableRepositories.length === 1) {
      [repository] = indexableRepositories;
    } else {
      const selected = await vscode.window.showQuickPick(
        indexableRepositories.map((candidate) => ({
          label: candidate.label || candidate.id,
          description: `repository:${candidate.id}`,
          repository: candidate
        })),
        { placeHolder: "Select repository entity to reindex" }
      );
      repository = selected?.repository;
    }
  }
  if (!repository) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: "wiki", description: "Generated and curated wiki pages", picked: true },
      { label: "bmad", description: "Planning artifacts and BMAD docs", picked: true }
    ],
    {
      canPickMany: true,
      placeHolder: "Content to reindex"
    }
  );
  if (!picked || picked.length === 0) {
    return;
  }

  const include = picked.map((entry) => entry.label).join(",");
  await runCliTask(
    cli,
    `Reindexing repository:${repository.id}`,
    ["reindex", "--entity", `repository:${repository.id}`, "--include", include]
  );
  await vscode.window.showInformationMessage(`Reindexed: repository:${repository.id}`);
}

async function ingestCurrentFile(cli) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage("Open a file before ingesting it into OneAgent.");
    return;
  }
  if (editor.document.isUntitled) {
    await vscode.window.showWarningMessage("Save the file before ingesting it into OneAgent.");
    return;
  }
  if (editor.document.isDirty) {
    const saved = await editor.document.save();
    if (!saved) {
      return;
    }
  }

  const product = await pickProduct(cli);
  if (!product) {
    return;
  }

  // Converge on the capture pipeline: capture (raw source of truth) -> index -> agent curation.
  const filePath = editor.document.uri.fsPath;
  const body = fs.readFileSync(filePath, "utf8");
  const capture = JSON.parse(await cli.run([
    "capture", "create",
    "--content-type", "document",
    "--title", path.basename(filePath),
    "--primary", `product:${product.id}`,
    "--source-kind", "file",
    "--source-origin", "vscode_command",
    "--stdin",
    "--json"
  ], { input: body, logOutput: true }));
  const reingest = await cli.json(["capture", "reingest", capture.id, "--json"]);
  assertReingestSucceeded(reingest, capture.id);
  const curation = await curateCaptureWithAgent(cli, capture.id);
  const curationNote = curation.ok
    ? `curated (${(curation.toolsUsed || []).length} tool calls)`
    : `curation pending: ${curation.reason}`;
  await vscode.window.showInformationMessage(
    `Captured into ${product.id}: ${capture.title || path.basename(filePath)} (${Number(reingest?.chunks || 0)} chunks, ${curationNote}).`
  );
}

/** Drain the curation queue: re-run the agent loop over pending and failed captures. */
async function curatePendingCaptures(cli) {
  const queue = await cli.json(["curation", "queue", "--json"]);
  if (!queue || queue.length === 0) {
    await vscode.window.showInformationMessage("OneAgent: the curation queue is empty.");
    return;
  }
  let curated = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "OneAgent: curating pending captures" },
    async (progress) => {
      for (const [index, item] of queue.entries()) {
        progress.report({ message: `${index + 1}/${queue.length} — ${item.title}` });
        const result = await curateCaptureWithAgent(cli, item.id);
        if (result.ok) {
          curated += 1;
        } else {
          cli.output.appendLine(`Backfill: curation failed for ${item.id}: ${result.reason}`);
        }
      }
    }
  );
  await vscode.window.showInformationMessage(
    `OneAgent: curated ${curated}/${queue.length} queued capture(s).${curated < queue.length ? " See the OneAgent output channel for failures." : ""}`
  );
}

/** Run the deterministic wiki lint, then drive the agent consolidation pass over its findings. */
async function lintWikiWithProgress(cli) {
  const report = await cli.json(["wiki", "lint", "--json"]);
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  if (findings.length === 0) {
    await vscode.window.showInformationMessage(
      `OneAgent: wiki is clean (${report?.pagesScanned || 0} pages, ${report?.entitiesChecked || 0} entities).`
    );
    return;
  }
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `OneAgent: consolidating wiki (${findings.length} issue(s))` },
    async () => lintWikiWithAgent(cli)
  );
  if (result.ok) {
    await vscode.window.showInformationMessage(
      `OneAgent: wiki lint pass done (${result.findings} issue(s), ${(result.toolsUsed || []).length} tool calls). Review the inbox.`
    );
  } else {
    // The agent pass is optional; the deterministic findings are still filed for the human.
    await cli.run(["wiki", "lint", "--inbox"]);
    await vscode.window.showWarningMessage(
      `OneAgent: agent lint pass unavailable (${result.reason}). ${findings.length} finding(s) filed in the inbox instead.`
    );
  }
}

async function searchMemory(cli) {
  const query = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    placeHolder: "Search specs, wiki, decisions, risks...",
    prompt: "OneAgent search"
  });
  if (!query || !query.trim()) {
    return;
  }

  const plane = await vscode.window.showQuickPick(
    [
      { label: "All knowledge", description: "Accepted knowledge, weak signals, active sources and history", id: "all" },
      { label: "Accepted knowledge", description: "Human-validated observations", id: "accepted" },
      { label: "Weak signals", description: "Captured or proposed observations, not validated facts", id: "signals" },
      { label: "Active sources", description: "Current indexed source content", id: "sources" },
      { label: "History", description: "Rejected, superseded and obsolete knowledge", id: "history" }
    ],
    { placeHolder: "Knowledge plane" }
  );
  if (!plane) {
    return;
  }

  const products = await cli.json(["products", "--json"]);
  const scope = await vscode.window.showQuickPick(
    [
      { label: "Portfolio", description: "All entities and configured products" },
      ...(products || []).map((product) => ({
        label: product.label || product.id,
        description: product.id,
        product
      }))
    ],
    { placeHolder: "Search scope" }
  );
  if (!scope) {
    return;
  }

  const args = [
    "search", query.trim(),
    "--json", "--limit", "8",
    "--plane", plane.id,
    "--context-scope", "active"
  ];
  if (scope.product) {
    args.push("--product", scope.product.id, "--scope", "product");
  } else {
    args.push("--scope", "portfolio");
  }

  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Searching OneAgent"
    },
    () => cli.json(args)
  );
  showSearchResults(cli, query.trim(), results || [], plane.id);
}

async function openCockpit(cli, existingPanel, options = {}) {
  const panel = existingPanel || vscode.window.createWebviewPanel(
    "workMemoryCockpit",
    "OneAgent Cockpit",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.reveal(vscode.ViewColumn.One);

  if (existingPanel) {
    await postCockpitState(cli, panel.webview, options);
  } else {
    await attachCockpitWebview(cli, panel.webview, options);
  }
  return panel;
}

async function attachCockpitWebview(cli, webview, options = {}) {
  const mediaRoot = vscode.Uri.joinPath(cli.context.extensionUri, "media");
  webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
  const renderAssets = {
    cspSource: webview.cspSource,
    graphViewerScript: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "graph-viewer.bundle.js")).toString(),
    nonce: createNonce()
  };
  try {
    webview.html = renderCockpitHtml(
      await loadCockpitState(cli, { ...options, includeDocumentation: true }),
      renderAssets
    );
  } catch (error) {
    const detail = error && error.stack ? error.stack : String(error);
    try { cli.output.appendLine(`Cockpit failed to load: ${detail}`); } catch {}
    try {
      const documentation = await cli.documentationPayload();
      webview.html = renderCockpitHtml(createDocumentationOnlyCockpitState({
        documentation,
        extensionVersion: cli.extensionVersion()
      }), renderAssets);
    } catch (documentationError) {
      const documentationDetail = documentationError && documentationError.stack
        ? documentationError.stack
        : String(documentationError);
      try { cli.output.appendLine(`Documentation-only cockpit also failed to load: ${documentationDetail}`); } catch {}
      const escaped = `${detail}\n\nDocumentation fallback: ${documentationDetail}`
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family),sans-serif;color:var(--vscode-foreground);padding:16px;line-height:1.5;">`
        + `<h3 style="margin-top:0;">OneAgent cockpit failed to load</h3>`
        + `<p>Copy this error and share it, then run "OneAgent: Refresh".</p>`
        + `<pre style="white-space:pre-wrap;user-select:text;background:rgba(127,127,127,0.12);padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${escaped}</pre>`
        + `</body></html>`;
    }
  }
  webview.onDidReceiveMessage(async (message) => {
    await handleCockpitMessage(cli, webview, message);
  });
}

async function postCockpitState(cli, webview, options = {}) {
  await webview.postMessage({ type: "state", payload: await loadCockpitState(cli, options) });
}

function createDocumentationOnlyCockpitState(options = {}) {
  const documentation = options.documentation || { defaultGuideId: "documentation-unavailable", guides: [] };
  return {
    documentationOnly: true,
    graph: {
      scope: "portfolio",
      includedProductIds: [],
      generatedAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      diagnostics: []
    },
    tasks: [],
    inbox: [],
    graphChangeHistory: [],
    graphChangeHistoryState: { available: false, partial: true },
    curationPackages: [],
    curationPackageHistory: [],
    curationPackageHistoryState: { available: false, partial: true },
    curationCapabilities: {
      packageHistory: false,
      crossPackageEvidence: false,
      graphProposalPromotion: false
    },
    sources: [],
    diagnostics: [],
    entities: [],
    captures: [],
    manualNotes: [],
    today: {
      summary: {},
      dueSoon: [],
      blocked: [],
      agentQueue: [],
      activeWork: [],
      objectives: [],
      upcomingReviews: [],
      inbox: [],
      outcomes: {
        generatedAt: new Date().toISOString(),
        summary: {
          missions: 0,
          okrs: 0,
          atRiskOkrs: 0,
          kpis: 0,
          kpisChanged: 0,
          staleKpis: 0,
          workWithoutMeasurement: 0
        },
        missions: [],
        standaloneOkrs: [],
        kpis: [],
        alerts: []
      }
    },
    graphFilters: undefined,
    contextScope: undefined,
    cockpitTheme: "dark",
    graphViews: [],
    taxonomy: { entityKinds: [], relationTypes: [] },
    extensionVersion: options.extensionVersion || "unknown",
    documentation,
    documentationState: documentation.launchState
  };
}

function isContextBoundaryError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /active strict|strict context|boundary change|outside the active strict context/i.test(message);
}

async function runContextBoundaryCommand(cli, args, options, authorization, action) {
  const run = (allowBoundaryChange) => cli.run(
    allowBoundaryChange && !args.includes("--allow-boundary-change") ? [...args, "--allow-boundary-change"] : args,
    options
  );
  if (authorization.approved) {
    return { cancelled: false, output: await run(true) };
  }
  try {
    return { cancelled: false, output: await run(false) };
  } catch (error) {
    if (!isContextBoundaryError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    if (authorization.createOnlyRef && detail.includes(`Entity is outside the active strict context scope: ${authorization.createOnlyRef}`)) {
      throw new Error(`The id ${authorization.createOnlyRef} is unavailable in the active context. Choose another id or activate the existing entity; Add never overwrites it.`);
    }
    const choice = await vscode.window.showWarningMessage(
      `${action} changes the active strict context boundary.`,
      {
        modal: true,
        detail: `${detail}\n\nOnly confirm if you intentionally want the agent's allowed context to change.`
      },
      "Change context boundary"
    );
    if (choice !== "Change context boundary") return { cancelled: true };
    authorization.approved = true;
    return { cancelled: false, output: await run(true) };
  }
}

async function cancelContextBoundaryChange(webview) {
  await webview.postMessage({ type: "contextBoundaryCancelled" });
}

async function handleCockpitMessage(cli, webview, message) {
  try {
    if (message.type === "priorityRequest") {
      try {
        if (!["list", "save", "reorder", "delete"].includes(message.operation)) throw new Error("Unknown priorities action.");
        const payload = JSON.parse(await cli.run(["priorities", message.operation, "--stdin", "--json"], { input: JSON.stringify({ ...message.input, scope: "portfolio" }), logOutput: false }));
        await webview.postMessage({ type: "priorityResult", requestId: message.requestId, payload });
        if (message.operation !== "list") {
          // The write is already confirmed. A refresh failure must not turn it
          // into a failed save and invite a duplicate creation.
          try { await postCockpitState(cli, webview); }
          catch (error) { cli.output?.appendLine?.(`Priority saved; cockpit refresh unavailable: ${error.message}`); }
        }
      } catch (error) {
        await webview.postMessage({ type: "priorityResult", requestId: message.requestId, error: error.message });
      }
      return;
    }
    if (message.type === "refresh") {
      await postCockpitState(cli, webview);
    }
    if (message.type === "checkForUpdates") {
      await vscode.commands.executeCommand("workMemory.checkForUpdates");
    }
    if (message.type === "openExternal") {
      const target = vscode.Uri.parse(String(message.url || ""));
      if (!["http", "https"].includes(target.scheme)) {
        throw new Error("OneAgent documentation can only open HTTP or HTTPS links.");
      }
      await vscode.env.openExternal(target);
    }
    if (message.type === "documentationShown") {
      const documentationState = await cli.acknowledgeDocumentation({
        welcome: message.welcome === true,
        releaseNotes: message.releaseNotes === true,
        workspace: message.workspace === true
      });
      await cli.broadcastDocumentationState?.(documentationState);
    }
    if (message.type === "refreshGraphify") {
      await postCockpitState(cli, webview, { refreshGraphify: true });
    }
    if (message.type === "saveGraphFilters") {
      await saveGraphFiltersFromCockpit(cli, message);
    }
    if (message.type === "saveGraphView") {
      await saveGraphView(cli, webview, message);
    }
    if (message.type === "renameGraphView") {
      await renameGraphView(cli, webview, message);
    }
    if (message.type === "duplicateGraphView") {
      await duplicateGraphView(cli, webview, message);
    }
    if (message.type === "compareGraphView") {
      await compareGraphView(cli, message);
    }
    if (message.type === "deleteGraphView") {
      await deleteGraphView(cli, webview, message);
    }
    if (message.type === "setContextScope") {
      const result = await runContextBoundaryCommand(
        cli,
        ["context-scope", "set", "--stdin", "--json"],
        { input: JSON.stringify(message.scope || {}), logOutput: false },
        { approved: false },
        "Activating this context"
      );
      if (result.cancelled) {
        await cancelContextBoundaryChange(webview);
        return;
      }
      const payload = JSON.parse(result.output);
      await webview.postMessage({ type: "contextScope", payload });
      const preview = JSON.parse(await cli.run(["context-scope", "preview", "--stdin", "--json"], { input: JSON.stringify(message.scope || {}), logOutput: false }));
      await webview.postMessage({ type: "contextScopePreview", payload: preview });
    }
    if (message.type === "clearContextScope") {
      const result = await runContextBoundaryCommand(
        cli,
        ["context-scope", "clear"],
        { logOutput: false },
        { approved: false },
        "Clearing this context"
      );
      if (result.cancelled) {
        await cancelContextBoundaryChange(webview);
        return;
      }
      await webview.postMessage({ type: "contextScope", payload: null });
    }
    if (message.type === "previewContextScope") {
      try {
        const payload = JSON.parse(await cli.run(["context-scope", "preview", "--stdin", "--json"], { input: JSON.stringify(message.scope || {}), logOutput: false }));
        await webview.postMessage({ type: "contextScopePreview", payload });
      } catch (error) {
        await webview.postMessage({ type: "contextScopePreview", error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (message.type === "activateContextDraft") {
      const scope = message.scope && typeof message.scope === "object" ? message.scope : {};
      const viewId = typeof message.viewId === "string" && message.viewId ? message.viewId : undefined;
      const authorization = { approved: false };
      if (viewId) {
        if (message.saveChanges) {
          const updated = await runContextBoundaryCommand(
            cli,
            ["context-view", "update", viewId, "--stdin", "--json", "--context-scope", "active"],
            {
              input: JSON.stringify({
                context: scope,
                visualState: message.visualState && typeof message.visualState === "object" ? message.visualState : {}
              }),
              logOutput: false
            },
            authorization,
            "Saving and activating this Context view"
          );
          if (updated.cancelled) {
            await cancelContextBoundaryChange(webview);
            return;
          }
        }
        const activation = await runContextBoundaryCommand(
          cli,
          ["context-view", "activate", viewId, "--json", "--context-scope", "active"],
          { logOutput: false },
          authorization,
          "Activating this Context view"
        );
        if (activation.cancelled) {
          await cancelContextBoundaryChange(webview);
          return;
        }
        const activated = JSON.parse(activation.output);
        const payload = {
          ...activated.preview,
          scope: activated.view.context,
          counts: activated.preview?.resolved?.counts || {}
        };
        await webview.postMessage({ type: "contextScope", payload });
        await webview.postMessage({ type: "contextViewActivated", payload: activated });
        await postGraphViews(cli, webview, viewId);
      } else {
        const activation = await runContextBoundaryCommand(
          cli,
          ["context-scope", "set", "--stdin", "--json"],
          { input: JSON.stringify(scope), logOutput: false },
          authorization,
          "Activating this context"
        );
        if (activation.cancelled) {
          await cancelContextBoundaryChange(webview);
          return;
        }
        const resolved = JSON.parse(activation.output);
        const preview = JSON.parse(await cli.run(["context-scope", "preview", "--stdin", "--json"], {
          input: JSON.stringify(resolved.scope || scope),
          logOutput: false
        }));
        const payload = { ...preview, scope: resolved.scope || scope, counts: preview.resolved?.counts || resolved.counts || {} };
        await webview.postMessage({ type: "contextScope", payload });
        await webview.postMessage({ type: "contextViewActivated", payload: { view: null, preview } });
      }
    }
    if (message.type === "compileContextPack") {
      try {
        const request = String(message.request || "").trim();
        if (!request) throw new Error("An agent objective is required to prepare a Context Pack.");
        const input = {
          request,
          viewId: typeof message.viewId === "string" && message.viewId ? message.viewId : undefined,
          scope: message.scope && typeof message.scope === "object" ? message.scope : undefined,
          sessionId: typeof message.sessionId === "string" && message.sessionId ? message.sessionId : undefined,
          tokenBudget: Number.isFinite(Number(message.tokenBudget)) ? Number(message.tokenBudget) : undefined
        };
        const result = await runContextBoundaryCommand(
          cli,
          ["context-pack", "compile", "--stdin", "--json", "--context-scope", "active"],
          { input: JSON.stringify(input), logOutput: false },
          { approved: false },
          "Compiling this Context Pack"
        );
        if (result.cancelled) {
          await cancelContextBoundaryChange(webview);
          return;
        }
        const pack = JSON.parse(result.output);
        await webview.postMessage({ type: "contextPackCompiled", payload: pack });
        await postOperation(webview, "success", `Context Pack v${pack.version}: ${pack.entries?.length || 0} entries · ${pack.actualTokens}/${pack.budget} tokens${pack.truncated ? " · truncated" : ""}`);
      } catch (error) {
        await webview.postMessage({ type: "contextPackError", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    if (message.type === "listContextPacks") {
      try {
        const viewId = typeof message.viewId === "string" && message.viewId ? message.viewId : undefined;
        const args = ["context-pack", "list", "--summary", "--json", "--context-scope", "active", "--limit", String(Math.max(1, Math.min(50, Number(message.limit) || 8)))];
        if (viewId) args.push("--view", viewId);
        const packs = await cli.json(args);
        await webview.postMessage({ type: "contextPacks", viewId, payload: (packs || []).map(contextPackSummary) });
      } catch (error) {
        await webview.postMessage({ type: "contextPackError", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    if (message.type === "getContextPack") {
      try {
        const id = String(message.id || "").trim();
        if (!id) throw new Error("Missing Context Pack id.");
        const pack = await cli.json(["context-pack", "get", id, "--json", "--context-scope", "active"]);
        await webview.postMessage({ type: "contextPackDetail", payload: pack });
      } catch (error) {
        await webview.postMessage({ type: "contextPackError", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    if (message.type === "setCockpitTheme") {
      await cli.run(["ui-state", "set", "cockpitTheme", "--stdin", "--json"], { input: JSON.stringify(typeof message.theme === "string" && message.theme ? message.theme : "dark"), logOutput: false });
    }
    if (message.type === "openOutput") {
      cli.output.show(true);
    }
    if (message.type === "openFullCockpit") {
      await vscode.commands.executeCommand("workMemory.openCockpit");
    }
    if (message.type === "openSidebarCockpit") {
      await vscode.commands.executeCommand("workMemory.cockpit.focus");
    }
    if (message.type === "addProduct") {
      await addProduct(cli);
      await postCockpitState(cli, webview);
    }
    if (message.type === "upsertEntity") {
      await upsertEntity(cli);
      await postCockpitState(cli, webview);
    }
    if (message.type === "deleteEntity") {
      await deleteEntity(cli);
      await postCockpitState(cli, webview);
    }
    if (message.type === "deleteGraphEntity") {
      await deleteGraphEntity(cli, webview, message);
      await postCockpitState(cli, webview);
    }
    if (message.type === "updateGraphEntity") {
      const updatedRef = await updateGraphEntity(cli, webview, message);
      await postCockpitState(cli, webview);
      await webview.postMessage({ type: "focusEntity", ref: updatedRef });
    }
    if (message.type === "upsertEntityLink") {
      await upsertEntityLink(cli);
      await postCockpitState(cli, webview);
    }
    if (message.type === "deleteEntityLink") {
      await deleteEntityLink(cli);
      await postCockpitState(cli, webview);
    }
    if (message.type === "deleteGraphRelation") {
      await deleteGraphRelation(cli, webview, message);
      await postCockpitState(cli, webview);
      if (message.ref) {
        await postEntityContext(cli, webview, String(message.ref || ""));
      }
    }
    if (message.type === "updateGraphRelation") {
      await updateGraphRelation(cli, webview, message);
      await postCockpitState(cli, webview);
    }
    if (message.type === "taxonomyAction") {
      await runTaxonomyAction(cli, webview, message);
      await postCockpitState(cli, webview);
    }
    if (message.type === "captureMemory") {
      await postOperation(webview, "running", `Ingesting "${String(message.title || "capture")}"...`);
      const result = await saveCaptureFromCockpit(cli, message);
      await postOperation(
        webview,
        "success",
        `Capture ingested: ${String(message.title || "capture")} (${Number(result?.chunks || 0)} chunks, ${Number(result?.inboxProposals || 0)} proposals)`
      );
      await postCockpitState(cli, webview);
    }
    if (message.type === "loadManualNote") {
      const noteId = String(message.id || "").trim();
      if (noteId) {
        try {
          const payload = await cli.json(["capture", "show", noteId, "--context-scope", "active", "--json"]);
          await webview.postMessage({
            type: "manualNoteDetail",
            id: noteId,
            payload: typeof payload?.content === "string"
              ? payload
              : { ...payload, id: noteId, detailError: "The local Markdown file for this note is unavailable." }
          });
        } catch (error) {
          const detailError = error instanceof Error ? error.message : String(error);
          cli.output.appendLine(`Manual note detail unavailable for ${noteId}: ${detailError}`);
          await webview.postMessage({
            type: "manualNoteDetail",
            id: noteId,
            payload: { id: noteId, detailError }
          });
        }
      }
    }
    if (message.type === "loadManualNotes") {
      const requestedIds = normalizeStringList(message.ids).slice(0, 500);
      let payload = [];
      if (requestedIds.length) {
        try {
          payload = await cli.json([
            "capture", "list",
            "--ids", requestedIds.join(","),
            "--include-content",
            "--context-scope", "active",
            "--json"
          ]);
          payload = (Array.isArray(payload) ? payload : []).map((detail) =>
            typeof detail?.content === "string"
              ? detail
              : { ...detail, detailError: "The local Markdown file for this note is unavailable." }
          );
          const returnedIds = new Set(payload.map((detail) => String(detail?.id || "")));
          payload = [
            ...payload,
            ...requestedIds
              .filter((id) => !returnedIds.has(id))
              .map((id) => ({ id, detailError: "This note is no longer available in the active context." }))
          ];
        } catch (error) {
          const detailError = error instanceof Error ? error.message : String(error);
          cli.output.appendLine(`Manual note details unavailable: ${detailError}`);
          payload = requestedIds.map((id) => ({ id, detailError }));
        }
      }
      await webview.postMessage({ type: "manualNoteDetails", requestedIds, payload });
    }
    if (message.type === "createManualNote") {
      await postOperation(webview, "running", `Saving "${String(message.title || "note")}"...`);
      const payload = await createManualNote(cli, message);
      await webview.postMessage({ type: "manualNoteSaved", id: payload.id, payload });
      await postOperation(webview, "success", "Note saved locally. Updating search and views...");
      const indexingWarning = await indexManualNote(cli, payload.id);
      await postOperation(webview, indexingWarning ? "warning" : "success", indexingWarning
        ? `Note saved locally, but search indexing needs attention: ${indexingWarning}`
        : `Note saved and indexed under ${String(message.primary || "General")}.`);
      if (indexingWarning) void vscode.window.showWarningMessage(`OneAgent saved the note, but could not index it yet: ${indexingWarning}`);
      await refreshSavedManualNoteViews(cli, webview, [message.primary]);
    }
    if (message.type === "updateManualNote") {
      await postOperation(webview, "running", `Saving changes to "${String(message.title || "note")}"...`);
      const payload = await updateManualNote(cli, message);
      await webview.postMessage({ type: "manualNoteSaved", id: payload.id, payload });
      const indexingWarning = payload?.reingest?.status === "failed" ? String(payload.reingest.error || "indexing failed") : "";
      await postOperation(webview, indexingWarning ? "warning" : "success", indexingWarning ? `Note updated locally, but search indexing needs attention: ${indexingWarning}` : "Note updated.");
      if (indexingWarning) {
        void vscode.window.showWarningMessage(`OneAgent saved the changes, but could not reindex the note yet: ${indexingWarning}`);
      }
      await refreshSavedManualNoteViews(cli, webview, [message.originalPrimary, message.primary]);
    }
    if (message.type === "resolveManualNote" || message.type === "archiveManualNote" || message.type === "restoreManualNote") {
      const action = message.type === "resolveManualNote" ? "resolve" : message.type === "archiveManualNote" ? "archive" : "restore";
      const noteId = String(message.id || "").trim();
      if (noteId) {
        await cli.run(["capture", action, noteId, "--context-scope", "active", "--json"], { logOutput: false });
        const payload = await cli.json(["capture", "show", noteId, "--context-scope", "active", "--json"]);
        await postCockpitState(cli, webview);
        await webview.postMessage({ type: "manualNoteSaved", id: noteId, payload });
        await refreshManualNoteEntityContexts(cli, webview, [message.primary]);
        await postOperation(webview, "success", action === "resolve" ? "Question resolved." : action === "archive" ? "Note archived." : "Note restored.");
      }
    }
    if (message.type === "curateManualNote") {
      const noteId = String(message.id || "").trim();
      if (noteId) {
        await runCuration(cli, webview, noteId);
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "captureGeneric") {
      await postOperation(webview, "running", `Capturing "${String(message.title || "capture")}"...`);
      const result = await saveGenericCapture(cli, message);
      await postOperation(
        webview,
        "success",
        `Capture ingested: ${String(message.title || "capture")} → ${String(result.primary)} (${Number(result.reingest?.chunks || 0)} chunks, status ${String(result.reingest?.status || "unknown")})`
      );
      await maybeCurateCapture(cli, webview, result.capture?.id);
      await postCockpitState(cli, webview);
    }
    if (message.type === "curateCapture") {
      const captureId = String(message.id || "").trim();
      if (captureId) {
        await runCuration(cli, webview, captureId);
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "curatePending") {
      await postOperation(webview, "running", "Curating the pending capture queue...");
      await curatePendingCaptures(cli);
      await postCockpitState(cli, webview);
    }
    if (message.type === "reingestCapture") {
      const captureId = String(message.id || "").trim();
      if (captureId) {
        await postOperation(webview, "running", `Reingesting capture ${captureId}...`);
        const result = await cli.json(["capture", "reingest", captureId, "--json"]);
        if (result?.status === "failed") {
          await postOperation(webview, "error", `Capture ${captureId} failed to index: ${String(result.error || "unknown error")}`);
        } else {
          await postOperation(webview, "success", `Capture ${captureId}: ${String(result?.status || "done")} (${Number(result?.chunks || 0)} chunks)`);
          // Every entry point converges on capture -> curation: chain the agent
          // pass when the capture is (back) in the pending state. A skipped
          // unchanged capture keeps its curation and is left alone.
          const capture = await cli.json(["capture", "show", captureId, "--json"]).catch(() => undefined);
          if (capture && capture.curationStatus !== "curated" && capture.curationStatus !== "curating") {
            await runCuration(cli, webview, captureId);
          }
        }
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "reviewCapture") {
      const captureId = String(message.id || "").trim();
      if (captureId) {
        await cli.run(["capture", "review", captureId]);
        await postOperation(webview, "success", `Capture ${captureId} marked reviewed.`);
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "deleteCapture") {
      await deleteCaptureFromCockpit(cli, webview, message);
    }
    if (message.type === "reingestAllCaptures" || message.type === "reingestFailedCaptures") {
      const failedOnly = message.type === "reingestFailedCaptures";
      await postOperation(webview, "running", failedOnly ? "Reingesting failed captures..." : "Reingesting all captures...");
      const result = await cli.json(["capture", "reingest", failedOnly ? "--failed" : "--all", "--json"]);
      const summary = result?.summary || {};
      const failed = Number(summary.failed || 0);
      await postOperation(
        webview,
        failed > 0 ? "error" : "success",
        `Reingested ${Number(summary.total || 0)} capture(s): ${Number(summary.indexed || 0)} indexed, ${Number(summary.skipped || 0)} skipped, ${failed} failed.`
      );
      await postCockpitState(cli, webview);
    }
    if (message.type === "updateEntityDescription") {
      const ref = String(message.ref || "").trim();
      const [kind, ...idParts] = ref.split(":");
      const id = idParts.join(":");
      if (kind && id) {
        const args = ["entity", "upsert", id, "--kind", kind, "--description", String(message.description || "")];
        await cli.run(args);
        await postOperation(webview, "success", `Updated description for ${ref}.`);
        await postEntityContext(cli, webview, ref);
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "updateEntityFocus") {
      const ref = String(message.ref || "").trim();
      const [kind, ...idParts] = ref.split(":");
      const id = idParts.join(":");
      const focusLevel = String(message.focusLevel || "").trim();
      if (kind && id && ["primary", "supporting", "informational"].includes(focusLevel)) {
        await cli.run(["entity", "upsert", id, "--kind", kind, "--focus-level", focusLevel]);
        await postOperation(webview, "success", `Updated focus level for ${ref}: ${focusLevel}.`);
        await postEntityContext(cli, webview, ref);
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "createRelation") {
      const source = String(message.source || "").trim();
      const target = String(message.target || "").trim();
      const relationType = String(message.relationType || "").trim();
      const description = String(message.description || "").trim();
      if (source && target && relationType && source !== target) {
        const args = ["relation", "upsert", "--source", source, "--target", target, "--type", relationType];
        if (description) {
          args.push("--description", description);
        }
        await cli.run(args);
        await postOperation(webview, "success", `Linked ${source} —${relationType}→ ${target}.`);
        for (const ref of [source, target]) {
          await postEntityContext(cli, webview, ref);
        }
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "loadEntityContext") {
      await postEntityContext(cli, webview, message.ref, message.requestId);
    }
    if (message.type === "openCapturesFolder") {
      const folder = path.join(cli.memoryWorkspaceRoot(), ".work-memory", "captures");
      fs.mkdirSync(folder, { recursive: true });
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(folder));
    }
    if (message.type === "resetMemory") {
      const didReset = await resetMemory(cli);
      if (didReset) {
        await postOperation(webview, "success", "OneAgent memory reset complete.");
        await postCockpitState(cli, webview);
      }
    }
    if (message.type === "diagnoseRuntime") {
      const result = await diagnoseRuntime(cli);
      await postOperation(
        webview,
        "success",
        `Runtime: SQLite full-text · ${Number(result.counts?.sources || 0)} sources`
      );
      await postCockpitState(cli, webview);
    }
    if (message.type === "runIngestionSmokeTest") {
      await postOperation(webview, "running", "Running ingestion smoke test...");
      const result = await runIngestionSmokeTest(cli);
      await postOperation(
        webview,
        "success",
        `Smoke test ok: ${Number(result.chunks || 0)} chunks, ${Number(result.inboxProposals || 0)} proposals`
      );
      await postCockpitState(cli, webview);
    }
    if (message.type === "openFile") {
      await openPathInEditor(message.path);
    }
    if (message.type === "inspectInbox") {
      const detail = await loadInboxDetail(cli, message.id);
      await webview.postMessage({ type: "inboxDetail", id: message.id, payload: detail });
    }
    if (message.type === "previewInbox") {
      await previewProposalById(cli, message.id);
    }
    if (message.type === "reviseInboxDocument") {
      let payload;
      try {
        payload = JSON.parse(await cli.run(["inbox", "documents", "revise", "--stdin", "--context-scope", "active", "--json"], {
          input: JSON.stringify({ itemId: message.id, revision: message.revision, content: message.content }), logOutput: false
        }));
      } catch (error) {
        await webview.postMessage({ type: "inboxDocumentSaveFailed", id: message.id, requestId: message.requestId, error: error.message });
        return;
      }
      await webview.postMessage({ type: "inboxDocumentSaved", id: message.id, requestId: message.requestId, payload });
      try { await postCockpitState(cli, webview); }
      catch (error) { cli.output?.appendLine?.(`Document draft saved; cockpit refresh unavailable: ${error.message}`); }
      return;
    }
    if (message.type === "acceptInbox") {
      const review = await confirmInboxAcceptance(cli, message.id, "Proposal", message.revision);
      if (!review.confirmed) return;
      const args = ["inbox", "accept", message.id, "--context-scope", "active"];
      if (review.item.revision) args.push("--revision", review.item.revision);
      if (review.allowBoundaryChange === true) args.push("--allow-boundary-change");
      await cli.run(args);
      await postCockpitState(cli, webview);
    }
    if (message.type === "rejectInbox") {
      const args = ["inbox", "reject", message.id, "--context-scope", "active"];
      const feedback = String(message.feedback || "").trim();
      if (feedback) {
        args.push("--feedback", feedback);
      }
      await cli.run(args);
      await postCockpitState(cli, webview);
    }
    if (message.type === "proposeGraphChange") {
      const evidenceObservationIds = normalizeStringList(message.evidenceObservationIds);
      const changes = Array.isArray(message.changes) ? message.changes : [];
      const reason = String(message.reason || "").trim();
      if (!reason) throw new Error("A graph transaction reason is required.");
      if (!evidenceObservationIds.length) throw new Error("Select at least one accepted observation as evidence.");
      if (!changes.length) throw new Error("Add at least one graph change operation.");
      const proposal = JSON.parse(await cli.run([
        "graph-change", "propose", "--stdin", "--context-scope", "active", "--json"
      ], {
        input: JSON.stringify({
          title: String(message.title || "").trim() || undefined,
          reason,
          evidenceObservationIds,
          changes
        }),
        logOutput: false
      }));
      await postOperation(webview, "success", `Graph transaction proposed for review: ${proposal.item?.title || proposal.id || "proposal"}.`);
      await postCockpitState(cli, webview);
    }
    if (message.type === "reviewCurationPackage") {
      const packageId = String(message.id || "").trim();
      if (!packageId) throw new Error("Missing curation package id.");
      const args = ["curation-package", "review", packageId, "--context-scope", "active", "--json"];
      const acceptIds = normalizeStringList(message.acceptObservationIds);
      const rejectIds = normalizeStringList(message.rejectObservationIds);
      if (acceptIds.length) args.push("--accept", acceptIds.join(","));
      if (rejectIds.length) args.push("--reject", rejectIds.join(","));
      if (rejectIds.length && String(message.reason || "").trim()) args.push("--reason", String(message.reason).trim());
      await cli.run(args, { logOutput: false });
      await postOperation(webview, "success", `Curation package updated: ${packageId}.`);
      await postCockpitState(cli, webview);
    }
    if (message.type === "reviewObservation") {
      const id = String(message.id || "").trim();
      const decision = message.decision === "rejected" ? "reject" : "accept";
      if (!id) throw new Error("Missing observation id.");
      const args = ["observation", decision, id, "--context-scope", "active", "--json"];
      if (decision === "reject" && String(message.reason || "").trim()) args.push("--reason", String(message.reason).trim());
      await cli.run(args, { logOutput: false });
      await postCockpitState(cli, webview);
    }
    if (message.type === "editObservation") {
      const id = String(message.id || "").trim();
      if (!id) throw new Error("Missing observation id.");
      const args = ["observation", "edit", id, "--reason", String(message.reason || ""), "--context-scope", "active", "--json"];
      if (message.title !== undefined) args.push("--title", String(message.title));
      if (message.body !== undefined) args.push("--body", String(message.body));
      if (message.kind !== undefined) args.push("--kind", String(message.kind));
      if (message.subjectEntity) args.push("--entity", String(message.subjectEntity));
      else if (Object.prototype.hasOwnProperty.call(message, "subjectEntity")) args.push("--clear-entity");
      if (Number.isFinite(Number(message.confidence))) args.push("--confidence", String(message.confidence));
      await cli.run(args, { logOutput: false });
      await postCockpitState(cli, webview);
    }
    if (message.type === "mergeObservations") {
      const ids = normalizeStringList(message.ids);
      if (ids.length < 2) throw new Error("Select at least two observations to merge.");
      const args = ["observation", "merge", ...ids, "--reason", String(message.reason || ""), "--context-scope", "active", "--json"];
      await cli.run(args, { logOutput: false });
      await postCockpitState(cli, webview);
    }
    if (message.type === "measureObservation") {
      const id = String(message.id || "").trim();
      if (!id) throw new Error("Missing observation id.");
      await cli.run(["observation", "measure", id, "--reason", String(message.reason || ""), "--context-scope", "active", "--json"], { logOutput: false });
      await postCockpitState(cli, webview);
    }
    if (message.type === "reviewObservationEvidence") {
      const args = [
        "observation", "review-link",
        "--from", String(message.sourceObservationId || ""),
        "--to", String(message.targetObservationId || ""),
        "--type", String(message.relationType || ""),
        "--decision", message.decision === "rejected" ? "rejected" : "accepted",
        "--context-scope", "active",
        "--json"
      ];
      if (message.reason) args.push("--reason", String(message.reason));
      await cli.run(args, { logOutput: false });
      await postCockpitState(cli, webview);
    }
    if (message.type === "setPackageWikiDecision") {
      const packageId = String(message.id || "").trim();
      if (!packageId) throw new Error("Missing curation package id.");
      const args = ["curation-package", "wiki-decision", packageId, "--decision", message.decision === "suggested" ? "suggested" : "not_needed", "--context-scope", "active", "--json"];
      if (message.decision === "suggested") {
        const target = String(message.target || "").trim();
        if (!target) throw new Error("A wiki synthesis requires a durable target entity.");
        const page = String(message.page || "index.md").trim();
        const pathArgs = ["wiki", "resolve-path", "--entity", target, "--page", page, "--context-scope", "active", "--json"];
        if (message.home) pathArgs.push("--home", String(message.home));
        const resolved = await cli.json(pathArgs);
        args.push(
          "--reason", String(message.reason || ""),
          "--target", `${resolved.subject.kind}:${resolved.subject.id}`,
          "--home", `${resolved.home.kind}:${resolved.home.id}`,
          "--page", resolved.page
        );
        if (message.productId) args.push("--product", String(message.productId));
      }
      const evidenceIds = normalizeStringList(message.evidenceObservationIds);
      if (evidenceIds.length) args.push("--evidence", evidenceIds.join(","));
      await cli.run(args, { logOutput: false });
      await postCockpitState(cli, webview);
    }
    if (message.type === "updateTask") {
      await updateTaskFromCockpit(cli, message);
      await postCockpitState(cli, webview);
    }
    if (message.type === "deleteTask") {
      await deleteTaskFromCockpit(cli, message);
      await postCockpitState(cli, webview);
    }
    if (message.type === "createTask") {
      await createTaskFromCockpit(cli, message);
      await postCockpitState(cli, webview);
    }
    if (message.type === "createOkr") {
      const created = await createOkrFromCockpit(cli, webview);
      if (created) await postCockpitState(cli, webview);
    }
    if (message.type === "createKpi") {
      const created = await createKpiFromCockpit(cli, webview);
      if (created) await postCockpitState(cli, webview);
    }
    if (message.type === "editOkr") {
      const updated = await editOkrFromCockpit(cli, webview, message);
      if (updated) await postCockpitState(cli, webview);
    }
    if (message.type === "editKpi") {
      const updated = await editKpiFromCockpit(cli, webview, message);
      if (updated) await postCockpitState(cli, webview);
    }
    if (message.type === "recordKpiMeasurement") {
      const recorded = await recordKpiMeasurementFromCockpit(cli, webview, message);
      if (recorded) await postCockpitState(cli, webview);
    }
    if (message.type === "compareKpi") {
      await compareKpiFromCockpit(cli, webview, message);
    }
    if (message.type === "archiveKpi") {
      const archived = await archiveKpiFromCockpit(cli, webview, message);
      if (archived) await postCockpitState(cli, webview);
    }
    if (message.type === "linkOutcomeContribution") {
      const linked = await linkOutcomeContributionFromCockpit(cli, webview, message);
      if (linked) await postCockpitState(cli, webview);
    }
  } catch (error) {
    if (message.type === "createManualNote" || message.type === "updateManualNote") {
      await webview.postMessage({ type: "manualNoteSaveFailed" });
    }
    await postOperation(webview, "error", error instanceof Error ? error.message : String(error));
    await showCliError(cli, error);
  }
}

async function postOperation(webview, status, message) {
  await webview.postMessage({ type: "operation", payload: { status, message, at: new Date().toISOString() } });
}

async function deleteCaptureFromCockpit(cli, webview, message) {
  const captureId = String(message.id || "");
  if (!captureId) return;
  const title = String(message.title || captureId);
  const choice = await vscode.window.showWarningMessage(
    `Delete capture "${title}"? Its indexed content and pending reviews are removed permanently.`,
    { modal: true },
    "Delete"
  );
  if (choice !== "Delete") return;
  await postOperation(webview, "running", `Deleting capture ${captureId}...`);
  try {
    const summary = await cli.json(["capture", "delete", captureId, "--json"]);
    await postOperation(webview, "success", `Deleted capture "${title}" (${Number(summary?.inboxCleared || 0)} pending review(s) cleared).`);
  } catch (error) {
    await postOperation(webview, "error", error instanceof Error ? error.message : String(error));
  }
  await postCockpitState(cli, webview);
}

async function saveGraphFiltersFromCockpit(cli, message) {
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  const stringArray = (value) => Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
  const normalized = {
    activeTypes: stringArray(payload.activeTypes),
    excludedValues: payload.excludedValues && typeof payload.excludedValues === "object" ? payload.excludedValues : {},
    hiddenMode: payload.hiddenMode === "fade" ? "fade" : "hide",
    pinnedNodes: stringArray(payload.pinnedNodes),
    relationValueMode: payload.relationValueMode === "selected" ? "selected" : "all",
    selectedRelationTypes: stringArray(payload.selectedRelationTypes),
    selectedRelationCategories: stringArray(payload.selectedRelationCategories),
    focusThreshold: payload.focusThreshold ? String(payload.focusThreshold) : undefined,
    groupMode: payload.groupMode ? String(payload.groupMode) : undefined,
    layoutMode: payload.layoutMode ? String(payload.layoutMode) : undefined,
    relationQuickMode: payload.relationQuickMode ? String(payload.relationQuickMode) : undefined,
    expandedTypeGroups: stringArray(payload.expandedTypeGroups),
    collapsedTypeGroups: stringArray(payload.collapsedTypeGroups),
    activeGraphViewId: payload.activeGraphViewId ? String(payload.activeGraphViewId) : undefined,
    selectedType: payload.selectedType ? String(payload.selectedType) : undefined,
    panelOpen: payload.panelOpen !== false,
    expandedTypes: stringArray(payload.expandedTypes)
  };
  await cli.run(["ui-state", "set", "graphFilters", "--stdin", "--json"], {
    input: JSON.stringify(normalized),
    logOutput: false
  });
}

async function loadGraphViews(cli) {
  try {
    const stored = await cli.json(["context-view", "list", "--json", "--context-scope", "active"]);
    const views = Array.isArray(stored?.views) ? stored.views : [];
    return views
      .filter((view) => view && typeof view === "object" && view.id && view.name)
      .map((view) => ({
        id: view.id,
        name: view.name,
        version: view.version,
        payload: view.visualState && typeof view.visualState === "object" ? view.visualState : {},
        context: view.context && typeof view.context === "object" ? view.context : undefined,
        refreshPolicy: view.refreshPolicy,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt
      }));
  } catch {
    return [];
  }
}

async function postGraphViews(cli, webview, activeId) {
  await webview.postMessage({ type: "graphViews", views: await loadGraphViews(cli), activeId });
}

async function saveGraphView(cli, webview, message) {
  const payload = message.payload && typeof message.payload === "object" ? { ...message.payload } : {};
  const context = payload.context && typeof payload.context === "object" ? payload.context : undefined;
  delete payload.context;
  const views = await loadGraphViews(cli);
  const existing = message.id ? views.find((view) => view.id === message.id) : undefined;
  const authorization = { approved: false };
  if (existing) {
    await postOperation(webview, "running", `Updating graph view "${existing.name}"...`);
    const result = await runContextBoundaryCommand(
      cli,
      ["context-view", "update", existing.id, "--stdin", "--json", "--context-scope", "active"],
      { input: JSON.stringify({ visualState: payload, context }), logOutput: false },
      authorization,
      "Saving this Context view"
    );
    if (result.cancelled) {
      await cancelContextBoundaryChange(webview);
      return;
    }
    await postGraphViews(cli, webview, existing.id);
    await postOperation(webview, "success", `Graph view "${existing.name}" updated.`);
    return;
  }
  const name = (message.name ? String(message.name) : await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Graph view name",
    placeHolder: "e.g. Rental MVP focus",
    validateInput: (value) => value.trim() ? undefined : "Name is required"
  }) || "").trim();
  if (!name) return;
  await postOperation(webview, "running", `Saving graph view "${name}"...`);
  const result = await runContextBoundaryCommand(
    cli,
    ["context-view", "create", "--stdin", "--json", "--context-scope", "active"],
    { input: JSON.stringify({ name, visualState: payload, context }), logOutput: false },
    authorization,
    "Saving this Context view"
  );
  if (result.cancelled) {
    await cancelContextBoundaryChange(webview);
    return;
  }
  const view = JSON.parse(result.output);
  await postGraphViews(cli, webview, view.id);
  await postOperation(webview, "success", `Graph view "${view.name || name}" saved.`);
}

async function renameGraphView(cli, webview, message) {
  const views = await loadGraphViews(cli);
  const view = views.find((item) => item.id === message.id);
  if (!view) return;
  const name = (await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Rename graph view", value: view.name }) || "").trim();
  if (!name || name === view.name) return;
  await cli.run(["context-view", "rename", view.id, "--name", name, "--json", "--context-scope", "active"], { logOutput: false });
  await postGraphViews(cli, webview, view.id);
}

async function duplicateGraphView(cli, webview, message) {
  const views = await loadGraphViews(cli);
  const view = views.find((item) => item.id === message.id);
  if (!view) return;
  const name = (await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Duplicate graph and Context view",
    value: `${view.name} copy`
  }) || "").trim();
  if (!name) return;
  const copy = await cli.json(["context-view", "duplicate", view.id, "--name", name, "--json", "--context-scope", "active"]);
  await postGraphViews(cli, webview, copy.id);
}

async function compareGraphView(cli, message) {
  const views = await loadGraphViews(cli);
  const current = views.find((item) => item.id === message.id);
  if (!current) return;
  const candidates = views.filter((item) => item.id !== current.id);
  const picked = await vscode.window.showQuickPick(
    candidates.map((view) => ({ label: view.name, description: `v${view.version}`, view })),
    { ignoreFocusOut: true, placeHolder: `Compare “${current.name}” with…` }
  );
  if (!picked) return;
  const diff = await cli.json(["context-view", "compare", current.id, picked.view.id, "--json", "--context-scope", "active"]);
  const summary = [
    `${diff.added?.length || 0} added`,
    `${diff.removed?.length || 0} removed`,
    `${diff.roleChanges?.length || 0} role changes`,
    `${diff.policyChanges?.length || 0} policy changes`
  ].join(" · ");
  await vscode.window.showInformationMessage(`${current.name} ⇄ ${picked.view.name}: ${summary}`, { modal: true, detail: JSON.stringify(diff, null, 2) });
}

async function deleteGraphView(cli, webview, message) {
  const views = await loadGraphViews(cli);
  const view = views.find((item) => item.id === message.id);
  if (!view) return;
  const choice = await vscode.window.showWarningMessage(`Delete graph view "${view.name}"?`, { modal: true }, "Delete");
  if (choice !== "Delete") return;
  await cli.run(["context-view", "delete", view.id, "--json", "--context-scope", "active", "--allow-boundary-change"], { logOutput: false });
  await postGraphViews(cli, webview, undefined);
}

function createNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

async function loadScopedManualNotes(cli) {
  const [notes, questions] = await Promise.all([
    cli.json(["capture", "list", "--content-type", "note", "--context-scope", "active", "--json"]),
    cli.json(["capture", "list", "--content-type", "question", "--context-scope", "active", "--json"])
  ]);
  return [...new Map(
    [...(notes || []), ...(questions || [])]
      .filter((capture) => capture?.id)
      .map((capture) => [capture.id, capture])
  ).values()];
}

async function loadCockpitState(cli, options = {}) {
  const load = async () => {
    const graphConfig = vscode.workspace.getConfiguration("workMemory");
    const visibleMaxNodes = Math.max(20, Number(graphConfig.get("graphMaxNodes")) || 500);
    const visibleMaxEdges = Math.max(20, Number(graphConfig.get("graphMaxEdges")) || 1200);
    const contextTokenBudget = Math.max(1000, Math.min(1000000, Number(graphConfig.get("contextTokenBudget")) || 64000));
    const loadedMaxNodes = Math.max(1000, visibleMaxNodes);
    const loadedMaxEdges = Math.max(2500, visibleMaxEdges);
    const graphArgs = ["graph-view", "--json", "--scope", "portfolio", "--max-nodes", String(loadedMaxNodes), "--max-edges", String(loadedMaxEdges)];
    const graphifyCommand = cli.graphifyCommand();
    if (graphifyCommand && options.refreshGraphify) {
      graphArgs.push("--graphify-command", graphifyCommand);
    } else {
      graphArgs.push("--no-graphify");
    }
    if (options.refreshGraphify) {
      graphArgs.push("--refresh-graphify");
    }
    const [graph, tasks, inbox, graphChangeHistoryState, curationPackageState, sources, diagnostics, entities, captures, manualNotes, today, graphFilters, contextScope, cockpitTheme, graphViews, taxonomy, documentation, documentationState] = await Promise.all([
      cli.json(graphArgs),
      cli.json(["tasks", "--json", "--scope", "portfolio"]),
      cli.json(["inbox", "--json", "--scope", "portfolio", "--context-scope", "active"]),
      loadGraphChangeHistory(cli),
      loadCurationPackageState(cli),
      cli.json(["sources", "--json", "--scope", "portfolio"]),
      cli.json(["diagnose", "--json"]),
      cli.json(["entity", "list", "--json"]),
      cli.json(["capture", "list", "--json"]),
      loadScopedManualNotes(cli),
      cli.json(["today", "--json", "--context-scope", "active"]),
      cli.json(["ui-state", "get", "graphFilters", "--json"]),
      loadActiveContextPreview(cli),
      cli.json(["ui-state", "get", "cockpitTheme", "--json"]),
      loadGraphViews(cli),
      cli.json(["taxonomy", "list", "--json"]),
      options.includeDocumentation ? cli.documentationPayload() : undefined,
      cli.documentationState()
    ]);
    const enrichedInbox = await enrichInboxSummaries(cli, inbox);
    return {
      graph,
      graphLimits: { visibleMaxNodes, visibleMaxEdges, loadedMaxNodes, loadedMaxEdges },
      contextTokenBudget,
      tasks,
      inbox: enrichedInbox,
      graphChangeHistory: graphChangeHistoryState.items,
      graphChangeHistoryState: graphChangeHistoryState.state,
      curationPackages: curationPackageState.current,
      curationPackageHistory: curationPackageState.history,
      curationPackageHistoryState: curationPackageState.historyState,
      curationCapabilities: curationPackageState.capabilities,
      sources,
      diagnostics,
      entities,
      captures,
      manualNotes,
      today,
      graphFilters,
      contextScope,
      cockpitTheme,
      graphViews,
      taxonomy,
      ...(documentation ? { documentation } : {}),
      documentationState,
      extensionVersion: cli.extensionVersion()
    };
  };

  if (options.silent) {
    return load();
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.refreshGraphify ? "Refreshing Graphify" : "Loading OneAgent cockpit"
    },
    load
  );
}

async function loadGraphChangeHistory(cli) {
  const results = await Promise.allSettled([
    cli.json(["graph-change", "list", "--status", "accepted", "--limit", "51", "--context-scope", "active", "--json"]),
    cli.json(["graph-change", "list", "--status", "rejected", "--limit", "51", "--context-scope", "active", "--json"])
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    cli.output?.appendLine?.(`Graph transaction history is partially unavailable: ${failures.map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason)).join(" ")}`);
  }
  const byId = new Map();
  let partial = false;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const items = Array.isArray(result.value) ? result.value : [];
    if (items.length > 50) partial = true;
    for (const item of items.slice(0, 50)) byId.set(item.id, item);
  }
  return {
    items: [...byId.values()]
      .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || ""))
      .slice(0, 100),
    state: {
      available: failures.length === 0,
      partial: partial || failures.length > 0,
      error: failures.length ? "Some accepted or rejected graph transactions could not be loaded." : undefined
    }
  };
}

async function loadCurationPackageState(cli) {
  const snapshotLimit = 500;
  try {
    const all = await cli.json([
      "curation-package", "list", "--status", "all", "--limit", String(snapshotLimit),
      "--context-scope", "active", "--json"
    ]);
    const details = Array.isArray(all) ? all : [];
    return partitionCurationPackageState(details, { partial: details.length >= snapshotLimit });
  } catch (error) {
    cli.output?.appendLine?.(`Combined curation package snapshot unavailable; falling back to status reads: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [[pending, partial], historyResults] = await Promise.all([
    Promise.all([
      cli.json(["curation-package", "list", "--status", "pending", "--context-scope", "active", "--json"]),
      cli.json(["curation-package", "list", "--status", "partially_accepted", "--context-scope", "active", "--json"])
    ]),
    Promise.allSettled([
      cli.json(["curation-package", "list", "--status", "accepted", "--context-scope", "active", "--json"]),
      cli.json(["curation-package", "list", "--status", "rejected", "--context-scope", "active", "--json"])
    ])
  ]);
  const historyErrors = historyResults
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  if (historyErrors.length > 0) {
    cli.output?.appendLine?.(`Curation package history is partially unavailable: ${historyErrors.join(" ")}`);
  }
  const historyLists = historyResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const partialWithPending = (partial || []).filter(curationPackageHasPendingObservations);
  const reviewedPartial = (partial || []).filter((detail) => !curationPackageHasPendingObservations(detail));
  const current = uniqueCurationPackageDetails([...(pending || []), ...partialWithPending]);
  const history = uniqueCurationPackageDetails([...historyLists.flatMap((items) => items || []), ...reviewedPartial])
    .sort((left, right) => curationPackageTimestamp(right) - curationPackageTimestamp(left));
  return {
    current,
    history,
    historyState: {
      available: historyErrors.length === 0,
      partial: historyErrors.length > 0 && history.length > 0,
      error: historyErrors.length > 0 ? historyErrors.join(" ") : undefined
    },
    capabilities: {
      packageHistory: historyErrors.length === 0,
      crossPackageEvidence: historyErrors.length === 0,
      graphProposalPromotion: false
    }
  };
}

function partitionCurationPackageState(details, options = {}) {
  const all = uniqueCurationPackageDetails(details || []);
  const current = all.filter((detail) =>
    detail?.package?.status === "pending" ||
    (detail?.package?.status === "partially_accepted" && curationPackageHasPendingObservations(detail))
  );
  const history = all.filter((detail) =>
    detail?.package?.status === "accepted" ||
    detail?.package?.status === "rejected" ||
    (detail?.package?.status === "partially_accepted" && !curationPackageHasPendingObservations(detail))
  ).sort((left, right) => curationPackageTimestamp(right) - curationPackageTimestamp(left));
  return {
    current,
    history,
    historyState: { available: true, partial: options.partial === true },
    capabilities: {
      packageHistory: true,
      crossPackageEvidence: true,
      graphProposalPromotion: true
    }
  };
}

function uniqueCurationPackageDetails(details) {
  const byId = new Map();
  for (const detail of details) {
    if (detail?.package?.id) byId.set(detail.package.id, detail);
  }
  return [...byId.values()];
}

function curationPackageTimestamp(detail) {
  const value = detail?.package?.reviewedAt || detail?.package?.updatedAt || detail?.package?.createdAt;
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function curationPackageHasPendingObservations(detail) {
  return Number(detail?.counts?.captured || 0) + Number(detail?.counts?.proposed || 0) > 0;
}

async function loadActiveContextPreview(cli) {
  const active = await cli.json(["context-scope", "get", "--json"]);
  if (!active?.scope) return active;
  try {
    const preview = JSON.parse(await cli.run(["context-scope", "preview", "--stdin", "--json"], {
      input: JSON.stringify(active.scope),
      logOutput: false
    }));
    return { ...active, ...preview, scope: active.scope, counts: preview.counts || active.counts };
  } catch {
    return active;
  }
}

function contextPackSummary(pack) {
  return {
    id: pack.id,
    version: pack.version,
    viewId: pack.viewId,
    viewVersion: pack.viewVersion,
    sessionId: pack.sessionId,
    request: pack.request,
    entryCount: Number.isFinite(Number(pack.entryCount)) ? Number(pack.entryCount) : (Array.isArray(pack.entries) ? pack.entries.length : 0),
    entries: Array.isArray(pack.entries) ? pack.entries.map((entry) => ({
      kind: entry.kind,
      ref: entry.ref,
      title: entry.title,
      role: entry.role,
      content: entry.content,
      tokenCount: entry.tokenCount,
      provenance: entry.provenance,
      citations: entry.citations
    })) : [],
    exclusions: pack.exclusions,
    provenance: pack.provenance,
    estimatedTokens: pack.estimatedTokens,
    actualTokens: pack.actualTokens,
    budget: pack.budget,
    truncated: Boolean(pack.truncated),
    createdAt: pack.createdAt
  };
}

async function enrichInboxSummaries(cli, inbox) {
  if (!Array.isArray(inbox) || inbox.length === 0) {
    return inbox;
  }
  return Promise.all(inbox.map(async (item) => {
    if (!item?.payload || typeof item.payload.targetPath !== "string" || item.payload.targetPath.length === 0) {
      return item;
    }
    try {
      const previewData = await cli.json(["inbox", "preview", item.id, "--context-scope", "active", "--json"]);
      return {
        ...item,
        previewAction: previewData?.preview?.action,
        previewTargetPath: previewData?.preview?.targetPath
      };
    } catch {
      return item;
    }
  }));
}

async function updateTaskFromCockpit(cli, message) {
  const id = String(message.id || "").trim();
  if (!id) {
    throw new Error("Missing task id.");
  }

  const args = ["tasks", "update", id];
  for (const field of ["title", "body", "status", "priority", "assignee", "deadline", "notes", "productId", "sourceId"]) {
    if (message[field] !== undefined) {
      const flag = field === "productId" ? "product" : field === "sourceId" ? "source" : field;
      args.push(`--${flag}`, String(message[field] || "none"));
    }
  }
  for (const link of normalizeTaskLinks(message.links)) {
    args.push("--link", serializeTaskLink(link));
  }

  await cli.run(args);
}

async function deleteTaskFromCockpit(cli, message) {
  const id = String(message.id || "").trim();
  if (!id) {
    throw new Error("Missing task id.");
  }
  await cli.run(["tasks", "archive", id]);
}

async function createTaskFromCockpit(cli, message) {
  const title = String(message.title || "").trim();
  if (!title) {
    throw new Error("Missing task title.");
  }

  const args = ["tasks", "create", title];
  for (const field of ["body", "status", "priority", "assignee", "deadline", "notes", "productId", "sourceId"]) {
    const value = String(message[field] || "").trim();
    if (value) {
      const flag = field === "productId" ? "product" : field === "sourceId" ? "source" : field;
      args.push(`--${flag}`, value);
    }
  }
  for (const link of normalizeTaskLinks(message.links)) {
    args.push("--link", serializeTaskLink(link));
  }

  await cli.run(args);
}

async function createOkrFromCockpit(cli, webview) {
  const label = await vscode.window.showInputBox({
    title: "Add OKR",
    prompt: "Short OKR label",
    placeHolder: "Improve checkout completion",
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (label === undefined) return false;
  const existingIds = new Set((await listOutcomeEntities(cli, "okr")).map((entity) => String(entity.id || "")));
  const id = await vscode.window.showInputBox({
    title: "Add OKR",
    prompt: "Stable OKR id",
    value: slugify(label),
    ignoreFocusOut: true,
    validateInput: (value) => validateOutcomeId(value) || (existingIds.has(value.trim()) ? "An OKR with this id already exists." : undefined)
  });
  if (!id) return false;
  const objective = await vscode.window.showInputBox({
    title: "Add OKR",
    prompt: "Objective — what outcome are you trying to achieve?",
    placeHolder: "Customers complete checkout with less friction",
    ignoreFocusOut: true
  });
  if (objective === undefined) return false;

  const missions = await listOutcomeEntities(cli, "mission");
  const mission = await vscode.window.showQuickPick(
    [
      { label: "No mission", description: "Keep this OKR standalone", id: undefined },
      ...missions.map((entity) => ({
        label: entity.label || entity.id,
        description: entity.id,
        id: entity.id
      }))
    ],
    { title: "Add OKR", placeHolder: "Mission alignment", ignoreFocusOut: true }
  );
  if (!mission) return false;
  const status = await vscode.window.showQuickPick(
    ["draft", "active", "at_risk", "off_track", "achieved", "closed"].map((value) => ({
      label: humanizeId(value),
      description: value,
      value
    })),
    { title: "Add OKR", placeHolder: "OKR status", ignoreFocusOut: true }
  );
  if (!status) return false;
  const periodStart = await vscode.window.showInputBox({
    title: "Add OKR",
    prompt: "Period start (optional)",
    placeHolder: "YYYY-MM-DD",
    ignoreFocusOut: true,
    validateInput: validateOptionalIsoDate
  });
  if (periodStart === undefined) return false;
  const periodEnd = await vscode.window.showInputBox({
    title: "Add OKR",
    prompt: "Period end (optional)",
    placeHolder: "YYYY-MM-DD",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const error = validateOptionalIsoDate(value);
      if (error) return error;
      return value.trim() && periodStart.trim() && value.trim() < periodStart.trim()
        ? "Period end must be on or after the start."
        : undefined;
    }
  });
  if (periodEnd === undefined) return false;
  const activeKpiIds = new Set((await listOutcomeEntities(cli, "kpi")).map((entity) => String(entity.id || "")));
  const keyResultsJson = await vscode.window.showInputBox({
    title: "Add OKR",
    prompt: "Key results as JSON. Each item needs an id and title; progress is 0–100.",
    value: "[]",
    placeHolder: '[{"id":"kr-1","title":"Reach 80% completion","status":"not_started","targetValue":80,"unit":"%"}]',
    ignoreFocusOut: true,
    validateInput: (value) => validateKeyResultsJson(value, activeKpiIds)
  });
  if (keyResultsJson === undefined) return false;
  const keyResults = JSON.parse(keyResultsJson);
  const keyResultKpiIds = [...new Set(keyResults.map((keyResult) => String(keyResult.kpiId || "").trim()).filter(Boolean))];
  const args = [
    "okr", "upsert", id.trim(),
    "--label", label.trim(),
    "--status", status.value,
    "--key-results", JSON.stringify(keyResults),
    "--fail-if-exists",
    "--context-scope", "active",
    "--json"
  ];
  if (objective.trim()) args.push("--objective", objective.trim());
  if (mission.id) args.push("--mission", mission.id);
  if (periodStart.trim()) args.push("--period-start", periodStart.trim());
  if (periodEnd.trim()) args.push("--period-end", periodEnd.trim());
  if (keyResultKpiIds.length) args.push("--kpi", keyResultKpiIds.join(","));

  await postOperation(webview, "running", `Creating OKR ${label.trim()}...`);
  const authorization = { approved: false, createOnlyRef: `okr:${id.trim()}` };
  const result = await runContextBoundaryCommand(
    cli,
    args,
    { logOutput: false },
    authorization,
    `Creating OKR ${label.trim()}`
  );
  if (result.cancelled) {
    await webview.postMessage({ type: "operation", payload: null });
    return false;
  }
  await keepCreatedOutcomeInActiveContext(cli, { kind: "okr", id: id.trim() });
  await postOperation(webview, "success", `OKR created: ${label.trim()} (${keyResults.length} key result${keyResults.length === 1 ? "" : "s"}).`);
  return true;
}

async function createKpiFromCockpit(cli, webview) {
  const label = await vscode.window.showInputBox({
    title: "Add KPI",
    prompt: "KPI label",
    placeHolder: "Checkout completion rate",
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (label === undefined) return false;
  const existingIds = new Set((await listOutcomeEntities(cli, "kpi")).map((entity) => String(entity.id || "")));
  const id = await vscode.window.showInputBox({
    title: "Add KPI",
    prompt: "Stable KPI id",
    value: slugify(label),
    ignoreFocusOut: true,
    validateInput: (value) => validateOutcomeId(value) || (existingIds.has(value.trim()) ? "A KPI with this id already exists." : undefined)
  });
  if (!id) return false;
  const description = await vscode.window.showInputBox({
    title: "Add KPI",
    prompt: "What does this KPI measure? (optional)",
    ignoreFocusOut: true
  });
  if (description === undefined) return false;
  const unit = await vscode.window.showInputBox({
    title: "Add KPI",
    prompt: "Measurement unit",
    placeHolder: "% / ms / users / EUR",
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (unit === undefined) return false;
  const direction = await vscode.window.showQuickPick(
    [
      { label: "Increase", description: "Higher is better", value: "increase" },
      { label: "Decrease", description: "Lower is better", value: "decrease" },
      { label: "Target", description: "Reach one exact target", value: "target" },
      { label: "Range", description: "Stay between a minimum and maximum", value: "range" }
    ],
    { title: "Add KPI", placeHolder: "Desired direction", ignoreFocusOut: true }
  );
  if (!direction) return false;

  let targetValue;
  let targetMin;
  let targetMax;
  if (direction.value === "range") {
    targetMin = await vscode.window.showInputBox({
      title: "Add KPI",
      prompt: "Target minimum",
      ignoreFocusOut: true,
      validateInput: validateRequiredFiniteNumber
    });
    if (targetMin === undefined) return false;
    targetMax = await vscode.window.showInputBox({
      title: "Add KPI",
      prompt: "Target maximum",
      ignoreFocusOut: true,
      validateInput: (value) => {
        const error = validateRequiredFiniteNumber(value);
        if (error) return error;
        return Number(value) < Number(targetMin) ? "Target maximum must be greater than or equal to the minimum." : undefined;
      }
    });
    if (targetMax === undefined) return false;
  } else {
    targetValue = await vscode.window.showInputBox({
      title: "Add KPI",
      prompt: direction.value === "target" ? "Target value" : "Target value (optional)",
      ignoreFocusOut: true,
      validateInput: direction.value === "target" ? validateRequiredFiniteNumber : validateOptionalFiniteNumber
    });
    if (targetValue === undefined) return false;
  }
  const staleAfter = await vscode.window.showInputBox({
    title: "Add KPI",
    prompt: "Consider the KPI stale after how many days?",
    value: "30",
    ignoreFocusOut: true,
    validateInput: validatePositiveInteger
  });
  if (staleAfter === undefined) return false;
  const okrs = await listOutcomeEntities(cli, "okr");
  const okr = await vscode.window.showQuickPick(
    [
      { label: "No OKR", description: "Create the KPI without an OKR link", id: undefined },
      ...okrs.map((entity) => ({ label: entity.label || entity.id, description: entity.id, id: entity.id }))
    ],
    { title: "Add KPI", placeHolder: "OKR measured by this KPI", ignoreFocusOut: true }
  );
  if (!okr) return false;

  const args = [
    "kpi", "upsert", id.trim(),
    "--label", label.trim(),
    "--unit", unit.trim(),
    "--direction", direction.value,
    "--stale-after", staleAfter.trim(),
    "--fail-if-exists",
    "--context-scope", "active",
    "--json"
  ];
  if (description.trim()) args.push("--description", description.trim());
  if (targetValue?.trim()) args.push("--target", targetValue.trim());
  if (targetMin?.trim()) args.push("--target-min", targetMin.trim());
  if (targetMax?.trim()) args.push("--target-max", targetMax.trim());
  if (okr.id) args.push("--okr", okr.id);

  await postOperation(webview, "running", `Creating KPI ${label.trim()}...`);
  const authorization = { approved: false, createOnlyRef: `kpi:${id.trim()}` };
  const result = await runContextBoundaryCommand(
    cli,
    args,
    { logOutput: false },
    authorization,
    `Creating KPI ${label.trim()}`
  );
  if (result.cancelled) {
    await webview.postMessage({ type: "operation", payload: null });
    return false;
  }
  await keepCreatedOutcomeInActiveContext(cli, { kind: "kpi", id: id.trim() });
  await postOperation(webview, "success", `KPI created: ${label.trim()}.`);
  return true;
}

async function editOkrFromCockpit(cli, webview, message) {
  const id = String(message.okrId || "").trim();
  if (!id) throw new Error("Missing OKR id.");
  const current = await cli.json(["okr", "show", id, "--context-scope", "active", "--json"]);
  const definition = current?.definition || {};
  const label = await vscode.window.showInputBox({
    title: `Edit OKR · ${id}`,
    prompt: "Short OKR label",
    value: String(current?.label || id),
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (label === undefined) return false;
  const objective = await vscode.window.showInputBox({
    title: `Edit OKR · ${id}`,
    prompt: "Objective — the outcome to achieve",
    value: String(current?.objective || ""),
    ignoreFocusOut: true
  });
  if (objective === undefined) return false;
  const missions = await listOutcomeEntities(cli, "mission");
  const currentMissionId = String(current?.mission?.id || "");
  const missionChoices = [
    ...missions
      .map((entity) => ({
        label: entity.label || entity.id,
        description: `${entity.id}${entity.id === currentMissionId ? " · current" : ""}`,
        id: entity.id
      }))
      .sort((left, right) => Number(right.id === currentMissionId) - Number(left.id === currentMissionId)),
    { label: "No mission", description: currentMissionId ? "Detach this OKR from its mission" : "Keep this OKR standalone", id: undefined }
  ];
  const mission = await vscode.window.showQuickPick(missionChoices, {
    title: `Edit OKR · ${id}`,
    placeHolder: "Mission alignment",
    ignoreFocusOut: true
  });
  if (!mission) return false;
  const status = await vscode.window.showQuickPick(
    ["draft", "active", "at_risk", "off_track", "achieved", "closed"]
      .map((value) => ({ label: humanizeId(value), description: value === definition.status ? `${value} · current` : value, value }))
      .sort((left, right) => Number(right.value === definition.status) - Number(left.value === definition.status)),
    { title: `Edit OKR · ${id}`, placeHolder: "OKR status", ignoreFocusOut: true }
  );
  if (!status) return false;
  const periodStart = await vscode.window.showInputBox({
    title: `Edit OKR · ${id}`,
    prompt: "Period start (empty clears it)",
    value: String(definition.periodStart || ""),
    placeHolder: "YYYY-MM-DD",
    ignoreFocusOut: true,
    validateInput: validateOptionalIsoDate
  });
  if (periodStart === undefined) return false;
  const periodEnd = await vscode.window.showInputBox({
    title: `Edit OKR · ${id}`,
    prompt: "Period end (empty clears it)",
    value: String(definition.periodEnd || ""),
    placeHolder: "YYYY-MM-DD",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const error = validateOptionalIsoDate(value);
      if (error) return error;
      return value.trim() && periodStart.trim() && value.trim() < periodStart.trim()
        ? "Period end must be on or after the start."
        : undefined;
    }
  });
  if (periodEnd === undefined) return false;
  const activeKpiIds = new Set((await listOutcomeEntities(cli, "kpi")).map((entity) => String(entity.id || "")));
  const keyResultsJson = await vscode.window.showInputBox({
    title: `Edit OKR · ${id}`,
    prompt: "Key results as structured JSON (they remain children of this OKR, not graph nodes)",
    value: JSON.stringify(definition.keyResults || current?.keyResults || [], null, 2),
    ignoreFocusOut: true,
    validateInput: (value) => validateKeyResultsJson(value, activeKpiIds)
  });
  if (keyResultsJson === undefined) return false;
  const keyResults = JSON.parse(keyResultsJson);
  const kpiIds = [...new Set([
    ...(current?.kpis || []).map((kpi) => String(kpi.id || "")).filter(Boolean),
    ...keyResults.map((keyResult) => String(keyResult.kpiId || "")).filter(Boolean)
  ])];
  const args = [
    "okr", "upsert", id,
    "--label", label.trim(),
    "--objective", objective.trim(),
    "--status", status.value,
    "--period-start", periodStart.trim(),
    "--period-end", periodEnd.trim(),
    "--key-results", JSON.stringify(keyResults),
    "--kpi", kpiIds.join(","),
    "--context-scope", "active",
    "--json"
  ];
  if (mission.id) args.push("--mission", mission.id);
  else args.push("--clear-mission");
  await postOperation(webview, "running", `Updating OKR ${label.trim()}...`);
  await cli.run(args, { logOutput: false });
  await postOperation(webview, "success", `OKR updated: ${label.trim()} (${keyResults.length} key result${keyResults.length === 1 ? "" : "s"}).`);
  return true;
}

async function editKpiFromCockpit(cli, webview, message) {
  const id = String(message.kpiId || "").trim();
  if (!id) throw new Error("Missing KPI id.");
  const current = await cli.json(["kpi", "show", id, "--context-scope", "active", "--json"]);
  const definition = current?.definition || {};
  const label = await vscode.window.showInputBox({
    title: `Edit KPI · ${id}`,
    prompt: "KPI label",
    value: String(current?.label || id),
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (label === undefined) return false;
  const description = await vscode.window.showInputBox({
    title: `Edit KPI · ${id}`,
    prompt: "What does this KPI measure?",
    value: String(current?.description || ""),
    ignoreFocusOut: true
  });
  if (description === undefined) return false;
  const unit = await vscode.window.showInputBox({
    title: `Edit KPI · ${id}`,
    prompt: "Measurement unit",
    value: String(definition.unit || "value"),
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (unit === undefined) return false;
  const direction = await vscode.window.showQuickPick(
    [
      { label: "Increase", description: "Higher is better", value: "increase" },
      { label: "Decrease", description: "Lower is better", value: "decrease" },
      { label: "Target", description: "Reach one exact target", value: "target" },
      { label: "Range", description: "Stay between a minimum and maximum", value: "range" }
    ].sort((left, right) => Number(right.value === definition.direction) - Number(left.value === definition.direction)),
    { title: `Edit KPI · ${id}`, placeHolder: `Direction · current: ${definition.direction || "increase"}`, ignoreFocusOut: true }
  );
  if (!direction) return false;
  let targetValue;
  let targetMin;
  let targetMax;
  if (direction.value === "range") {
    targetMin = await vscode.window.showInputBox({
      title: `Edit KPI · ${id}`,
      prompt: "Target minimum",
      value: definition.targetMin === undefined ? "" : String(definition.targetMin),
      ignoreFocusOut: true,
      validateInput: validateRequiredFiniteNumber
    });
    if (targetMin === undefined) return false;
    targetMax = await vscode.window.showInputBox({
      title: `Edit KPI · ${id}`,
      prompt: "Target maximum",
      value: definition.targetMax === undefined ? "" : String(definition.targetMax),
      ignoreFocusOut: true,
      validateInput: (value) => validateRequiredFiniteNumber(value) || (Number(value) < Number(targetMin) ? "Target maximum must be greater than or equal to the minimum." : undefined)
    });
    if (targetMax === undefined) return false;
  } else {
    targetValue = await vscode.window.showInputBox({
      title: `Edit KPI · ${id}`,
      prompt: direction.value === "target" ? "Target value" : "Target value (optional)",
      value: definition.targetValue === undefined ? "" : String(definition.targetValue),
      ignoreFocusOut: true,
      validateInput: direction.value === "target" ? validateRequiredFiniteNumber : validateOptionalFiniteNumber
    });
    if (targetValue === undefined) return false;
  }
  const staleAfter = await vscode.window.showInputBox({
    title: `Edit KPI · ${id}`,
    prompt: "Consider the KPI stale after how many days?",
    value: String(definition.staleAfterDays || 30),
    ignoreFocusOut: true,
    validateInput: validatePositiveInteger
  });
  if (staleAfter === undefined) return false;
  const dashboard = await cli.json(["outcome", "dashboard", "--context-scope", "active", "--json"]);
  const okrs = [
    ...(dashboard?.missions || []).flatMap((mission) => mission.okrs || []),
    ...(dashboard?.standaloneOkrs || [])
  ];
  const selectedOkrs = await vscode.window.showQuickPick(
    okrs.map((okr) => ({
      label: okr.label || okr.id,
      description: okr.id,
      id: okr.id,
      picked: (okr.kpis || []).some((kpi) => kpi.id === id)
    })),
    { title: `Edit KPI · ${id}`, placeHolder: "OKRs measured by this KPI", canPickMany: true, ignoreFocusOut: true }
  );
  if (selectedOkrs === undefined) return false;
  const args = [
    "kpi", "upsert", id,
    "--label", label.trim(),
    "--description", description.trim(),
    "--unit", unit.trim(),
    "--direction", direction.value,
    "--stale-after", staleAfter.trim(),
    "--okr", selectedOkrs.map((okr) => okr.id).join(","),
    "--context-scope", "active",
    "--json"
  ];
  if (targetValue?.trim()) args.push("--target", targetValue.trim());
  if (targetMin?.trim()) args.push("--target-min", targetMin.trim());
  if (targetMax?.trim()) args.push("--target-max", targetMax.trim());
  await postOperation(webview, "running", `Updating KPI ${label.trim()}...`);
  await cli.run(args, { logOutput: false });
  await postOperation(webview, "success", `KPI updated: ${label.trim()}.`);
  return true;
}

async function compareKpiFromCockpit(cli, webview, message) {
  const kpiId = String(message.kpiId || "").trim();
  if (!kpiId) throw new Error("Missing KPI id.");
  const label = String(message.label || kpiId).trim();
  const deliveryDate = await vscode.window.showInputBox({
    title: `Compare KPI · ${label}`,
    prompt: "Delivery date separating the before and after periods",
    placeHolder: "YYYY-MM-DD or ISO date/time",
    ignoreFocusOut: true,
    validateInput: validateRequiredIsoDateOrDateTime
  });
  if (deliveryDate === undefined) return false;
  await postOperation(webview, "running", `Comparing ${label} before and after ${deliveryDate.trim()}...`);
  const comparison = await cli.json([
    "kpi", "compare", kpiId,
    "--delivery-date", deliveryDate.trim(),
    "--context-scope", "active",
    "--json"
  ]);
  const before = comparison?.before ? `${comparison.before.value} @ ${String(comparison.before.measuredAt || "").slice(0, 10)}` : "no value";
  const after = comparison?.after ? `${comparison.after.value} @ ${String(comparison.after.measuredAt || "").slice(0, 10)}` : "no value";
  const summary = `${label}: before ${before}; after ${after}; delta ${comparison?.delta ?? "unknown"}. ${comparison?.assessment || "Insufficient data."} Causality: ${comparison?.causality || "not established"}.`;
  await postOperation(webview, "success", summary);
  await vscode.window.showInformationMessage(summary, { modal: true });
  return true;
}

async function archiveKpiFromCockpit(cli, webview, message) {
  const kpiId = String(message.kpiId || "").trim();
  if (!kpiId) throw new Error("Missing KPI id.");
  const label = String(message.label || kpiId).trim();
  const choice = await vscode.window.showWarningMessage(
    `Archive KPI "${label}"? It will leave Today, but every measurement and provenance record will be preserved.`,
    { modal: true },
    "Archive"
  );
  if (choice !== "Archive") return false;
  await postOperation(webview, "running", `Archiving KPI ${label}...`);
  await cli.run(["kpi", "archive", kpiId, "--context-scope", "active", "--json"], { logOutput: false });
  await postOperation(webview, "success", `KPI archived: ${label}. Its measurement history is preserved.`);
  return true;
}

async function linkOutcomeContributionFromCockpit(cli, webview, message) {
  let okrId = String(message.okrId || "").trim();
  if (!okrId) {
    const okrs = await listOutcomeEntities(cli, "okr");
    if (!okrs.length) {
      await vscode.window.showWarningMessage("No OKR is available in the active context. Create one first.");
      return false;
    }
    const picked = await vscode.window.showQuickPick(
      okrs.map((entity) => ({ label: entity.label || entity.id, description: entity.id, id: entity.id })),
      { title: "Link work to an OKR", placeHolder: "Target OKR", ignoreFocusOut: true }
    );
    if (!picked) return false;
    okrId = picked.id;
  }
  const okr = await cli.json(["okr", "show", okrId, "--context-scope", "active", "--json"]);
  const [projects, features, tasks] = await Promise.all([
    listOutcomeEntities(cli, "project"),
    listOutcomeEntities(cli, "feature"),
    cli.json(["tasks", "--json", "--context-scope", "active"])
  ]);
  const workOptions = [
    ...projects.map((entity) => ({ label: entity.label || entity.id, description: `project:${entity.id}`, ref: `project:${entity.id}` })),
    ...features.map((entity) => ({ label: entity.label || entity.id, description: `feature:${entity.id}`, ref: `feature:${entity.id}` })),
    ...(Array.isArray(tasks) ? tasks : []).map((task) => ({ label: task.title || task.id, description: `task:${task.id}`, ref: `task:${task.id}` }))
  ];
  if (!workOptions.length) {
    await vscode.window.showWarningMessage("No project, feature or task is available in the active context.");
    return false;
  }
  const work = await vscode.window.showQuickPick(workOptions, {
    title: `Link work to ${okr?.label || okrId}`,
    placeHolder: "Project, feature or task expected to contribute",
    ignoreFocusOut: true
  });
  if (!work) return false;
  const expectedImpact = await vscode.window.showInputBox({
    title: `Link work to ${okr?.label || okrId}`,
    prompt: "Expected impact — this is a forecast, not measured causality",
    ignoreFocusOut: true,
    validateInput: validateRequiredText
  });
  if (expectedImpact === undefined) return false;
  const causalHypothesis = await vscode.window.showInputBox({
    title: `Link work to ${okr?.label || okrId}`,
    prompt: "Causal hypothesis (optional; it remains explicitly unproven)",
    ignoreFocusOut: true
  });
  if (causalHypothesis === undefined) return false;
  const keyResults = okr?.keyResults || okr?.definition?.keyResults || [];
  const selectedKeyResults = keyResults.length
    ? await vscode.window.showQuickPick(
      keyResults.map((keyResult) => ({ label: keyResult.title || keyResult.id, description: keyResult.id, id: keyResult.id })),
      { title: `Link work to ${okr?.label || okrId}`, placeHolder: "Affected key results (optional)", canPickMany: true, ignoreFocusOut: true }
    )
    : [];
  if (selectedKeyResults === undefined) return false;
  const confidence = await vscode.window.showInputBox({
    title: `Link work to ${okr?.label || okrId}`,
    prompt: "Confidence in the expected contribution (0–1)",
    value: "0.7",
    ignoreFocusOut: true,
    validateInput: validateConfidence
  });
  if (confidence === undefined) return false;
  const args = [
    "outcome", "link",
    "--work", work.ref,
    "--okr", okrId,
    "--expected-impact", expectedImpact.trim(),
    "--confidence", confidence.trim(),
    "--context-scope", "active",
    "--json"
  ];
  if (causalHypothesis.trim()) args.push("--hypothesis", causalHypothesis.trim());
  if (selectedKeyResults.length) args.push("--key-results", selectedKeyResults.map((keyResult) => keyResult.id).join(","));
  await postOperation(webview, "running", `Linking ${work.label} to ${okr?.label || okrId}...`);
  await cli.run(args, { logOutput: false });
  await postOperation(webview, "success", `${work.label} linked to ${okr?.label || okrId}. Expected impact is recorded separately from measured impact.`);
  return true;
}

async function recordKpiMeasurementFromCockpit(cli, webview, message) {
  let kpiId = String(message.kpiId || "").trim();
  let label = String(message.label || "").trim();
  let unit = String(message.unit || "").trim();
  if (!kpiId) {
    const kpis = await listOutcomeEntities(cli, "kpi");
    if (!kpis.length) {
      await vscode.window.showWarningMessage("No KPI is available in the active context. Create one first.");
      return false;
    }
    const picked = await vscode.window.showQuickPick(
      kpis.map((entity) => ({ label: entity.label || entity.id, description: entity.id, entity })),
      { title: "Record KPI measurement", placeHolder: "KPI", ignoreFocusOut: true }
    );
    if (!picked) return false;
    kpiId = picked.entity.id;
    label = picked.entity.label || picked.entity.id;
    unit = String(picked.entity.metadata?.outcome?.unit || "").trim();
  }
  const value = await vscode.window.showInputBox({
    title: `Measure ${label || kpiId}`,
    prompt: unit ? `Measured value (${unit})` : "Measured value",
    ignoreFocusOut: true,
    validateInput: validateRequiredFiniteNumber
  });
  if (value === undefined) return false;
  const measuredAt = await vscode.window.showInputBox({
    title: `Measure ${label || kpiId}`,
    prompt: "Immutable measurement timestamp (use a new timestamp to correct a prior value)",
    value: new Date().toISOString(),
    ignoreFocusOut: true,
    validateInput: validateRequiredIsoDateTime
  });
  if (measuredAt === undefined) return false;
  const note = await vscode.window.showInputBox({
    title: `Measure ${label || kpiId}`,
    prompt: "Context or provenance note (optional)",
    ignoreFocusOut: true
  });
  if (note === undefined) return false;
  const args = [
    "kpi", "measure", kpiId,
    "--value", value.trim(),
    "--measured-at", measuredAt.trim(),
    "--context-scope", "active",
    "--json"
  ];
  if (note.trim()) args.push("--note", note.trim());
  await postOperation(webview, "running", `Recording a measurement for ${label || kpiId}...`);
  await cli.run(args, { logOutput: false });
  await postOperation(webview, "success", `Measurement recorded for ${label || kpiId}.`);
  return true;
}

async function listOutcomeEntities(cli, kind) {
  const entities = await cli.json(["entity", "list", "--kind", kind, "--context-scope", "active", "--json"]);
  return Array.isArray(entities) ? entities : [];
}

async function keepCreatedOutcomeInActiveContext(cli, ref) {
  const active = await cli.json(["context-scope", "get", "--json"]);
  const scope = active?.scope;
  if (!scope || scope.mode !== "strict") return;
  const key = `${ref.kind}:${ref.id}`;
  const visibleAndWritable = (active.entities || []).some((entity) => entity.kind === ref.kind && entity.id === ref.id)
    && !(active.metadataOnlyEntityRefs || []).includes(key);
  if (visibleAndWritable) return;
  const sameRef = (candidate) => candidate?.kind === ref.kind && candidate?.id === ref.id;
  const nextScope = {
    ...scope,
    selectedEntities: [...(scope.selectedEntities || []).filter((candidate) => !sameRef(candidate)), ref],
    nodeSelections: [
      ...(scope.nodeSelections || []).filter((selection) => !sameRef(selection?.entity)),
      { entity: ref, role: "included", reason: "Created explicitly from Today" }
    ],
    excludedEntities: (scope.excludedEntities || []).filter((candidate) => !sameRef(candidate)),
    includedTypes: scope.includedTypes ? [...new Set([...scope.includedTypes, ref.kind])] : undefined,
    viewId: undefined,
    viewVersion: undefined
  };
  await cli.run(
    ["context-scope", "set", "--stdin", "--json", "--allow-boundary-change"],
    { input: JSON.stringify(nextScope), logOutput: false }
  );
}

function validateRequiredText(value) {
  return value && value.trim() ? undefined : "A value is required.";
}

function validateOutcomeId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "An id is required.";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
    ? undefined
    : "Use lowercase kebab-case, for example checkout-completion.";
}

function validateOptionalFiniteNumber(value) {
  if (!String(value || "").trim()) return undefined;
  return Number.isFinite(Number(value)) ? undefined : "Enter a finite number.";
}

function validateRequiredFiniteNumber(value) {
  return String(value || "").trim() && Number.isFinite(Number(value)) ? undefined : "Enter a finite number.";
}

function validatePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? undefined : "Enter a positive number of days.";
}

function validateOptionalIsoDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "Use an ISO date: YYYY-MM-DD.";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? undefined
    : "Use a real calendar date: YYYY-MM-DD.";
}

function validateRequiredIsoDate(value) {
  return validateOptionalIsoDate(value) || (String(value || "").trim() ? undefined : "A date is required.");
}

function validateRequiredIsoDateOrDateTime(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "A date is required.";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return validateRequiredIsoDate(normalized);
  return Number.isFinite(Date.parse(normalized)) ? undefined : "Use YYYY-MM-DD or a valid ISO date/time.";
}

function validateRequiredIsoDateTime(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "A timestamp is required.";
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    return "Use an ISO date/time, for example 2026-07-18T14:30:00.000Z.";
  }
  return undefined;
}

function validateConfidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? undefined
    : "Enter a number between 0 and 1.";
}

function validateKeyResultsJson(value, activeKpiIds) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return "Key results must be a JSON array.";
    const ids = new Set();
    for (const [index, keyResult] of parsed.entries()) {
      if (!keyResult || typeof keyResult !== "object" || Array.isArray(keyResult)) return `Key result ${index + 1} must be an object.`;
      if (!String(keyResult.title || "").trim()) return `Key result ${index + 1} needs a title.`;
      const id = String(keyResult.id || "").trim();
      if (!id || validateOutcomeId(id)) return `Key result ${index + 1} needs a lowercase kebab-case id.`;
      if (ids.has(id)) return `Duplicate key result id: ${id}.`;
      ids.add(id);
      if (keyResult.status !== undefined && !["not_started", "on_track", "at_risk", "off_track", "achieved"].includes(keyResult.status)) {
        return `Key result ${index + 1} has an invalid status.`;
      }
      if (keyResult.progress !== undefined && (!Number.isFinite(Number(keyResult.progress)) || Number(keyResult.progress) < 0 || Number(keyResult.progress) > 100)) {
        return `Key result ${index + 1} progress must be between 0 and 100.`;
      }
      for (const field of ["baselineValue", "currentValue", "targetValue"]) {
        if (keyResult[field] !== undefined && !Number.isFinite(Number(keyResult[field]))) return `Key result ${index + 1} ${field} must be a finite number.`;
      }
      if (keyResult.kpiId !== undefined && validateOutcomeId(String(keyResult.kpiId))) return `Key result ${index + 1} has an invalid kpiId.`;
      if (keyResult.kpiId !== undefined && activeKpiIds && !activeKpiIds.has(String(keyResult.kpiId))) {
        return `Key result ${index + 1} references a KPI outside the active context.`;
      }
      if (keyResult.dueDate !== undefined && validateOptionalIsoDate(String(keyResult.dueDate))) return `Key result ${index + 1} has an invalid dueDate.`;
    }
    return undefined;
  } catch {
    return "Enter a valid JSON array.";
  }
}

function normalizeTaskLinks(links) {
  if (!Array.isArray(links)) {
    return [];
  }
  return links
    .map((link) => ({
      relationType: String(link?.relationType || "").trim(),
      targetKind: String(link?.targetKind || "").trim(),
      targetId: String(link?.targetId || "").trim(),
      label: String(link?.label || "").trim()
    }))
    .filter((link) => link.relationType && link.targetKind && link.targetId);
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function serializeTaskLink(link) {
  return [link.relationType, link.targetKind, link.targetId, link.label].filter(Boolean).join(":");
}

async function maybeCurateCapture(cli, webview, captureId) {
  if (!captureId) {
    return;
  }
  const autoCurate = vscode.workspace.getConfiguration("workMemory").get("autoCurate") !== false;
  if (!autoCurate) {
    return;
  }
  await runCuration(cli, webview, captureId);
}

async function runCuration(cli, webview, captureId) {
  await postOperation(webview, "running", `Copilot is extracting sourced observations from ${captureId}...`);
  const result = await curateCaptureWithAgent(cli, captureId);
  if (result.ok) {
    await postOperation(webview, "success", `Observation package prepared for ${captureId} (${(result.toolsUsed || []).length} tool calls). Review it in Inbox.`);
  } else {
    const message = `Curation failed for ${captureId}: ${result.reason}`;
    cli.output.appendLine(`${message} (${result.attempts || 0} attempt(s), ${(result.toolsUsed || []).length} tool call(s)).`);
    await postOperation(webview, "error", `${message}. See Output > OneAgent for the turn-by-turn trace.`);
    void vscode.window.showErrorMessage(message, "Open OneAgent Output").then((choice) => {
      if (choice === "Open OneAgent Output") cli.output.show(true);
    });
  }
  return result;
}

function normalizeManualNoteTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag || "").trim()).filter(Boolean))];
}

async function createManualNote(cli, message) {
  const content = String(message.content || "");
  const title = String(message.title || "").trim() || deriveCaptureTitle(content);
  const contentType = message.contentType === "question" ? "question" : "note";
  const primary = String(message.primary || "oneagent:oneagent").trim();
  if (!content.trim()) throw new Error("Write something before saving the note.");
  const args = [
    "capture", "create",
    "--content-type", contentType,
    "--title", title,
    "--primary", primary,
    "--source-kind", "manual",
    "--source-origin", "cockpit",
    "--stdin",
    "--context-scope", "active",
    "--json"
  ];
  const tags = normalizeManualNoteTags(message.tags);
  if (tags.length) args.push("--tags", tags.join(","));
  const created = JSON.parse(await cli.run(args, { input: content, logOutput: false }));
  return { ...created, content };
}

async function indexManualNote(cli, noteId) {
  try {
    const result = await cli.json(["capture", "reingest", noteId, "--context-scope", "active", "--json"]);
    return result?.status === "failed" ? String(result.error || "indexing failed") : "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function refreshSavedManualNoteViews(cli, webview, refs) {
  try {
    await postCockpitState(cli, webview, { silent: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    cli.output?.appendLine?.(`Note saved locally, but the cockpit could not refresh: ${detail}`);
    await postOperation(webview, "warning", "Note saved locally, but the view could not refresh. Use OneAgent: Refresh to retry.");
    return;
  }
  try {
    await refreshManualNoteEntityContexts(cli, webview, refs);
  } catch (error) {
    cli.output?.appendLine?.(`Note saved locally, but its entity context could not refresh: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function updateManualNote(cli, message) {
  const noteId = String(message.id || "").trim();
  const content = String(message.content || "");
  const title = String(message.title || "").trim() || deriveCaptureTitle(content);
  const contentType = message.contentType === "question" ? "question" : "note";
  const primary = String(message.primary || "oneagent:oneagent").trim();
  if (!noteId) throw new Error("Missing note id.");
  if (!content.trim()) throw new Error("A note cannot be empty.");
  const args = [
    "capture", "update", noteId,
    "--title", title,
    "--content-type", contentType,
    "--primary", primary,
    "--stdin",
    "--context-scope", "active",
    "--json"
  ];
  const expectedUpdatedAt = String(message.expectedUpdatedAt || "").trim();
  if (expectedUpdatedAt) args.push("--expected-updated-at", expectedUpdatedAt);
  const tags = normalizeManualNoteTags(message.tags);
  if (tags.length) args.push("--tags", tags.join(","));
  else args.push("--tags", "");
  return JSON.parse(await cli.run(args, { input: content, logOutput: false }));
}

async function refreshManualNoteEntityContexts(cli, webview, refs) {
  const unique = [...new Set((refs || []).map((ref) => String(ref || "").trim()).filter(Boolean))];
  await Promise.all(unique.map((ref) => postEntityContext(cli, webview, ref)));
}

async function saveGenericCapture(cli, message) {
  const contentType = String(message.contentType || "raw_input").trim();
  const title = String(message.title || "").trim() || "Untitled capture";
  const content = String(message.content || "");
  const primary = String(message.primary || "oneagent:oneagent").trim();
  if (!content.trim()) {
    throw new Error("Missing capture content.");
  }

  const args = [
    "capture", "create",
    "--content-type", contentType,
    "--title", title,
    "--primary", primary,
    "--source-kind", "paste",
    "--source-origin", "cockpit",
    "--stdin",
    "--json"
  ];
  const tags = String(message.tags || "").trim();
  if (tags) {
    args.push("--tags", tags);
  }
  for (const related of Array.isArray(message.related) ? message.related : []) {
    if (related && related.ref && related.relation) {
      args.push("--related", `${related.ref}:${related.relation}`);
    }
  }

  const created = JSON.parse(await cli.run(args, { input: content, logOutput: true }));
  const reingest = await cli.json(["capture", "reingest", created.id, "--json"]);
  assertReingestSucceeded(reingest, created.id);
  await vscode.window.showInformationMessage(
    `Capture ${created.id} classified on ${primary} and ingested (${Number(reingest?.chunks || 0)} chunks, ${String(reingest?.status || "done")}).`
  );
  return { capture: created, reingest, primary };
}

async function saveCaptureFromCockpit(cli, message) {
  const result = await saveCapture(cli, {
    productId: String(message.productId || "").trim(),
    captureType: String(message.captureType || "").trim(),
    title: String(message.title || "").trim(),
    content: String(message.content || "")
  });
  await vscode.window.showInformationMessage(
    `Capture ingested into ${result.productId}: ${path.basename(result.filePath)} (${Number(result.chunks || 0)} chunks, ${Number(result.inboxProposals || 0)} inbox proposals).`
  );
  return result;
}

async function saveCapture(cli, input) {
  if (!input.productId) {
    throw new Error("Missing product id.");
  }
  if (!input.content || !input.content.trim()) {
    throw new Error("Missing capture content.");
  }

  const captureType = normalizeCaptureType(input.captureType);
  const title = input.title || deriveCaptureTitle(input.content);
  const root = path.join(cli.memoryWorkspaceRoot(), ".work-memory", "captures");
  ensureCaptureRoot(root);
  const folder = path.join(root, sanitizePathSegment(input.productId), captureType.folder);
  fs.mkdirSync(folder, { recursive: true });
  const filePath = uniqueCapturePath(folder, title);
  const now = new Date().toISOString();
  const body = [
    `# ${title}`,
    "",
    `Product: ${input.productId}`,
    `Type: ${captureType.label}`,
    `Captured: ${now}`,
    "Local-only: true",
    "",
    "---",
    "",
    input.content,
    ""
  ].join("\n");
  fs.writeFileSync(filePath, body, "utf8");
  const result = await runCliJsonTask(cli, `Ingesting capture ${title}`, [
    "ingest",
    filePath,
    "--product",
    input.productId,
    "--source-type",
    captureType.sourceType,
    "--json"
  ]);
  if (!result || Number(result.chunks || 0) === 0) {
    throw new Error(`Capture ${title} did not produce indexed chunks.`);
  }
  return {
    filePath,
    productId: input.productId,
    sourceType: captureType.sourceType,
    chunks: result?.chunks,
    inboxProposals: result?.inboxProposals
  };
}

function assertReingestSucceeded(reingest, captureId) {
  if (!reingest || reingest.status !== "indexed") {
    const error = reingest?.error ? `: ${reingest.error}` : "";
    throw new Error(`Capture ${captureId} was saved but not indexed${error}`);
  }
}

async function openPathInEditor(filePath) {
  if (!filePath) {
    return;
  }
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    await vscode.window.showWarningMessage(`File not found: ${resolved}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function loadInboxDetail(cli, id) {
  if (!id) {
    throw new Error("Select an inbox proposal first.");
  }
  let previewData;
  let item;
  const errors = [];
  try {
    previewData = await cli.json(["inbox", "preview", id, "--context-scope", "active", "--json"]);
    item = previewData?.item;
  } catch (error) {
    errors.push(`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!item) {
    const items = await cli.json(["inbox", "--json", "--scope", "portfolio", "--context-scope", "active"]);
    item = (items || []).find((candidate) => candidate.id === id);
  }
  if (!item) {
    throw new Error(`Inbox item not found: ${id}`);
  }

  const payload = item.payload || {};
  const captureId = typeof payload.captureId === "string" ? payload.captureId : undefined;
  const detail = { item, preview: previewData?.preview, source: undefined, capture: undefined, graphEvidence: [], diff: undefined, paths: [], errors };

  const graphEvidenceIds = Array.from(new Set([
    ...(Array.isArray(previewData?.preview?.evidenceObservationIds) ? previewData.preview.evidenceObservationIds : []),
    ...(Array.isArray(payload.evidenceObservationIds) ? payload.evidenceObservationIds : [])
  ].filter((value) => typeof value === "string" && value))).slice(0, 50);
  for (const observationId of graphEvidenceIds) {
    try {
      detail.graphEvidence.push(await cli.json([
        "observation", "show", observationId, "--context-scope", "active", "--json"
      ]));
    } catch (error) {
      errors.push(`Evidence ${observationId} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (item.sourceId) {
    try {
      detail.source = await cli.json(["sources", "show", item.sourceId, "--max-chars", "12000", "--context-scope", "active", "--json"]);
    } catch (error) {
      errors.push(`Source unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (captureId) {
    try {
      detail.capture = await cli.json(["capture", "show", captureId, "--context-scope", "active", "--json"]);
    } catch (error) {
      errors.push(`Capture unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof payload.reviewPath === "string" && item.productId) {
    try {
      detail.externalReview = await loadExternalWikiReview(cli, item.productId, payload.reviewPath, payload.contentHash);
    } catch (error) {
      errors.push(`Reviewed file unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  detail.diff = buildInboxDiff(detail.preview);

  addInboxDetailPath(detail.paths, "Target file", detail.preview?.targetPath || payload.targetPath);
  addInboxDetailPath(detail.paths, "Reviewed file", detail.externalReview?.path);
  addInboxDetailPath(detail.paths, "Source file", detail.source?.rawPath);
  addInboxDetailPath(detail.paths, "Capture file", detail.capture?.path);
  return detail;
}

async function loadExternalWikiReview(cli, productId, reviewPath, expectedHash) {
  const resolvedPath = await resolveInboxReviewFile(cli, productId, reviewPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${reviewPath}`);
  }
  const content = fs.readFileSync(resolvedPath, "utf8");
  const hash = sha256Text(`${productId}\0${reviewPath}\0${content}`);
  const maxChars = 24000;
  return {
    path: resolvedPath,
    reviewPath,
    content: content.length > maxChars ? content.slice(0, maxChars) : content,
    truncated: content.length > maxChars,
    hashMatches: typeof expectedHash === "string" ? expectedHash === hash : undefined
  };
}

async function resolveInboxReviewFile(cli, productId, reviewPath) {
  const products = await cli.json(["products", "--json"]);
  const product = (products || []).find((candidate) => candidate.id === productId);
  if (!product) {
    return undefined;
  }
  for (const repository of product.repositories || []) {
    const wikiRoot = repository.wikiRoot || "docs/wiki";
    const targetPath = reviewPath.startsWith(`${wikiRoot}/`) || reviewPath === wikiRoot
      ? path.resolve(repository.path, reviewPath)
      : path.resolve(repository.path, wikiRoot, reviewPath);
    const wikiPath = path.resolve(repository.path, wikiRoot);
    if (isPathInsideOrEqual(targetPath, wikiPath)) {
      return targetPath;
    }
  }
  return undefined;
}

function addInboxDetailPath(paths, label, value) {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  if (paths.some((entry) => entry.path === value)) {
    return;
  }
  paths.push({ label, path: value });
}

function buildInboxDiff(preview) {
  if (!preview || !preview.targetPath || !preview.content || preview.action === "none") {
    return undefined;
  }
  const targetPath = String(preview.targetPath);
  const proposed = String(preview.content);
  if (preview.action === "create" || !fs.existsSync(targetPath)) {
    return {
      mode: "create",
      title: "New file",
      targetPath,
      lines: proposed.split(/\r?\n/).map((text) => ({ type: "add", text }))
    };
  }
  const existing = fs.readFileSync(targetPath, "utf8");
  if (preview.action === "replace") {
    return {
      mode: "replace",
      title: "Replace existing file",
      targetPath,
      lines: [
        ...existing.split(/\r?\n/).map((text) => ({ type: "remove", text })),
        ...proposed.split(/\r?\n/).map((text) => ({ type: "add", text }))
      ]
    };
  }
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  const context = existing.split(/\r?\n/).slice(-8).map((text) => ({ type: "context", text }));
  const separatorLines = separator === "\n\n" ? [{ type: "add", text: "" }] : [];
  const added = proposed.split(/\r?\n/).map((text) => ({ type: "add", text }));
  return {
    mode: "append",
    title: "Append to existing file",
    targetPath,
    lines: [...context, ...separatorLines, ...added]
  };
}

async function runCliTask(cli, title, args) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title
    },
    () => cli.run(args)
  );
}

async function runCliJsonTask(cli, title, args) {
  const output = await runCliTask(cli, title, args);
  return output ? JSON.parse(output) : null;
}

async function diagnoseRuntime(cli) {
  const result = await runCliJsonTask(cli, "Diagnosing OneAgent runtime", ["diagnose", "--json"]);
  cli.output.show(true);
  cli.output.appendLine("OneAgent runtime diagnostics:");
  cli.output.appendLine(JSON.stringify(result, null, 2));
  const message = `OneAgent diagnostics: ${Number(result?.counts?.sources || 0)} sources, SQLite full-text search.`;
  await vscode.window.showInformationMessage(message);
  return result;
}

async function runIngestionSmokeTest(cli) {
  const product = await pickProduct(cli);
  if (!product) {
    throw new Error("No product selected for ingestion smoke test.");
  }

  const result = await runCliJsonTask(cli, `Running ingestion smoke test for ${product.id}`, [
    "smoke-ingest",
    "--entity",
    `product:${product.id}`,
    "--json"
  ]);
  cli.output.show(true);
  cli.output.appendLine("OneAgent ingestion smoke test result:");
  cli.output.appendLine(JSON.stringify(result, null, 2));
  await vscode.window.showInformationMessage(
    `OneAgent smoke test ok: ${result?.source?.title || "source"} (${Number(result?.chunks || 0)} chunks, ${Number(result?.inboxProposals || 0)} inbox proposals).`
  );
  return result;
}

async function cloneRepository(remoteUrl, targetPath) {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Cloning ${path.basename(targetPath)}`
      },
      () => new Promise((resolve, reject) => {
        cp.execFile("git", ["clone", remoteUrl, targetPath], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || stdout || error.message).trim()));
            return;
          }
          resolve(stdout.trim());
        });
      })
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isGitAuthenticationError(message)) {
      throw error;
    }

    const choice = await vscode.window.showErrorMessage(
      "GitHub authentication is required. OneAgent cannot answer HTTPS credential prompts from the background clone process.",
      "Open Terminal Clone",
      "Show Help"
    );
    if (choice === "Open Terminal Clone") {
      openCloneTerminal(remoteUrl, targetPath);
      await vscode.window.showInformationMessage("After the terminal clone completes, run OneAgent: Add Product again and choose Use an existing local folder.");
      return false;
    }
    if (choice === "Show Help") {
      await vscode.env.openExternal(vscode.Uri.parse("https://docs.github.com/en/authentication/connecting-to-github-with-ssh"));
      return false;
    }
    return false;
  }
}

function isGitAuthenticationError(message) {
  return /could not read Username|Authentication failed|terminal prompts disabled|Device not configured|Permission denied \(publickey\)/i.test(message);
}

function openCloneTerminal(remoteUrl, targetPath) {
  const parent = path.dirname(targetPath);
  fs.mkdirSync(parent, { recursive: true });
  const terminal = vscode.window.createTerminal({
    name: "OneAgent Git Clone",
    cwd: parent
  });
  terminal.show();
  terminal.sendText(`git clone ${shellQuote(remoteUrl)} ${shellQuote(path.basename(targetPath))}`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function writeFileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function repositoryNameFromRemote(remoteUrl) {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "");
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).pop() || "";
  return lastSegment.replace(/\.git$/i, "");
}

function captureTypeOptions() {
  return [
    { label: "Document", value: "document", folder: "documents", sourceType: "external_doc" },
    { label: "Flow", value: "flow", folder: "flows", sourceType: "flow_doc" },
    { label: "Meeting", value: "meeting", folder: "meetings", sourceType: "meeting_transcript" },
    { label: "User interview", value: "user_interview", folder: "user-interviews", sourceType: "meeting_transcript" },
    { label: "Summary", value: "summary", folder: "summaries", sourceType: "meeting_summary" },
    { label: "Note", value: "note", folder: "notes", sourceType: "raw_user_input" },
    { label: "Idea", value: "idea", folder: "ideas", sourceType: "raw_user_input" },
    { label: "Research", value: "research", folder: "research", sourceType: "external_doc" },
    { label: "Decision", value: "decision", folder: "decisions", sourceType: "decision_note" },
    { label: "Raw input", value: "raw_input", folder: "raw-inputs", sourceType: "raw_user_input" }
  ];
}

function normalizeCaptureType(value) {
  return captureTypeOptions().find((option) => option.value === value || option.sourceType === value || option.label === value)
    || captureTypeOptions()[0];
}

function deriveCaptureTitle(content) {
  const heading = content.match(/^#\s+(.+)$/m);
  const firstLine = heading?.[1] || content.split(/\r?\n/).find((line) => line.trim());
  return (firstLine || "Untitled capture").replace(/^[-*#\s]+/, "").trim().slice(0, 180) || "Untitled capture";
}

function ensureCaptureRoot(root) {
  fs.mkdirSync(root, { recursive: true });
  writeFileIfMissing(path.join(root, ".gitignore"), "*\n!.gitignore\n");
}

function uniqueCapturePath(folder, title) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(title) || "note";
  let candidate = path.join(folder, `${date}-${slug}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${date}-${slug}-${index}.md`);
    index += 1;
  }
  return candidate;
}

function slugify(value) {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizePathSegment(value) {
  return slugify(value) || "unknown-product";
}

async function pickProduct(cli) {
  const products = await cli.json(["products", "--json"]);
  if (!products || products.length === 0) {
    await vscode.window.showWarningMessage("No products configured. Use OneAgent: Add Product first.");
    return undefined;
  }

  if (products.length === 1) {
    return products[0];
  }

  const picked = await vscode.window.showQuickPick(
    products.map((product) => ({
      label: product.label || product.id,
      description: product.id,
      product
    })),
    { placeHolder: "Select product" }
  );
  return picked?.product;
}

function productFromItem(item) {
  const product = item?.product || item;
  if (product && typeof product.id === "string" && Array.isArray(product.repositories)) {
    return product;
  }
  return undefined;
}

function showSearchResults(cli, query, results, plane = "sources") {
  cli.output.clear();
  cli.output.appendLine(`Search: ${query} [${plane}]`);
  cli.output.appendLine("");

  if (results.length === 0) {
    cli.output.appendLine("No results.");
    cli.output.show(true);
    void vscode.window.showInformationMessage("No OneAgent results.");
    return;
  }

  for (const result of results) {
    const entity = result.entity ? `${result.entity.kind}:${result.entity.id}` : result.productId;
    const scopeMarker = result.outOfScope ? " [outside guided scope]" : "";
    cli.output.appendLine(`- [${result.plane || "sources"}] ${result.title}${entity ? ` (${entity})` : ""}${scopeMarker}`);
    cli.output.appendLine(`  ${result.snippet}`);
    const revision = result.revision?.number ?? result.provenance?.sourceRevision ?? "-";
    const score = Number.isFinite(Number(result.score)) ? ` score=${Number(result.score).toFixed(4)}` : "";
    cli.output.appendLine(`  status=${result.status || "unknown"} revision=${revision} source=${result.sourceId || "-"}${result.chunkId ? ` chunk=${result.chunkId}` : ""}${score}`);
    if (result.reason) cli.output.appendLine(`  reason=${result.reason}`);
    cli.output.appendLine("");
  }
  cli.output.show(true);

  void vscode.window.showQuickPick(
    results.map((result) => ({
      label: `$(${result.resultType === "observation" ? "verified" : "file-text"}) ${result.title}`,
      description: [result.plane, result.status, result.entity ? `${result.entity.kind}:${result.entity.id}` : result.productId]
        .filter(Boolean)
        .join(" · "),
      detail: `${result.snippet}${result.reason ? ` — ${result.reason}` : ""}`,
      result
    })),
    {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "OneAgent results"
    }
  );
}

function scanWikiGroups(product) {
  const pages = [];
  for (const repository of product.repositories || []) {
    const wikiRoot = repository.wikiRoot || "docs/wiki";
    const wikiPath = path.resolve(repository.path, wikiRoot);
    if (!fs.existsSync(wikiPath)) {
      continue;
    }
    for (const filePath of walkMarkdownFiles(wikiPath)) {
      const relativePath = path.relative(wikiPath, filePath).split(path.sep).join("/");
      pages.push({
        filePath,
        label: pageLabel(relativePath),
        group: wikiGroup(relativePath),
        productId: product.id,
        repositoryId: repository.id,
        repositoryPath: repository.path,
        wikiPath,
        relativePath
      });
    }
  }

  const order = ["Index", "Concepts", "Flows", "Integrations", "Decisions", "Risks", "Open Questions", "Glossary", "Other"];
  return order
    .map((label) => ({
      label,
      pages: pages
        .filter((page) => page.group === label)
        .sort((left, right) => left.label.localeCompare(right.label))
    }))
    .filter((group) => group.pages.length > 0);
}

function walkMarkdownFiles(root) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(entryPath));
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function wikiGroup(relativePath) {
  if (relativePath === "index.md" || relativePath === "index.markdown") {
    return "Index";
  }
  if (relativePath === "glossary.md" || relativePath === "glossary.markdown") {
    return "Glossary";
  }
  if (relativePath === "open-questions.md" || relativePath === "open-questions.markdown") {
    return "Open Questions";
  }
  const first = relativePath.split("/")[0];
  const groups = {
    concepts: "Concepts",
    flows: "Flows",
    integrations: "Integrations",
    decisions: "Decisions",
    risks: "Risks"
  };
  return groups[first] || "Other";
}

function pageLabel(relativePath) {
  const name = path.basename(relativePath, path.extname(relativePath));
  if (name === "index") {
    return "Index";
  }
  return humanizeId(name);
}

async function openWikiPage(item) {
  const page = item?.page || item;
  if (!page?.filePath) {
    await vscode.window.showWarningMessage("Select a wiki page first.");
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(page.filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function reindexWikiPage(cli, item) {
  const page = item?.page || item;
  const product = item?.product;
  if (!page?.filePath || !product?.id) {
    await vscode.window.showWarningMessage("Select a wiki page first.");
    return;
  }
  await runCliTask(cli, `Reindexing ${page.label}`, ["ingest", page.filePath, "--product", product.id]);
  await vscode.window.showInformationMessage(`Wiki page reindexed: ${page.label}`);
}

async function showCliError(cli, error) {
  const message = error instanceof Error ? error.message : String(error);
  cli.output.appendLine(`Error: ${message}`);
  const choice = await vscode.window.showErrorMessage(`OneAgent: ${message}`, "Show Output");
  if (choice === "Show Output") {
    cli.output.show(true);
  }
}

function validateId(value) {
  if (!value || !value.trim()) {
    return "An id is required.";
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value.trim())) {
    return "Use letters, numbers, dashes or underscores.";
  }
  return undefined;
}

function validateFolderName(value) {
  if (!value || !value.trim()) {
    return "A folder name is required.";
  }
  if (value.includes("/") || value.includes("\\") || value.trim() === "." || value.trim() === "..") {
    return "Use a folder name, not a path.";
  }
  return undefined;
}

function sanitizeId(value) {
  return String(value || "")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    || "repository";
}

function humanizeId(id) {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function previewProposal(cli, item) {
  const inboxItem = resolveInboxItem(item);
  if (!inboxItem) {
    await vscode.window.showWarningMessage("Select an inbox proposal first.");
    return;
  }
  await previewProposalById(cli, inboxItem.id, inboxItem.title);
}

async function previewProposalById(cli, id, title = "Proposal") {
  if (!id) {
    await vscode.window.showWarningMessage("Select an inbox proposal first.");
    return;
  }
  const data = await cli.json(["inbox", "preview", id, "--context-scope", "active", "--json"]);
  const panel = vscode.window.createWebviewPanel(
    "workMemoryProposalPreview",
    `OneAgent: ${data.item?.title || title}`,
    vscode.ViewColumn.Beside,
    {}
  );
  panel.webview.html = renderPreviewHtml(data);
}

async function runInboxAction(cli, item, action) {
  const inboxItem = resolveInboxItem(item);
  if (!inboxItem) {
    await vscode.window.showWarningMessage("Select an inbox proposal first.");
    return;
  }
  let acceptanceReview;
  if (action === "accept") {
    const review = await confirmInboxAcceptance(cli, inboxItem.id, inboxItem.title);
    if (!review.confirmed) return;
    acceptanceReview = review;
  }
  const args = ["inbox", action, inboxItem.id, "--context-scope", "active"];
  if (action === "accept" && acceptanceReview?.item?.revision) args.push("--revision", acceptanceReview.item.revision);
  if (action === "accept" && acceptanceReview?.allowBoundaryChange === true) {
    args.push("--allow-boundary-change");
  }
  if (action === "reject") {
    const graphChange = inboxItem.payload?.proposalKind === "graph_change";
    const feedback = await vscode.window.showInputBox({
      title: "Reject proposal",
      prompt: graphChange
        ? "Required: explain why this graph transaction is rejected."
        : "Optional: explain what is wrong and what the agent should correct.",
      ignoreFocusOut: true,
      validateInput: graphChange
        ? (value) => value.trim() ? undefined : "A rejection reason is required for graph transactions."
        : undefined
    });
    if (feedback === undefined) return;
    if (feedback.trim()) args.push("--feedback", feedback.trim());
  }
  if (action === "accept") {
    cli.muteWikiReviewWatcher();
  }
  await cli.run(args);
  await vscode.window.showInformationMessage(`Proposal ${action}ed: ${inboxItem.title}`);
}

async function confirmInboxAcceptance(cli, id, fallbackTitle = "Proposal", expectedRevision) {
  if (!id) throw new Error("Select an inbox proposal first.");
  const data = await cli.json(["inbox", "preview", id, "--context-scope", "active", "--json"]);
  const item = data?.item;
  if (!item) throw new Error(`Inbox item not found: ${id}`);
  if (["markdown_document_review", "wiki_write_review"].includes(item.payload?.proposalKind)) {
    if (item.documentEditable !== true) throw new Error("Full document access is required before accepting this draft.");
    if (expectedRevision && expectedRevision !== item.revision) throw new Error("The document changed. Review its current version before accepting it.");
    if (data.preview?.canAccept === false) throw new Error((data.preview.conflicts || []).join("; ") || "This document cannot be accepted.");
    const choice = await vscode.window.showWarningMessage(
      `Publier le document « ${item.title || fallbackTitle} » ?`,
      { modal: true, detail: `Le Markdown sera écrit dans votre mémoire privée : ${item.payload.targetPath}.` },
      "Publier"
    );
    return { confirmed: choice === "Publier", item, preview: data.preview };
  }
  if (item.payload?.proposalKind === "graph_change") {
    const preview = data.preview || {};
    if (preview.canAccept !== true) {
      const conflicts = Array.isArray(preview.conflicts) && preview.conflicts.length
        ? preview.conflicts.join("; ")
        : "invalid proposal state";
      throw new Error(`Graph change cannot be accepted: ${conflicts}`);
    }
    const boundaryChangeRequired = preview.boundaryChangeRequired === true;
    const boundaryReasons = Array.isArray(preview.boundaryChangeReasons) ? preview.boundaryChangeReasons.filter(Boolean) : [];
    const confirmLabel = boundaryChangeRequired ? "Apply and expand boundary" : "Apply graph changes";
    const choice = await vscode.window.showWarningMessage(
      boundaryChangeRequired
        ? `Apply ${Number(preview.changes?.length || 0)} graph change(s) and explicitly create graph content outside the active strict boundary?`
        : `Apply ${Number(preview.changes?.length || 0)} graph change(s) backed by ${Number(preview.evidenceObservationIds?.length || 0)} accepted observation(s)?`,
      {
        modal: true,
        detail: [
          "The transaction is atomic: either every entity and relation change is applied, or none is.",
          boundaryChangeRequired
            ? `Boundary expansion: ${boundaryReasons.join("; ") || "the proposal creates new graph entities"}.`
            : undefined
        ].filter(Boolean).join("\n\n")
      },
      confirmLabel
    );
    return {
      confirmed: choice === confirmLabel,
      allowBoundaryChange: boundaryChangeRequired && choice === confirmLabel,
      item,
      preview
    };
  }
  const choice = await vscode.window.showWarningMessage(
    `Accept proposal "${item.title || fallbackTitle}"?`,
    { modal: true },
    "Accept"
  );
  return { confirmed: choice === "Accept", item, preview: data?.preview };
}

function resolveInboxItem(item) {
  return item?.inboxItem || item;
}

function renderPreviewHtml(data) {
  const item = data?.item || {};
  const preview = data?.preview || {};
  const isGraphChange = Array.isArray(preview.changes);
  const content = isGraphChange
    ? preview.changes.map((change) => [
        `${Number(change.index || 0) + 1}. ${change.action || "unknown"} · ${change.target || "unknown target"}`,
        JSON.stringify({ op: change.op, before: change.before ?? null, after: change.after ?? null, conflicts: change.conflicts || [] }, null, 2)
      ].join("\n")).join("\n\n")
    : (preview.content || preview.reason || "");
  const target = isGraphChange ? "Atomic graph transaction" : (preview.targetPath || "No target");
  const graphSummary = isGraphChange
    ? `<p class="meta">Status: ${escapeHtml(preview.status || "unknown")} · ${escapeHtml(preview.canAccept ? "ready to accept" : "not ready")} · ${escapeHtml(preview.evidenceObservationIds?.length || 0)} accepted evidence item(s)</p>` +
      (Array.isArray(preview.conflicts) && preview.conflicts.length
        ? `<div class="conflicts"><strong>Conflicts</strong><ul>${preview.conflicts.map((conflict) => `<li>${escapeHtml(conflict)}</li>`).join("")}</ul></div>`
        : "")
    : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
      code, pre { font-family: var(--vscode-editor-font-family); }
      pre { white-space: pre-wrap; background: var(--vscode-editor-background); padding: 12px; border: 1px solid var(--vscode-panel-border); }
      .meta { color: var(--vscode-descriptionForeground); }
      .conflicts { border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 10px 12px; margin: 12px 0; }
    </style>
  </head>
  <body>
    <h2>${escapeHtml(item.title)}</h2>
    <p class="meta">${escapeHtml(item.type || "proposal")} -> ${escapeHtml(target)}</p>
    ${graphSummary}
    <pre>${escapeHtml(content)}</pre>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function iconForInboxType(type) {
  const icons = {
    open_question: "question",
    decision_candidate: "git-pull-request",
    risk: "warning",
    task: "checklist",
    wiki_proposal: "book"
  };
  return new vscode.ThemeIcon(icons[type] || "inbox");
}

return {
  activate,
  deactivate,
  WorkMemoryCli, loadCockpitState, handleCockpitMessage, createDocumentationOnlyCockpitState,
  __testing: {
    WorkMemoryCli,
    createDocumentationOnlyCockpitState,
    handleCockpitMessage,
    confirmInboxAcceptance,
    refreshActiveMonitoredContext,
    loadCurationPackageState,
    loadGraphChangeHistory,
    resolveNodeRuntime
  }
};

}

let nativeRuntime;
const native = () => nativeRuntime ||= createCockpitRuntime(require("vscode"));
module.exports = { createCockpitRuntime };
Object.defineProperty(module.exports, "activate", { enumerable: true, get: () => native().activate });
Object.defineProperty(module.exports, "deactivate", { enumerable: true, get: () => native().deactivate });
Object.defineProperty(module.exports, "__testing", { enumerable: true, get: () => native().__testing });
