const LAST_LAUNCHED_VERSION_KEY = "workMemory.documentation.lastLaunchedVersion";
const WELCOME_COMPLETE_KEY = "workMemory.documentation.welcomeComplete";
const LAST_READ_RELEASE_NOTES_VERSION_KEY = "workMemory.documentation.lastReadReleaseNotesVersion";
const WORKSPACE_ONBOARDING_KEY = "workMemory.documentation.workspaceOnboardingComplete";

const EXTENSION_OPEN_KINDS = Object.freeze({
  FIRST_INSTALL: "first-install",
  UPDATE: "update",
  NORMAL: "normal-open"
});

const WORKSPACE_OPEN_KINDS = Object.freeze({
  FIRST_USE: "first-use",
  RETURNING: "returning",
  UNAVAILABLE: "unavailable"
});

/**
 * Classify the extension lifecycle independently from what the user has read.
 * This lets the update notification appear once while the unread release-note
 * badge remains visible until the local What's new guide is actually opened.
 */
function classifyDocumentationState(input) {
  const currentVersion = requiredVersion(input?.currentVersion);
  const previousVersion = storedVersion(input?.previousVersion);
  const lastReadReleaseNotesVersion = storedVersion(input?.lastReadReleaseNotesVersion);
  const knownExistingInstallation = input?.knownExistingInstallation === true;
  const hasWorkspace = input?.hasWorkspace !== false;
  const workspaceOnboardingComplete = input?.workspaceOnboardingComplete === true;

  const extensionOpenKind = !previousVersion
    ? knownExistingInstallation
      ? EXTENSION_OPEN_KINDS.UPDATE
      : EXTENSION_OPEN_KINDS.FIRST_INSTALL
    : previousVersion !== currentVersion
      ? EXTENSION_OPEN_KINDS.UPDATE
      : EXTENSION_OPEN_KINDS.NORMAL;
  const workspaceOpenKind = !hasWorkspace
    ? WORKSPACE_OPEN_KINDS.UNAVAILABLE
    : workspaceOnboardingComplete
      ? WORKSPACE_OPEN_KINDS.RETURNING
      : WORKSPACE_OPEN_KINDS.FIRST_USE;
  const isFirstInstall = extensionOpenKind === EXTENSION_OPEN_KINDS.FIRST_INSTALL;
  const isUpdate = extensionOpenKind === EXTENSION_OPEN_KINDS.UPDATE;
  const migratedExistingInstallation = !previousVersion && knownExistingInstallation;
  const showWelcome = input?.welcomeComplete !== true && !migratedExistingInstallation;

  return {
    extensionOpenKind,
    workspaceOpenKind,
    currentVersion,
    previousVersion,
    lastReadReleaseNotesVersion,
    isFirstInstall,
    isUpdate,
    isNormalOpen: extensionOpenKind === EXTENSION_OPEN_KINDS.NORMAL,
    isFirstWorkspaceUse: workspaceOpenKind === WORKSPACE_OPEN_KINDS.FIRST_USE,
    showWelcome,
    hasUnreadReleaseNotes: !isFirstInstall && lastReadReleaseNotesVersion !== currentVersion,
    shouldNotifyUpdate: isUpdate
  };
}

function readDocumentationState(context, currentVersion, options = {}) {
  assertMemento(context?.globalState, "globalState");
  assertMemento(context?.workspaceState, "workspaceState");
  return classifyDocumentationState({
    currentVersion,
    previousVersion: context.globalState.get(LAST_LAUNCHED_VERSION_KEY),
    welcomeComplete: context.globalState.get(WELCOME_COMPLETE_KEY, false),
    lastReadReleaseNotesVersion: context.globalState.get(LAST_READ_RELEASE_NOTES_VERSION_KEY),
    workspaceOnboardingComplete: context.workspaceState.get(WORKSPACE_ONBOARDING_KEY, false),
    knownExistingInstallation: options.knownExistingInstallation === true,
    hasWorkspace: options.hasWorkspace !== false
  });
}

/**
 * Record the launch immediately. Welcome and workspace onboarding remain
 * pending until their actual Help screen is displayed.
 */
async function readAndMarkDocumentationState(context, currentVersion, options = {}) {
  const state = readDocumentationState(context, currentVersion, options);
  const writes = [
    context.globalState.update(LAST_LAUNCHED_VERSION_KEY, state.currentVersion)
  ];
  if (state.isFirstInstall) {
    writes.push(context.globalState.update(LAST_READ_RELEASE_NOTES_VERSION_KEY, state.currentVersion));
  }
  if (!state.previousVersion && options.knownExistingInstallation === true && context.globalState.get(WELCOME_COMPLETE_KEY) !== true) {
    writes.push(context.globalState.update(WELCOME_COMPLETE_KEY, true));
  }
  await Promise.all(writes);
  return state;
}

async function acknowledgeDocumentationState(context, state, options = {}) {
  assertMemento(context?.globalState, "globalState");
  assertMemento(context?.workspaceState, "workspaceState");
  const writes = [];
  if (options.welcome === true && state.showWelcome) {
    writes.push(context.globalState.update(WELCOME_COMPLETE_KEY, true));
  }
  if (options.releaseNotes === true && state.hasUnreadReleaseNotes) {
    writes.push(context.globalState.update(LAST_READ_RELEASE_NOTES_VERSION_KEY, state.currentVersion));
  }
  if (options.workspace === true && state.isFirstWorkspaceUse) {
    writes.push(context.workspaceState.update(WORKSPACE_ONBOARDING_KEY, true));
  }
  await Promise.all(writes);
}

function acknowledgedDocumentationState(state, options = {}) {
  return {
    ...state,
    showWelcome: options.welcome === true ? false : state.showWelcome,
    hasUnreadReleaseNotes: options.releaseNotes === true ? false : state.hasUnreadReleaseNotes,
    shouldNotifyUpdate: options.releaseNotes === true ? false : state.shouldNotifyUpdate,
    isFirstWorkspaceUse: options.workspace === true ? false : state.isFirstWorkspaceUse,
    workspaceOpenKind: options.workspace === true && state.workspaceOpenKind === WORKSPACE_OPEN_KINDS.FIRST_USE
      ? WORKSPACE_OPEN_KINDS.RETURNING
      : state.workspaceOpenKind
  };
}

function requiredVersion(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A non-empty current extension version is required.");
  }
  return value.trim();
}

function storedVersion(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertMemento(value, name) {
  if (!value || typeof value.get !== "function" || typeof value.update !== "function") {
    throw new Error(`VS Code ${name} with get/update methods is required.`);
  }
}

module.exports = {
  EXTENSION_OPEN_KINDS,
  LAST_LAUNCHED_VERSION_KEY,
  LAST_READ_RELEASE_NOTES_VERSION_KEY,
  WELCOME_COMPLETE_KEY,
  WORKSPACE_ONBOARDING_KEY,
  WORKSPACE_OPEN_KINDS,
  acknowledgeDocumentationState,
  acknowledgedDocumentationState,
  classifyDocumentationState,
  readAndMarkDocumentationState,
  readDocumentationState
};
