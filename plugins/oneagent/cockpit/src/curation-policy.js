// Pure capability policy for autonomous curation. Keep this module free of a
// vscode dependency so packaging checks can test the security boundary.
const CURATION_TOOL_NAMES = new Set([
  "workMemory_wiki",
  "workMemory_organization",
  "workMemory_captureMemory",
  "workMemory_search",
  "workMemory_context",
  "workMemory_inbox"
]);

const CURATION_TOOL_ACTIONS = new Map([
  ["workMemory_wiki", new Set(["read_capture", "read", "log"])],
  ["workMemory_organization", new Set(["list", "list_entities", "list_relations", "entity_context", "resolve_entities"])],
  ["workMemory_captureMemory", new Set(["list", "curate"])],
  ["workMemory_inbox", new Set(["propose_observation"])]
]);

const WIKI_LINT_TOOL_ACTIONS = new Map([
  ["workMemory_wiki", new Set(["read", "log"])],
  ["workMemory_organization", new Set(["list_entities", "list_relations", "entity_context", "resolve_entities"])],
  ["workMemory_inbox", new Set(["propose"])]
]);

function isCurationToolCallAllowed(name, input) {
  if (!CURATION_TOOL_NAMES.has(name)) return false;
  const allowedActions = CURATION_TOOL_ACTIONS.get(name);
  if (!allowedActions) return true;
  const action = String(input?.action || "").trim();
  return allowedActions.has(action);
}

function isWikiLintToolCallAllowed(name, input) {
  if (!CURATION_TOOL_NAMES.has(name)) return false;
  const allowedActions = WIKI_LINT_TOOL_ACTIONS.get(name);
  // Search and Context are read-only and have no action discriminator.
  if (!allowedActions) return name === "workMemory_search" || name === "workMemory_context";
  return allowedActions.has(String(input?.action || "").trim());
}

module.exports = {
  CURATION_TOOL_NAMES,
  CURATION_TOOL_ACTIONS,
  WIKI_LINT_TOOL_ACTIONS,
  isCurationToolCallAllowed,
  isWikiLintToolCallAllowed
};
