const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const RELEASE_REPOSITORY = "ValentinDeSmet/OneAgent-release";
const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const RELEASE_PAGE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases`;
const RELEASE_ASSET_PREFIX = "work-memory-vscode-extension";
const AUTOMATIC_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTOMATIC_CHECK_POLL_MS = 60 * 60 * 1000;
const LAST_UPDATE_CHECK_KEY = "workMemory.lastExtensionUpdateCheckAt";
const INSTALLED_UPDATE_VERSION_KEY = "workMemory.installedExtensionUpdateVersion";
const MAX_ASSET_BYTES = 250 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 20 * 1000;
const ASSET_TIMEOUT_MS = 60 * 1000;

class GitHubReleaseUpdater {
  constructor(context, vscodeApi, output, options = {}) {
    this.context = context;
    this.vscode = vscodeApi;
    this.output = output;
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.updateDirectory = options.updateDirectory || path.join(os.tmpdir(), "oneagent-updates");
    this.timer = undefined;
    this.running = undefined;
    this.manualRequested = false;
  }

  start() {
    if (this.timer) return;
    this.triggerAutomaticCheck();
    this.timer = setInterval(() => this.triggerAutomaticCheck(), AUTOMATIC_CHECK_POLL_MS);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  triggerAutomaticCheck() {
    void this.checkIfDue().catch((error) => {
      this.log(`Automatic extension update failed: ${errorMessage(error)}`);
    });
  }

  enabled() {
    return this.vscode.workspace.getConfiguration("workMemory").get("automaticUpdates") !== false;
  }

  async checkIfDue() {
    if (!this.enabled()) return undefined;
    const lastCheck = Number(this.context.globalState.get(LAST_UPDATE_CHECK_KEY, 0));
    if (!isUpdateCheckDue(lastCheck, this.now())) return undefined;
    return this.run(false);
  }

  async checkForUpdates() {
    return this.vscode.window.withProgress({
      location: this.vscode.ProgressLocation.Notification,
      title: "Checking for OneAgent updates",
      cancellable: false
    }, () => this.run(true));
  }

  async run(manual) {
    if (manual) this.manualRequested = true;
    if (this.running) return this.running;
    this.running = this.performRun().finally(() => {
      this.running = undefined;
      this.manualRequested = false;
    });
    return this.running;
  }

  async performRun() {
    const checkedAt = this.now();
    let stage = "check";
    try {
      const release = await fetchLatestRelease(this.fetch);
      await this.context.globalState.update(LAST_UPDATE_CHECK_KEY, checkedAt);
      const currentVersion = this.currentVersion();
      if (compareVersions(release.version, currentVersion) <= 0) {
        await this.context.globalState.update(INSTALLED_UPDATE_VERSION_KEY, undefined);
        if (this.manualRequested) {
          await this.vscode.window.showInformationMessage(
            `OneAgent ${currentVersion} is already the latest version.`
          );
        }
        return { status: "current", currentVersion, release };
      }

      const alreadyInstalled = this.context.globalState.get(INSTALLED_UPDATE_VERSION_KEY) === release.version;
      if (!alreadyInstalled) {
        stage = "install";
        await this.installRelease(release);
        await this.context.globalState.update(INSTALLED_UPDATE_VERSION_KEY, release.version);
      }
      await this.offerReload(release, alreadyInstalled);
      return { status: alreadyInstalled ? "awaiting-reload" : "installed", currentVersion, release };
    } catch (error) {
      const failure = updateFailureMessage(stage, error);
      this.log(failure);
      if (this.manualRequested) {
        const action = await this.vscode.window.showErrorMessage(
          failure,
          "Open Releases"
        );
        if (action === "Open Releases") await this.openExternal(RELEASE_PAGE_URL);
      }
      return { status: "failed", error };
    }
  }

  currentVersion() {
    return String(this.context.extension?.packageJSON?.version || "0.0.0");
  }

  async installRelease(release) {
    await this.vscode.window.withProgress({
      location: this.vscode.ProgressLocation.Notification,
      title: `Updating OneAgent to ${release.version}`,
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Downloading the release assets…" });
      const [vsixBytes, checksumBytes] = await Promise.all([
        fetchBytes(this.fetch, release.vsix.url, MAX_ASSET_BYTES),
        fetchBytes(this.fetch, release.checksum.url, 1024 * 1024)
      ]);
      verifyChecksum(vsixBytes, checksumBytes, release.vsix.name);

      progress.report({ message: "Installing the verified VSIX…" });
      const installDirectory = this.installDirectoryUri();
      await this.vscode.workspace.fs.createDirectory(installDirectory);
      const vsixUri = this.vscode.Uri.joinPath(installDirectory, release.vsix.name);
      await this.vscode.workspace.fs.writeFile(vsixUri, vsixBytes);
      await this.vscode.commands.executeCommand("workbench.extensions.installExtension", vsixUri);
      this.log(`OneAgent ${release.version} downloaded, verified, and installed from ${RELEASE_REPOSITORY}.`);
    });
  }

  installDirectoryUri() {
    if (!this.vscode.env.remoteName) {
      return this.vscode.Uri.file(this.updateDirectory);
    }

    if (this.context.globalStorageUri?.scheme === "vscode-remote") {
      return this.context.globalStorageUri;
    }

    const remoteWorkspace = (this.vscode.workspace.workspaceFolders || [])
      .find((folder) => folder?.uri?.scheme === "vscode-remote");
    if (remoteWorkspace?.uri?.authority && this.context.globalStorageUri?.path) {
      return this.vscode.Uri.from({
        scheme: "vscode-remote",
        authority: remoteWorkspace.uri.authority,
        path: this.context.globalStorageUri.path
      });
    }

    throw new Error("VS Code did not provide an installable remote storage URI.");
  }

  async offerReload(release, alreadyInstalled) {
    const message = alreadyInstalled
      ? `OneAgent ${release.version} is installed and will be active after VS Code reloads.`
      : `OneAgent ${release.version} was installed automatically. Reload VS Code to use it.`;
    const action = await this.vscode.window.showInformationMessage(
      message,
      "Reload Window",
      "Release Notes"
    );
    if (action === "Reload Window") {
      await this.vscode.commands.executeCommand("workbench.action.reloadWindow");
    } else if (action === "Release Notes") {
      await this.openExternal(release.pageUrl);
    }
  }

  async openExternal(url) {
    await this.vscode.env.openExternal(this.vscode.Uri.parse(url));
  }

  log(message) {
    if (this.output?.appendLine) this.output.appendLine(message);
  }
}

async function fetchLatestRelease(fetchImplementation) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("This VS Code runtime does not provide HTTP fetch support.");
  }
  const response = await fetchImplementation(RELEASE_API_URL, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "OneAgent-VSCode-Updater",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub release API returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload.draft || payload.prerelease) {
    throw new Error("The latest GitHub release is not a stable published release.");
  }

  const version = normalizeVersion(payload.tag_name);
  if (!version) throw new Error(`Invalid release tag: ${String(payload.tag_name || "(missing)")}.`);
  const assets = selectReleaseAssets(payload.assets, version);
  return {
    version,
    pageUrl: String(payload.html_url || `${RELEASE_PAGE_URL}/tag/v${version}`),
    ...assets
  };
}

function selectReleaseAssets(assets, version) {
  const expectedVsix = `${RELEASE_ASSET_PREFIX}-${version}.vsix`;
  const expectedChecksum = `${expectedVsix}.sha256`;
  const list = Array.isArray(assets) ? assets : [];
  const find = (name) => list.find((asset) => asset?.name === name && asset?.browser_download_url);
  const vsix = find(expectedVsix);
  const checksum = find(expectedChecksum);
  if (!vsix || !checksum) {
    throw new Error(`Release v${version} must contain ${expectedVsix} and ${expectedChecksum}.`);
  }
  return {
    vsix: { name: expectedVsix, url: String(vsix.browser_download_url) },
    checksum: { name: expectedChecksum, url: String(checksum.browser_download_url) }
  };
}

async function fetchBytes(fetchImplementation, url, maximumBytes) {
  const response = await fetchImplementation(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "OneAgent-VSCode-Updater"
    }
  });
  if (!response.ok) throw new Error(`Download returned HTTP ${response.status} for ${url}.`);
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > maximumBytes) throw new Error(`Downloaded asset is larger than ${maximumBytes} bytes.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Downloaded asset is empty.");
  if (bytes.byteLength > maximumBytes) throw new Error(`Downloaded asset is larger than ${maximumBytes} bytes.`);
  return bytes;
}

function verifyChecksum(vsixBytes, checksumBytes, expectedFilename) {
  const checksumText = Buffer.from(checksumBytes).toString("utf8").trim();
  const match = checksumText.match(/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i);
  if (!match) throw new Error("The release checksum file is invalid.");
  if (match[2] && match[2].trim() !== expectedFilename) {
    throw new Error(`The checksum targets ${match[2].trim()} instead of ${expectedFilename}.`);
  }
  const actual = crypto.createHash("sha256").update(vsixBytes).digest("hex");
  if (!safeEqualHex(actual, match[1])) {
    throw new Error("The VSIX checksum does not match the published release checksum.");
  }
}

function safeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left).toLowerCase(), "utf8");
  const rightBuffer = Buffer.from(String(right).toLowerCase(), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+\.\d+\.\d+)$/);
  return match ? match[1] : undefined;
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left)?.split(".").map(Number);
  const rightParts = normalizeVersion(right)?.split(".").map(Number);
  if (!leftParts || !rightParts) throw new Error(`Cannot compare extension versions ${left} and ${right}.`);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function isUpdateCheckDue(lastCheckAt, now = Date.now()) {
  return !Number.isFinite(lastCheckAt)
    || lastCheckAt <= 0
    || now - lastCheckAt >= AUTOMATIC_CHECK_INTERVAL_MS;
}

function errorMessage(error) {
  if (error?.name === "TimeoutError") return "The network request timed out.";
  return error instanceof Error ? error.message : String(error);
}

function updateFailureMessage(stage, error) {
  const message = errorMessage(error);
  if (stage === "install") {
    const detail = message === "No Servers"
      ? "VS Code could not access the downloaded VSIX."
      : message;
    return `OneAgent downloaded the update but could not install it: ${detail}`;
  }
  return `OneAgent could not check for updates: ${message}`;
}

module.exports = {
  AUTOMATIC_CHECK_INTERVAL_MS,
  GitHubReleaseUpdater,
  INSTALLED_UPDATE_VERSION_KEY,
  LAST_UPDATE_CHECK_KEY,
  RELEASE_API_URL,
  RELEASE_REPOSITORY,
  compareVersions,
  fetchLatestRelease,
  isUpdateCheckDue,
  normalizeVersion,
  selectReleaseAssets,
  updateFailureMessage,
  verifyChecksum
};
