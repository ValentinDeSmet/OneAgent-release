const cp = require("node:child_process");
const path = require("node:path");

const DAILY_REPOSITORY_CHECK_MS = 24 * 60 * 60 * 1000;
const REPOSITORY_CHECK_POLL_MS = 60 * 60 * 1000;
const LAST_REPOSITORY_CHECK_KEY = "workMemory.lastRepositoryCheckAt";

class DailyRepositoryUpdater {
  constructor(context, vscodeApi, cli, options = {}) {
    this.context = context;
    this.vscode = vscodeApi;
    this.cli = cli;
    this.now = options.now || Date.now;
    this.syncRepository = options.syncRepository || synchronizeRepository;
    this.onUpdated = options.onUpdated;
    this.running = undefined;
    this.timer = undefined;
  }

  start() {
    if (this.timer) return;
    this.triggerDueCheck();
    this.timer = setInterval(() => this.triggerDueCheck(), REPOSITORY_CHECK_POLL_MS);
  }

  triggerDueCheck() {
    void this.checkIfDue().catch((error) => {
      this.cli.output.appendLine(`Daily repository check failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  enabled() {
    return this.vscode.workspace.getConfiguration("workMemory").get("dailyRepositorySync") !== false;
  }

  async checkIfDue() {
    if (!this.enabled()) return undefined;
    const lastCheck = Number(this.context.workspaceState.get(LAST_REPOSITORY_CHECK_KEY, 0));
    if (!isDailyCheckDue(lastCheck, this.now())) return undefined;
    return this.run(false);
  }

  async runNow() {
    return this.run(true);
  }

  async run(manual) {
    if (this.running) return this.running;
    this.running = this.performRun(manual).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async performRun(manual) {
    const startedAt = this.now();
    this.cli.output.appendLine(`Linked repository check started (${manual ? "manual" : "daily"}).`);
    let report;
    try {
      const [entities, relations] = await Promise.all([
        this.cli.json(["entity", "list", "--json"]),
        this.cli.json(["relation", "list", "--json"])
      ]);
      report = await maintainLinkedRepositories(entities || [], relations || [], {
        syncRepository: this.syncRepository,
        reindexEntity: (entityRef) => this.cli.run([
          "reindex", "--entity", entityRef, "--include", "wiki,bmad"
        ])
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report = { dependencies: [], repositories: [], reindexedEntityRefs: [], reindexFailures: [], fatalError: message };
    }

    await this.context.workspaceState.update(LAST_REPOSITORY_CHECK_KEY, startedAt);
    logMaintenanceReport(this.cli.output, report);
    await notifyMaintenanceResult(this.vscode, report, manual);
    if (report.reindexedEntityRefs.length > 0 && this.onUpdated) {
      try {
        await this.onUpdated(report);
      } catch (error) {
        this.cli.output.appendLine(`Post-sync refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return report;
  }
}

function isDailyCheckDue(lastCheckAt, now = Date.now()) {
  return !Number.isFinite(lastCheckAt) || lastCheckAt <= 0 || now - lastCheckAt >= DAILY_REPOSITORY_CHECK_MS;
}

function checkEntityDependencies(entities, relations) {
  const known = new Set(entities.map(entityRef).filter(Boolean));
  return (relations || [])
    .filter((relation) => relation.relationType === "depends_on")
    .map((relation) => {
      const source = relationEndpointRef(relation, "source");
      const target = relationEndpointRef(relation, "target");
      return {
        source,
        target,
        status: known.has(target) ? "available" : "missing"
      };
    });
}

async function maintainLinkedRepositories(entities, relations, options = {}) {
  const syncRepository = options.syncRepository || synchronizeRepository;
  const reindexEntity = options.reindexEntity || (async () => undefined);
  const dependencies = checkEntityDependencies(entities, relations);
  const repositories = [];
  const updatedRepositoryRefs = new Set();
  const synchronizedPaths = new Map();

  for (const repository of (entities || []).filter((entity) => entity.kind === "repository")) {
    const configuredPath = String(repository.repoPath || "").trim();
    const repositoryPath = configuredPath ? path.resolve(configuredPath) : "";
    let result = synchronizedPaths.get(repositoryPath);
    if (!result) {
      result = configuredPath
        ? await syncRepository({ ...repository, path: configuredPath })
        : { status: "missing-path", message: "No local repository path is configured." };
      synchronizedPaths.set(repositoryPath, result);
    }
    const ref = `repository:${repository.id}`;
    repositories.push({ ...result, entityRef: ref, repositoryId: repository.id, path: repositoryPath });
    if (result.status === "updated") updatedRepositoryRefs.add(ref);
  }

  const reindexedEntityRefs = [];
  const reindexFailures = [];
  for (const ref of updatedRepositoryRefs) {
    try {
      await reindexEntity(ref);
      reindexedEntityRefs.push(ref);
    } catch (error) {
      reindexFailures.push({
        entityRef: ref,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { dependencies, repositories, reindexedEntityRefs, reindexFailures };
}

async function synchronizeRepository(repository, options = {}) {
  const configuredPath = String(repository.path || "").trim();
  if (!configuredPath) return { status: "missing-path", message: "No local repository path is configured." };
  const repositoryPath = path.resolve(configuredPath);
  const git = options.git || runGit;
  try {
    const workTree = await tryGit(git, repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
    if (!workTree.ok || workTree.output !== "true") {
      return { status: "not-git", message: "Path is not a Git worktree." };
    }

    const origin = await tryGit(git, repositoryPath, ["remote", "get-url", "origin"]);
    if (!origin.ok) return { status: "no-origin", message: "No origin remote is configured." };
    if (!isGithubRemote(origin.output)) return { status: "ignored", remote: origin.output, message: "Origin is not hosted on GitHub." };

    const branch = await tryGit(git, repositoryPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!branch.ok || !branch.output) return { status: "detached", remote: origin.output, message: "HEAD is detached." };
    const upstream = await tryGit(git, repositoryPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    const remoteBranch = upstream.ok && upstream.output.startsWith("origin/")
      ? upstream.output.slice("origin/".length)
      : branch.output;

    const dirty = await git(repositoryPath, ["status", "--porcelain"]);
    if (dirty) return { status: "dirty", branch: branch.output, remoteBranch, remote: origin.output, message: "Local changes are present." };

    const before = await git(repositoryPath, ["rev-parse", "HEAD"]);
    await git(repositoryPath, ["fetch", "--prune", "--quiet", "origin", remoteBranch]);
    const fetched = await git(repositoryPath, ["rev-parse", "FETCH_HEAD"]);
    if (before === fetched) return { status: "unchanged", branch: branch.output, remoteBranch, remote: origin.output, revision: before };

    const behind = await tryGit(git, repositoryPath, ["merge-base", "--is-ancestor", before, fetched]);
    if (behind.ok) {
      await git(repositoryPath, ["merge", "--ff-only", "--quiet", fetched]);
      const after = await git(repositoryPath, ["rev-parse", "HEAD"]);
      return { status: "updated", branch: branch.output, remoteBranch, remote: origin.output, before, after };
    }

    const ahead = await tryGit(git, repositoryPath, ["merge-base", "--is-ancestor", fetched, before]);
    if (ahead.ok) return { status: "ahead", branch: branch.output, remoteBranch, remote: origin.output, revision: before };
    return { status: "diverged", branch: branch.output, remoteBranch, remote: origin.output, message: "Local and remote histories have diverged." };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

function runGit(repositoryPath, args) {
  return new Promise((resolve, reject) => {
    cp.execFile("git", ["-C", repositoryPath, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || stdout || error.message).trim()));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

async function tryGit(git, repositoryPath, args) {
  try {
    return { ok: true, output: await git(repositoryPath, args) };
  } catch (error) {
    return { ok: false, error };
  }
}

function isGithubRemote(remote) {
  const value = String(remote || "").trim();
  if (/^[^@\s]+@github\.com:/i.test(value)) return true;
  try {
    return new URL(value).hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
}

function maintenanceIssues(report) {
  const unsafeStatuses = new Set(["failed", "dirty", "detached", "diverged", "not-git", "no-origin", "missing-path"]);
  return [
    ...(report.dependencies || []).filter((dependency) => dependency.status === "missing"),
    ...(report.repositories || []).filter((repository) => unsafeStatuses.has(repository.status)),
    ...(report.reindexFailures || []),
    ...(report.fatalError ? [{ message: report.fatalError }] : [])
  ];
}

function logMaintenanceReport(output, report) {
  const updated = (report.repositories || []).filter((repository) => repository.status === "updated");
  const checked = (report.repositories || []).filter((repository) => repository.status !== "ignored");
  output.appendLine(`Linked repository check finished: ${checked.length} GitHub repository(s), ${updated.length} updated, ${report.reindexedEntityRefs.length} repository entity(ies) reindexed.`);
  for (const dependency of (report.dependencies || []).filter((item) => item.status === "missing")) {
    output.appendLine(`Missing dependency: ${dependency.source} -> ${dependency.target}`);
  }
  for (const repository of report.repositories || []) {
    output.appendLine(`Repository ${repository.entityRef}: ${repository.status}${repository.message ? ` (${repository.message})` : ""}`);
  }
  for (const failure of report.reindexFailures || []) {
    output.appendLine(`Reindex ${failure.entityRef}: failed (${failure.message})`);
  }
  if (report.fatalError) output.appendLine(`Linked repository check failed: ${report.fatalError}`);
}

async function notifyMaintenanceResult(vscodeApi, report, manual) {
  const updated = (report.repositories || []).filter((repository) => repository.status === "updated").length;
  const issues = maintenanceIssues(report);
  const summary = `OneAgent repository check: ${updated} updated, ${report.reindexedEntityRefs.length} repository entity(ies) reindexed.`;
  if (issues.length > 0) {
    await vscodeApi.window.showWarningMessage(`${summary} ${issues.length} item(s) need attention. See OneAgent Output.`);
  } else if (manual || updated > 0) {
    await vscodeApi.window.showInformationMessage(summary);
  }
}

module.exports = {
  DAILY_REPOSITORY_CHECK_MS,
  DailyRepositoryUpdater,
  checkEntityDependencies,
  isDailyCheckDue,
  isGithubRemote,
  maintainLinkedRepositories,
  synchronizeRepository
};

function entityRef(entity) {
  const kind = String(entity?.kind || "").trim();
  const id = String(entity?.id || "").trim();
  return kind && id ? `${kind}:${id}` : "";
}

function relationEndpointRef(relation, side) {
  return `${String(relation?.[`${side}Kind`] || "").trim()}:${String(relation?.[`${side}Id`] || "").trim()}`;
}
