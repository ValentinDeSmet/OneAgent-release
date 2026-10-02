#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildBmadReadinessReport, buildTodayModel } from "../../bmad/src/index.ts";
import {
  buildOutcomeSnapshot,
  compareKpiBeforeAfter,
  linkContribution,
  readOkrDefinition,
  recordKpiMeasurement,
  upsertKpi,
  upsertOkr,
  type KpiDirection,
  type OkrKeyResult,
  type OkrStatus
} from "../../impact/src/index.ts";
import { backupMemory, createRuntime, exportPrivateMemory, inventoryMemory, previewPrivatePublication, publishPrivateMemory, restoreMemoryBackup, restorePrivateMemoryExport, verifyMemoryBackup, verifyPrivateMemoryExport } from "../../core/src/index.ts";
import {
  activateContextView,
  acceptGraphChangeProposal,
  applyContextScopeToGraphView,
  buildEntityContext,
  buildGraphViewModel,
  compareContextViews,
  compileContextPack,
  createContextView,
  deleteContextView,
  duplicateContextView,
  getActiveContextView,
  getContextView,
  getGraphChangeProposal,
  listContextViews,
  previewContextScope,
  previewGraphChangeProposal,
  proposeGraphChange,
  proposeContextNodes,
  refreshMonitoredContextView,
  rejectGraphChangeProposal,
  resolveContextScope,
  resolveEntityCandidates,
  suggestContextNodes,
  updateContextView
} from "../../graph/src/index.ts";
import { addProductToConfig, addRepositoryToConfig, deleteEntityFromConfig, deleteEntityLinkFromConfig, deleteProductFromConfig, loadConfig, mergeEntityInConfig, normalizeKindId, resolveConfigPath, resolveScope, saveWorkspaceTaxonomy, setWorkspaceSelfInConfig, upsertEntityInConfig, upsertEntityLinkInConfig } from "../../registry/src/index.ts";
import {
  assessWikiNeed,
  checkCaptureCuration,
  editCapture,
  editObservation,
  ensureCurationPackage,
  getCurationPackageDetail,
  ingestSource,
  listCurationPackageDetails,
  markObservationMeasured,
  markStaleSourceRevisions,
  mergeObservations,
  parseCaptureFile,
  proposeObservation,
  rebuildFromCaptures,
  reindexRepository,
  reingestCapture,
  reviewCurationPackage,
  reviewObservation,
  reviewObservationRelation,
  rewriteCaptureFile,
  serializeCaptureFile,
  setPackageWikiDecision,
  validateWikiSynthesis
} from "../../source-intake/src/index.ts";
import {
  inspectInboxPayloadReferences,
  type ObservationSearchResult,
  type SourceProvenanceRecord,
  type WorkMemoryDatabase
} from "../../storage/src/index.ts";
import { archiveTask, createTask, listTaskReadModel, updateTask } from "../../tasks/src/index.ts";
import { listPriorities, savePriority } from "../../tasks/src/priorities.ts";
import type { TaskDraft, TaskReadModelItem } from "../../tasks/src/index.ts";
import {
  appendWikiLog,
  applyWikiLayoutMigration,
  applyGlobalWikiPatch,
  applyWikiPatch,
  ensureWikiScaffold,
  entityWikiDir,
  globalWikiRoot,
  lintWiki,
  listEntityWikiPages,
  migrateKnowledge,
  listRepositoryWikiPages,
  listWikiPages,
  planWikiLayoutMigration,
  parseWikiMetadata,
  previewGlobalWikiPatch,
  previewWikiPatch,
  readWikiPage,
  resolveWikiHome,
  syncEntityWikiToRepo,
  validateWikiPlacement,
  withWikiMetadata,
  writeEntityWikiPage
} from "../../wiki/src/index.ts";
import {
  ACTIVE_CONTEXT_VIEW_UI_KEY,
  acquireMemoryLock,
  AGENT_CONTEXT_SCOPE_UI_KEY,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  assertContentType,
  assertCurationStatus,
  assertEntityKind,
  assertRelationType,
  atomicWriteFile,
  createId,
  createStableId,
  ENTITY_KINDS,
  isBuiltinEntityKind,
  isCoreEntityKind,
  isRelationType,
  PERSON_RELATIONS,
  PRACTICE_MISSION_RELATIONS,
  RELATION_TYPES,
  resolveEntityKind,
  resolveRelationType,
  STRUCTURAL_RELATIONS,
  isCaptureSourceKind,
  isCaptureSourceOrigin,
  isCaptureStatus,
  isPathInside,
  contextScopeInstruction,
  isMetadataOnlyEntityRef,
  isEntityFocusLevel,
  isEntityStatus,
  normalizeContextScope,
  normalizeEntityId,
  nowIso,
  parseEntityRef,
  parseRelatedEntityRef,
  sanitizeEntityForResolvedContext,
  sanitizeRelationForResolvedContext,
  sha256
} from "../../shared/src/index.ts";
import type {
  AgentContextScope,
  AgentContextScopeMode,
  CaptureEntityRef,
  CaptureRecord,
  ContextPack,
  CurationPackageRecord,
  CurationPackageStatus,
  EntityKind,
  EntityRef,
  InboxItem,
  InboxStatus,
  ObservationKind,
  ObservationEvidenceRecord,
  ObservationEventRecord,
  ObservationRecord,
  ObservationRelationRecord,
  ProductConfig,
  ResolvedContextScope,
  ScopeMode,
  SearchResult,
  SourceChunk,
  SourceRecord,
  SourceType,
  ContextPackRetentionPolicy,
  ContextPackSummary,
  WorkMemoryConfig,
  WikiSynthesisTarget
} from "../../shared/src/index.ts";
import type { CompileContextPackInput, ProposeGraphChangeInput, SaveContextViewInput, SuggestContextInput, UpdateContextViewInput } from "../../graph/src/index.ts";
import {
  sanitizeInboxItemForOutput,
  sanitizeInboxPreviewForOutput,
  sanitizeProductConfigForOutput,
  sanitizeRepositoryConfigForOutput,
  sanitizeResolvedContextForOutput,
  sanitizeSourceListRowsForOutput,
  sanitizeWikiPagesForOutput,
  strictSourceAccessForOutput
} from "./source-access-output.ts";

// In daemon mode process.stdin carries the request protocol, so --stdin payloads
// arrive through the request's `input` field instead. Declared before the entry
// point below: top-level await runs before later module-level let declarations.
let stdinOverride: string | undefined;
let daemonMode = false;
const openCliRuntimes = new Set<ReturnType<typeof createRuntime>>();

const args = process.argv.slice(2);

try {
  await main(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? "help";
  const unbound = ["help", "--help", "-h", "init", "daemon", "memory"].includes(command);
  if (unbound) return executeCommand(argv);
  // Cover config/file edits that happen before a runtime is opened as well.
  const rest = argv.slice(1);
  const contextPath = command === "context" ? firstPositional(rest) : undefined;
  const config = loadConfig(requireConfigPath(rest, contextPath ? path.resolve(contextPath) : process.cwd()));
  const release = acquireMemoryLock(config.storage.databasePath);
  try { await executeCommand(argv); } finally {
    try { for (const runtime of openCliRuntimes) runtime.close(); } finally { release(); }
  }
}

async function executeCommand(argv: string[]): Promise<void> {
  const command = argv[0] ?? "help";

  if (command === "daemon") {
    await daemonCommand();
    return;
  }
  const rest = argv.slice(1);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    initCommand(process.cwd());
    return;
  }

  if (command === "reset") {
    resetCommand(rest);
    return;
  }

  if (command === "memory") {
    await memoryCommand(rest);
    return;
  }

  if (command === "rebuild") {
    await rebuildCommand(rest);
    return;
  }

  if (command === "migrate-knowledge") {
    if (hasFlag(rest, "--ensure")) {
      if (hasFlag(rest, "--apply")) throw new Error("Use --ensure or --apply, not both.");
      const runtime = createCliRuntime(rest);
      try {
        console.log(JSON.stringify({
          status: runtime.knowledgeMigration ? "migrated" : "current",
          report: runtime.knowledgeMigration ?? null
        }, null, 2));
      } finally {
        runtime.close();
      }
      return;
    }
    const runtime = createRuntime({ cwd: process.cwd(), configPath: optionValue(rest, "--config"), syncPages: false, syncConfig: false, autoMigrate: false });
    try {
      const result = migrateKnowledge(runtime.config, runtime.db, hasFlag(rest, "--apply"));
      console.log(JSON.stringify(result, null, 2));
    } finally {
      runtime.close();
    }
    return;
  }

  if (command === "export") {
    exportCommand(rest);
    return;
  }

  if (command === "import") {
    importCommand(rest);
    return;
  }

  if (command === "products") {
    const runtime = createCliRuntime(rest);
    try {
      const contextScope = activeResolvedContextScope(runtime, rest);
      const allowedProducts = contextScope?.scope.mode === "strict"
        ? new Set(contextScope.entities.filter((entity) => entity.kind === "product").map((entity) => entity.id))
        : undefined;
      const products = runtime.config.products
        .filter((product) => !allowedProducts || allowedProducts.has(product.id))
        .map((product) => sanitizeProductConfigForOutput(product, contextScope));
      if (hasFlag(rest, "--json")) {
        console.log(JSON.stringify(products, null, 2));
        return;
      }
      for (const product of products) {
        console.log(`${product.id}\t${product.label}`);
      }
    } finally {
      runtime.close();
    }
    return;
  }

  if (command === "bmad") {
    bmadCommand(rest);
    return;
  }

  if (command === "today") {
    todayCommand(rest);
    return;
  }

  if (command === "okr") {
    okrCommand(rest);
    return;
  }

  if (command === "kpi") {
    kpiCommand(rest);
    return;
  }

  if (command === "outcome" || command === "outcomes") {
    outcomeCommand(rest);
    return;
  }

  if (command === "ui-state") {
    await uiStateCommand(rest);
    return;
  }

  if (command === "priorities") {
    const operation = positionalValues(rest)[0];
    if (!hasFlag(rest, "--stdin")) throw new Error("Priorities requires a JSON object on stdin.");
    const input = await readJsonStdin<Record<string, unknown>>();
    const runtime = createCliRuntime(rest);
    try {
      // A portfolio request must never silently widen an active strict session.
      const scope = activeResolvedContextScope(runtime, rest);
      if (scope?.scope.mode === "strict") throw new Error("Priorities is a portfolio view. Leave the strict context explicitly before using it.");
      if (input.scope !== "portfolio") throw new Error("Explicit portfolio scope is required.");
      const result = operation === "list" ? listPriorities(runtime.db, input)
        : operation === "save" ? savePriority(runtime.db, input) : undefined;
      if (!result) throw new Error("Use priorities list|save.");
      console.log(JSON.stringify(result));
    } finally { runtime.close(); }
    return;
  }

  if (command === "tasks") {
    tasksCommand(rest);
    return;
  }

  if (command === "product") {
    productCommand(rest);
    return;
  }

  if (command === "entities") {
    entitiesCommand(rest);
    return;
  }

  if (command === "entity") {
    await entityCommand(rest);
    return;
  }

  if (command === "links") {
    linksCommand(rest);
    return;
  }

  if (command === "link") {
    linkCommand(rest);
    return;
  }

  if (command === "relation") {
    relationCommand(rest);
    return;
  }

  if (command === "capture") {
    await captureCommand(rest);
    return;
  }

  if (command === "curation") {
    curationCommand(rest);
    return;
  }

  if (command === "curation-package") {
    curationPackageCommand(rest);
    return;
  }

  if (command === "observation" || command === "observations") {
    observationCommand(rest);
    return;
  }

  if (command === "me") {
    meCommand(rest);
    return;
  }

  if (command === "wiki") {
    await wikiCommand(rest);
    return;
  }

  if (command === "taxonomy") {
    taxonomyCommand(rest);
    return;
  }

  if (command === "repo") {
    repoCommand(rest);
    return;
  }

  if (command === "concepts") {
    conceptsCommand(rest);
    return;
  }

  if (command === "sources") {
    sourcesCommand(rest);
    return;
  }

  if (command === "graph") {
    graphCommand(rest);
    return;
  }

  if (command === "graph-view") {
    graphViewCommand(rest);
    return;
  }

  if (command === "context") {
    const targetPath = firstPositional(rest) ? path.resolve(firstPositional(rest) as string) : process.cwd();
    const runtime = createCliRuntime(rest, targetPath);
    try {
      const contextScope = activeResolvedContextScope(runtime, rest);
      const requestedScope = resolveScope(runtime.config, runtime.context, parseScopeOptions(rest));
      const strictProductIds = contextScope?.scope.mode === "strict"
        ? new Set(contextScope.entities.filter((entity) => entity.kind === "product").map((entity) => entity.id))
        : undefined;
      const scope = strictProductIds
        ? { ...requestedScope, includedProductIds: requestedScope.includedProductIds.filter((id) => strictProductIds.has(id)) }
        : requestedScope;
      const activeProduct = runtime.context.activeProduct && (!strictProductIds || strictProductIds.has(runtime.context.activeProduct.id))
        ? sanitizeProductConfigForOutput(runtime.context.activeProduct, contextScope)
        : null;
      const activeRepository = activeProduct
        ? sanitizeRepositoryConfigForOutput(runtime.context.activeRepository, contextScope)
        : null;
      const workspaceSelf = runtime.config.workspace.self;
      const self = !contextScope?.scope || contextScope.scope.mode !== "strict" || !workspaceSelf
        ? workspaceSelf ?? null
        : contextScope.entities.some((entity) => `${entity.kind}:${entity.id}` === workspaceSelf)
          ? workspaceSelf
          : null;
      if (hasFlag(rest, "--json")) {
        console.log(JSON.stringify({
          mode: runtime.context.mode,
          activeProduct,
          activeRepository,
          self,
          scope
        }, null, 2));
        return;
      }
      printContext(runtime.context.mode, runtime.context.activeProduct, scope.scope, scope.includedProductIds);
    } finally {
      runtime.close();
    }
    return;
  }

  if (command === "ingest") {
    await ingestCommand(rest);
    return;
  }

  if (command === "reindex") {
    await reindexCommand(rest);
    return;
  }

  if (command === "search") {
    await searchCommand(rest);
    return;
  }

  if (command === "context-scope") {
    await contextScopeCommand(rest);
    return;
  }

  if (command === "context-view") {
    await contextViewCommand(rest);
    return;
  }

  if (command === "context-pack") {
    await contextPackCommand(rest);
    return;
  }

  if (command === "graph-change") {
    await graphChangeCommand(rest);
    return;
  }

  if (command === "inbox") {
    await inboxCommand(rest);
    return;
  }


  if (command === "diagnose") {
    await diagnoseCommand(rest);
    return;
  }

  if (command === "smoke-ingest") {
    await smokeIngestCommand(rest);
    return;
  }

  throw new Error(`Unknown command "${command}". Run "pnpm wm help".`);
}

function initCommand(cwd: string): void {
  const memoryDir = path.join(cwd, ".work-memory");
  const configPath = path.join(memoryDir, "config.yaml");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(path.join(memoryDir, "cache"), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, "logs"), { recursive: true });

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, defaultConfig(), "utf8");
    console.log(`Created ${path.relative(cwd, configPath)}`);
  }

  const config = loadConfig(configPath);
  const release = acquireMemoryLock(config.storage.databasePath);
  try {
    ensureWikiScaffold(config);
    const runtime = createRuntime({ cwd, configPath: config.configPath });
    try {
      console.log(`Initialized ${path.relative(cwd, config.storage.databasePath)}`);
      console.log(`Wiki: ${path.relative(cwd, globalWikiRoot(config))}`);
      console.log(`Products: ${runtime.config.products.length}`);
    } finally { runtime.close(); }
  } finally { release(); }
}

function resetCommand(argv: string[]): void {
  const configPath = requireConfigPath(argv);
  const config = loadConfig(configPath);
  const memoryRoot = path.resolve(config.workspaceRoot, config.workspace.memoryRoot);
  if (fs.existsSync(config.storage.databasePath) && !hasFlag(argv, "--force")) {
    const runtime = createRuntime({ cwd: config.workspaceRoot, configPath: config.configPath });
    try {
      const outcomeEntities = runtime.db.listEntities().filter((entity) => entity.kind === "mission" || entity.kind === "okr" || entity.kind === "kpi");
      const measurementCount = runtime.db.listKpiMeasurementsForKpis(
        outcomeEntities.filter((entity) => entity.kind === "kpi").map((entity) => entity.id),
        1
      ).length;
      if (outcomeEntities.length > 0 || measurementCount > 0) {
        throw new Error(
          `Reset would delete ${outcomeEntities.length} Mission/OKR/KPI entit${outcomeEntities.length === 1 ? "y" : "ies"} and KPI measurements. `
          + "Export the memory first, then re-run reset with --force."
        );
      }
    } finally {
      runtime.close();
    }
  }
  const resetAll = hasFlag(argv, "--all");
  // Capture Markdown files are the durable source of truth: preserved unless explicitly wiped.
  const wipeCaptures = resetAll || hasFlag(argv, "--captures");
  const capturesDir = path.join(memoryRoot, "captures");
  const targets = resetAll
    ? [memoryRoot]
    : [
        config.storage.databasePath,
        ...(wipeCaptures ? [capturesDir] : []),
        path.join(memoryRoot, "cache"),
        path.join(memoryRoot, "logs")
      ];

  for (const target of targets) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`Deleted ${path.relative(process.cwd(), target) || target}`);
    }
  }

  if (!resetAll) {
    fs.mkdirSync(memoryRoot, { recursive: true });
    fs.mkdirSync(path.join(memoryRoot, "cache"), { recursive: true });
    fs.mkdirSync(path.join(memoryRoot, "logs"), { recursive: true });
  }

  if (resetAll) {
    console.log("Reset complete: .work-memory removed.");
  } else if (wipeCaptures) {
    console.log("Reset complete: database and capture files cleared, config preserved.");
  } else {
    const preserved = fs.existsSync(capturesDir) ? fs.readdirSync(capturesDir).length : 0;
    console.log(`Reset complete: database cleared, config and ${preserved} capture file(s) preserved.`);
    console.log('Run "pnpm wm rebuild" to restore captures and classifications into the database.');
  }
}

function productCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);
  const productId = positionalValues(argv)[1];
  if (!productId) {
    throw new Error("Missing product id.");
  }

  const configPath = requireConfigPath(argv);
  if (subcommand === "delete") {
    const config = deleteProductFromConfig(configPath, productId);
    console.log(`Deleted product: ${productId}`);
    console.log(`Config: ${path.relative(process.cwd(), config.configPath)}`);
    return;
  }

  if (subcommand !== "add") {
    throw new Error("Unknown product command. Use: pnpm wm product add|delete <id> [--label <label>].");
  }

  const config = addProductToConfig(configPath, {
    id: productId,
    label: optionValue(argv, "--label"),
    description: optionValue(argv, "--description"),
    parentEntityId: optionValue(argv, "--parent"),
    dependencies: optionValue(argv, "--dependencies")?.split(",").map((value) => value.trim()).filter(Boolean)
  });

  console.log(`Added product: ${productId}`);
  console.log(`Config: ${path.relative(process.cwd(), config.configPath)}`);
}

function entitiesCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const allowed = contextScope?.scope.mode === "strict"
      ? new Set(contextScope.entities.map((entity) => `${entity.kind}:${entity.id}`))
      : undefined;
    const entities = runtime.config.entities
      .filter((entity) => !allowed || allowed.has(`${entity.kind}:${entity.id}`))
      .map((entity) => sanitizeEntityForResolvedContext(contextScope, entity));
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(entities, null, 2));
      return;
    }
    for (const entity of entities) {
      console.log(`${entity.id}\t${entity.kind}\t${entity.label}`);
    }
  } finally {
    runtime.close();
  }
}

function linksCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const allowedIds = contextScope?.scope.mode === "strict"
      ? new Set(contextScope.entities.map((entity) => entity.id))
      : undefined;
    const links = runtime.config.entityLinks.filter((link) =>
      (!allowedIds || (allowedIds.has(link.sourceId) && allowedIds.has(link.targetId))) &&
      (!contextScope?.scope.allowedRelationTypes || contextScope.scope.allowedRelationTypes.includes(resolveRelationType(link.type).type))
    );
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(links, null, 2));
      return;
    }
    for (const link of links) {
      console.log(`${link.id}\t${link.sourceId} --${link.type}--> ${link.targetId}`);
    }
  } finally {
    runtime.close();
  }
}

function entityResolveCommand(argv: string[]): void {
  const fromOption = (optionValue(argv, "--names") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const names = [...positionalValues(argv).slice(1), ...fromOption];
  if (names.length === 0) {
    throw new Error("Provide names to resolve: pnpm wm entity resolve <name> [<name>...] or --names a,b.");
  }
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const allowed = contextScope?.scope.mode === "strict"
      ? new Set(contextScope.entities.map((entity) => `${entity.kind}:${entity.id}`))
      : undefined;
    const entities = runtime.db.listEntities().filter((entity) => !allowed || allowed.has(`${entity.kind}:${entity.id}`));
    // Metadata-only leaves participate in resolution by id/label only. Their aliases,
    // status and description must not become a side channel across product boundaries.
    const resolverEntities = entities.map((entity) => isMetadataOnlyEntityRef(contextScope, entity)
      ? { kind: entity.kind, id: entity.id, label: entity.label, status: "active" as const, createdAt: "", updatedAt: "" }
      : entity);
    const resolutions = resolveEntityCandidates(resolverEntities, names, {
      selfRef: runtime.config.workspace.self
    }).map((resolution) => ({
      ...resolution,
      candidates: resolution.candidates.map((candidate) => isMetadataOnlyEntityRef(contextScope, candidate)
        ? {
            kind: candidate.kind,
            id: candidate.id,
            label: candidate.label
          }
        : candidate)
    }));
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(resolutions, null, 2));
      return;
    }
    for (const resolution of resolutions) {
      console.log(`${resolution.name} -> ${resolution.recommendation}`);
      for (const candidate of resolution.candidates) {
        if ("ref" in candidate) {
          console.log(`  ${candidate.ref}\t${candidate.label} (${candidate.matchedOn}, score ${candidate.score})`);
        } else {
          console.log(`  ${candidate.kind}:${candidate.id}\t${candidate.label} (metadata only)`);
        }
      }
    }
  } finally {
    runtime.close();
  }
}

/** Merge a duplicate entity into a canonical one: graph, captures, wiki and aliases follow. */
function entityMergeCommand(argv: string[]): void {
  const fromRef = positionalValues(argv)[1];
  const intoOption = optionValue(argv, "--into");
  if (!fromRef || !intoOption) {
    throw new Error("Usage: pnpm wm entity merge <from-kind:id> --into <target-kind:id>.");
  }
  const runtime = createCliRuntime(argv);
  try {
    const from = parseEntityRef(fromRef);
    const into = parseEntityRef(intoOption);
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertEntityMutationInsideStrictScope(runtime, contextScope, from);
      assertEntityMutationInsideStrictScope(runtime, contextScope, into);
      if (isOrgEntityKind(from.kind)) {
        assertConfigEntityDeletionInsideStrictScope(runtime, contextScope, from.id);
      }
    }
    const result = mergeEntityIntoTarget(runtime, from, into);
    // Organization entities are mirrored in config. Removing the DB source of
    // a same-kind merge without removing that mirror would resurrect it on the
    // next runtime sync.
    if (isOrgEntityKind(from.kind)) {
      mergeEntityInConfig(requireConfigPath(argv), from.id, into.id);
    }

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ from: `${from.kind}:${from.id}`, into: `${into.kind}:${into.id}`, ...result }, null, 2));
      return;
    }
    console.log(`Merged ${from.kind}:${from.id} into ${into.kind}:${into.id}.`);
    console.log(`Captures reassigned: ${result.capturesReassigned}; relations rewritten: ${result.relationsRewritten} (${result.relationsDropped} self-loops dropped); wiki files moved: ${result.wikiFilesMoved}.`);
  } finally {
    runtime.close();
  }
}

/** Shared merge engine: repoint graph, captures (files included) and wiki from one entity onto another. */
function mergeEntityIntoTarget(
  runtime: ReturnType<typeof createCliRuntime>,
  from: EntityRef,
  into: EntityRef
): { capturesReassigned: number; relationsRewritten: number; relationsDropped: number; wikiFilesMoved: number } {
  const affectedCaptures = runtime.db.listCapturesForEntity(from.kind, from.id).map((capture) => capture.id);
  // Resolve both physical locations before the DB merge removes the source entity
  // and rewrites the relations used to determine product homes.
  const fromDir = entityWikiDir(runtime.config, from.kind, from.id, runtime.db);
  const intoDir = entityWikiDir(runtime.config, into.kind, into.id, runtime.db);
  const intoHome = resolveWikiHome(runtime.config, runtime.db, into);
  const result = runtime.db.mergeEntities(from.kind, from.id, into.kind, into.id);

  // Frontmatter files must reflect the re-pointed references.
  for (const captureId of affectedCaptures) {
    const capture = runtime.db.getCapture(captureId);
    if (capture) {
      rewriteCaptureFile(runtime, capture);
    }
  }

  // Move the duplicate's wiki slice under the target; the agent consolidates later.
  let wikiMoved = 0;
  if (fs.existsSync(fromDir)) {
    fs.mkdirSync(intoDir, { recursive: true });
    for (const entry of fs.readdirSync(fromDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const absolute = path.join(entry.parentPath ?? entry.path, entry.name);
      const relative = path.relative(fromDir, absolute);
      let target = path.join(intoDir, relative);
      if (fs.existsSync(target)) {
        const parsed = path.parse(target);
        target = path.join(parsed.dir, `${parsed.name}-merged-from-${from.id}${parsed.ext}`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(absolute, target);
      if (/\.(md|markdown)$/i.test(target) && intoHome.status === "resolved" && intoHome.home) {
        const content = fs.readFileSync(target, "utf8");
        const metadata = parseWikiMetadata(content);
        fs.writeFileSync(target, withWikiMetadata(content, {
          subject: into,
          home: intoHome.home,
          related: metadata?.related ?? []
        }), "utf8");
      }
      wikiMoved += 1;
    }
    fs.rmSync(fromDir, { recursive: true, force: true });
  }
  appendWikiLog(runtime.config, "curate", `merged ${from.kind}:${from.id} into ${into.kind}:${into.id} (${result.relationsRewritten} relations, ${wikiMoved} wiki files)`);
  return { ...result, wikiFilesMoved: wikiMoved };
}

function isOrgEntityKind(kind: string): kind is "domain" | "subdomain" | "team" {
  return kind === "domain" || kind === "subdomain" || kind === "team";
}

async function entityCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv);

  if (subcommand === "list") {
    entityListCommand(argv);
    return;
  }

  if (subcommand === "context") {
    entityContextCommand(argv);
    return;
  }

  if (subcommand === "resolve") {
    entityResolveCommand(argv);
    return;
  }

  if (subcommand === "merge") {
    entityMergeCommand(argv);
    return;
  }

  const entityId = positionalValues(argv)[1];
  if (!entityId) {
    throw new Error("Missing entity id.");
  }
  const configPath = requireConfigPath(argv);

  if (subcommand === "delete") {
    const kindOption = optionValue(argv, "--kind");
    if (kindOption) {
      // Runtime first: loadConfig registers workspace-defined kinds before validation.
      const runtime = createCliRuntime(argv);
      try {
        const kind = assertEntityKind(kindOption);
        const contextScope = activeResolvedContextScope(runtime, argv);
        if (!hasFlag(argv, "--allow-boundary-change")) {
          const target = { kind, id: entityId };
          assertEntityMutationInsideStrictScope(runtime, contextScope, target);
          if (isOrgEntityKind(kind)) {
            assertConfigEntityDeletionInsideStrictScope(runtime, contextScope, entityId);
          }
          if (hasFlag(argv, "--reassign-oneagent")) {
            assertWritableEntityInStrictScope(contextScope, { kind: "oneagent", id: "oneagent" });
          }
        }
        runtime.db.deleteEntity(kind, entityId, { reassignToDefault: hasFlag(argv, "--reassign-oneagent") });
        if (isOrgEntityKind(kind)) {
          deleteEntityFromConfig(configPath, entityId);
        }
        console.log(`Deleted entity: ${kind}:${entityId}`);
      } finally {
        runtime.close();
      }
      return;
    }
    // Legacy path: organization entity stored in config. It still removes
    // links and product-parent assignments, so it must honor the same strict
    // boundary as the typed path instead of becoming a config-only escape.
    const runtime = createCliRuntime(argv);
    try {
      const contextScope = activeResolvedContextScope(runtime, argv);
      if (!hasFlag(argv, "--allow-boundary-change")) {
        const configEntity = runtime.config.entities.find((entity) => entity.id === entityId);
        if (configEntity) {
          assertEntityMutationInsideStrictScope(runtime, contextScope, {
            kind: configEntity.kind,
            id: configEntity.id
          });
        }
        assertConfigEntityDeletionInsideStrictScope(runtime, contextScope, entityId);
      }
      deleteEntityFromConfig(configPath, entityId);
      console.log(`Deleted entity: ${entityId}`);
      return;
    } finally {
      runtime.close();
    }
  }

  if (subcommand !== "upsert") {
    throw new Error("Unknown entity command. Use: pnpm wm entity upsert|list|delete.");
  }

  // Runtime first: loadConfig registers workspace-defined kinds before validation.
  const runtime = createCliRuntime(argv);
  try {
    const kind = assertEntityKind(optionValue(argv, "--kind"));
    if (kind === "okr" || kind === "kpi") {
      throw new Error(`Entity kind ${kind} requires its structured outcome schema. Use "pnpm wm ${kind} upsert" instead of the generic entity command.`);
    }
    const status = optionValue(argv, "--status");
    if (status !== undefined && !isEntityStatus(status)) {
      throw new Error("Invalid --status. Use active, inactive, candidate or archived.");
    }
    const focusLevel = optionValue(argv, "--focus-level");
    if (focusLevel !== undefined && !isEntityFocusLevel(focusLevel)) {
      throw new Error("Invalid --focus-level. Use primary, supporting or informational.");
    }
    const existing = runtime.db.getEntity(kind, entityId);
    if (hasFlag(argv, "--fail-if-exists") && existing) throw new Error(`Entity already exists: ${kind}:${entityId}`);
    if (hasFlag(argv, "--require-existing") && !existing) throw new Error(`Entity does not exist: ${kind}:${entityId}`);
    const contextScope = activeResolvedContextScope(runtime, argv);
    const ownerIds = parseList(optionValue(argv, "--owners"));
    const contributorIds = parseList(optionValue(argv, "--contributors"));
    const memberIds = parseList(optionValue(argv, "--members"));
    if (!hasFlag(argv, "--allow-boundary-change")) {
      if (!existing && contextScope?.scope.mode === "strict") {
        throw new Error(`Creating entity ${kind}:${entityId} would broaden the active strict context; explicit boundary-change confirmation is required.`);
      }
      assertWritableEntityInStrictScope(contextScope, { kind, id: entityId });
      const parentId = optionValue(argv, "--parent");
      if (parentId) assertEntityIdInStrictScope(contextScope, parentId);
      for (const personValue of [...(ownerIds ?? []), ...(contributorIds ?? []), ...(memberIds ?? [])]) {
        const person = personValue.includes(":") ? parseEntityRef(personValue) : { kind: "person" as EntityKind, id: personValue };
        if (person.kind !== "person") {
          throw new Error(`Entity owner, contributor or member must reference a person: ${personValue}`);
        }
        assertWritableEntityInStrictScope(contextScope, person);
      }
    }
    const body = hasFlag(argv, "--stdin") ? await readStdin() : optionValue(argv, "--body");
    if (body !== undefined && !body.trim()) throw new Error("Entity Markdown content cannot be empty.");
    const entity = runtime.db.upsertEntity({
      id: entityId,
      kind,
      label: optionValue(argv, "--label"),
      description: optionValue(argv, "--description"),
      aliases: parseList(optionValue(argv, "--aliases")),
      status,
      parentId: optionValue(argv, "--parent"),
      ownerIds,
      contributorIds,
      tags: parseList(optionValue(argv, "--tags")),
      focusLevel,
      metadata: parseJsonOption(optionValue(argv, "--metadata")),
      repoPath: optionValue(argv, "--repo"),
      wikiRoot: optionValue(argv, "--wiki-root")
    }, body);
    // Mirror organization entities into config so the graph and extension keep seeing them.
    if (isOrgEntityKind(kind)) {
      upsertEntityInConfig(configPath, {
        id: entityId,
        kind,
        label: optionValue(argv, "--label"),
        description: optionValue(argv, "--description"),
        parentId: optionValue(argv, "--parent"),
        members: optionValue(argv, "--members")
      });
    }

    console.log(`Upserted entity: ${entity.kind}:${entityId}`);
  } finally {
    runtime.close();
  }
}

function entityListCommand(argv: string[]): void {
  const kind = optionValue(argv, "--kind");
  const runtime = createCliRuntime(argv);
  if (kind !== undefined) {
    assertEntityKind(kind);
  }
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const allowed = contextScope?.scope.mode === "strict"
      ? new Set(contextScope.entities.map((entity) => `${entity.kind}:${entity.id}`))
      : undefined;
    const entities = runtime.db.listEntities(kind)
      .filter((entity) => !allowed || allowed.has(`${entity.kind}:${entity.id}`))
      .map((entity) => sanitizeEntityForResolvedContext(contextScope, entity));
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(entities, null, 2));
      return;
    }
    if (entities.length === 0) {
      console.log("No entities.");
      return;
    }
    for (const entity of entities) {
      const status = "status" in entity ? `\t[${entity.status}]` : "\t[metadata only]";
      console.log(`${entity.kind}:${entity.id}\t${entity.label}${status}`);
      if ("description" in entity && entity.description) {
        console.log(`  ${entity.description}`);
      }
    }
  } finally {
    runtime.close();
  }
}

function entityContextCommand(argv: string[]): void {
  const ref = positionalValues(argv)[1];
  if (!ref) {
    throw new Error("Missing entity reference. Use: pnpm wm entity context <kind:id>.");
  }
  // Runtime first: loadConfig registers workspace-defined kinds before the ref is validated.
  const runtime = createCliRuntime(argv);
  const parsed = parseEntityRef(ref);
  try {
    const resolvedContext = activeResolvedContextScope(runtime, argv);
    if (resolvedContext?.scope.mode === "strict" && !resolvedContext.entities.some((entity) => entity.kind === parsed.kind && entity.id === parsed.id)) {
      throw new Error(`Entity is outside the active strict context scope: ${parsed.kind}:${parsed.id}`);
    }
    const model = buildEntityContext({
      config: runtime.config,
      context: runtime.context,
      db: runtime.db,
      kind: parsed.kind,
      id: parsed.id,
      include: parseList(optionValue(argv, "--include")),
      relation: optionValue(argv, "--relation"),
      contextScope: resolvedContext?.scope.mode === "strict" ? resolvedContext : undefined
    });
    // Attach the entity's curated wiki slice so UIs (cockpit selection panel) can render
    // the content inline without a second round-trip.
    const wikiAccess = strictSourceAccessForOutput(resolvedContext);
    const wikiPages = isMetadataOnlyEntityRef(resolvedContext, parsed) || wikiAccess === "none"
      ? []
      : sanitizeWikiPagesForOutput(
          listEntityWikiPages(runtime.config, parsed.kind, parsed.id, runtime.db) as unknown as Array<Record<string, unknown>>,
          wikiAccess
        );
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ ...model, wikiPages }, null, 2));
      return;
    }
    const summary = model.summary;
    console.log(`${model.entity.kind}:${model.entity.id} — ${model.entity.label} [${model.entity.status ?? "unknown"}]`);
    if (model.entity.description) {
      console.log(`  ${model.entity.description}`);
    }
    console.log(`Observations: ${summary.observations} (${summary.acceptedObservations} accepted, ${summary.proposedObservations} proposed, ${summary.contradictedObservations} contradicted) · Packages: ${summary.curationPackages}`);
    console.log(`Captures: ${summary.captures} · Objectives: ${summary.objectives} · Decisions: ${summary.decisions} · Questions: ${summary.openQuestions} · Risks: ${summary.risks}`);
    console.log(`Tasks: ${summary.tasks} (open ${summary.openTasks}, blocked ${summary.blockedTasks}) · Sources: ${summary.sources} · Inbox: ${summary.inboxPending}`);
    console.log(`Related entities: ${summary.relatedEntities} (people ${summary.relatedPeople})`);
    if (wikiPages.length > 0) {
      console.log(`Wiki pages: ${wikiPages.length} (${wikiPages.map((page) => String(page.relativePath ?? "unknown")).join(", ")})`);
    }
    for (const related of model.relatedEntities.slice(0, 12)) {
      const relation = related.relation && related.direction ? ` (${related.relation}, ${related.direction})` : " (metadata only)";
      console.log(`  - ${related.kind}:${related.id}${relation}`);
    }
    for (const note of model.notes) {
      console.log(`note: ${note}`);
    }
  } finally {
    runtime.close();
  }
}

function relationCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);

  if (subcommand === "delete") {
    const id = positionalValues(argv)[1];
    if (!id) {
      throw new Error("Missing relation id.");
    }
    const runtime = createCliRuntime(argv);
    try {
      const contextScope = activeResolvedContextScope(runtime, argv);
      if (contextScope?.scope.mode === "strict" && !hasFlag(argv, "--allow-boundary-change")) {
        const relation = runtime.db.listEntityRelations({}).find((candidate) => candidate.id === id);
        if (!relation) throw new Error(`Entity relation not found: ${id}`);
        assertWritableEntityInStrictScope(contextScope, { kind: relation.sourceKind, id: relation.sourceId });
        assertWritableEntityInStrictScope(contextScope, { kind: relation.targetKind, id: relation.targetId });
        assertRelationInStrictScope(contextScope, relation.relationType);
      }
      runtime.db.deleteEntityRelation(id);
    } finally {
      runtime.close();
    }
    console.log(`Deleted relation: ${id}`);
    return;
  }

  if (subcommand === "list") {
    const ref = optionValue(argv, "--entity");
    const runtime = createCliRuntime(argv);
    const filter = ref ? parseEntityRef(ref) : undefined;
    try {
      const contextScope = activeResolvedContextScope(runtime, argv);
      const allowed = contextScope?.scope.mode === "strict"
        ? new Set(contextScope.entities.map((entity) => `${entity.kind}:${entity.id}`))
        : undefined;
      const relations = runtime.db.listEntityRelations(filter ? { kind: filter.kind, id: filter.id } : {})
        .filter((relation) =>
          (!allowed || (
            allowed.has(`${relation.sourceKind}:${relation.sourceId}`) &&
            allowed.has(`${relation.targetKind}:${relation.targetId}`)
          )) && (!contextScope?.scope.allowedRelationTypes || contextScope.scope.allowedRelationTypes.includes(relation.relationType))
        )
        .map((relation) => sanitizeRelationForResolvedContext(contextScope, relation));
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(relations, null, 2));
        return;
      }
      if (relations.length === 0) {
        console.log("No relations.");
        return;
      }
      for (const relation of relations) {
        console.log(
          `${relation.id}\t${relation.sourceKind}:${relation.sourceId} --${relation.relationType}--> ${relation.targetKind}:${relation.targetId}`
        );
      }
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand !== "upsert") {
    throw new Error("Unknown relation command. Use: pnpm wm relation upsert|list|delete.");
  }

  const source = optionValue(argv, "--source");
  const target = optionValue(argv, "--target");
  const type = optionValue(argv, "--type");
  if (!source || !target || !type) {
    throw new Error("Missing --source, --target or --type. Use kind:id references.");
  }
  // Runtime first: loadConfig registers workspace-defined kinds and relation types.
  const runtime = createCliRuntime(argv);
  const sourceRef = parseEntityRef(source);
  const targetRef = parseEntityRef(target);
  const relationType = assertRelationType(type);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertWritableEntityInStrictScope(contextScope, sourceRef);
      assertWritableEntityInStrictScope(contextScope, targetRef);
      assertRelationInStrictScope(contextScope, relationType);
    }
    // Provenance: --capture records which capture justified the relation. Upserts merge
    // the capturedFrom list with the existing relation's so re-curations accumulate sources.
    const captureId = optionValue(argv, "--capture");
    const metadata = parseJsonOption(optionValue(argv, "--metadata")) ?? {};
    if (!hasFlag(argv, "--allow-boundary-change")) {
      if (captureId) assertCaptureInStrictScope(contextScope, captureId);
      if (Array.isArray(metadata.capturedFrom)) {
        for (const capturedFromId of metadata.capturedFrom.map(String)) {
          assertCaptureInStrictScope(contextScope, capturedFromId);
        }
      }
    }
    const existing = runtime.db
      .listEntityRelations({ kind: sourceRef.kind, id: sourceRef.id })
      .find((candidate) =>
        candidate.sourceKind === sourceRef.kind && candidate.sourceId === sourceRef.id &&
        candidate.targetKind === targetRef.kind && candidate.targetId === targetRef.id &&
        candidate.relationType === relationType
      );
    const capturedFrom = new Set<string>([
      ...(Array.isArray(existing?.metadata?.capturedFrom) ? existing.metadata.capturedFrom.map(String) : []),
      ...(Array.isArray(metadata.capturedFrom) ? (metadata.capturedFrom as unknown[]).map(String) : [])
    ]);
    if (captureId) {
      capturedFrom.add(captureId);
    }
    const mergedMetadata: Record<string, unknown> = { ...existing?.metadata, ...metadata };
    if (capturedFrom.size > 0) {
      mergedMetadata.capturedFrom = [...capturedFrom];
    }
    const relation = runtime.db.upsertEntityRelation({
      sourceKind: sourceRef.kind,
      sourceId: sourceRef.id,
      targetKind: targetRef.kind,
      targetId: targetRef.id,
      relationType,
      description: optionValue(argv, "--description") ?? existing?.description ?? null,
      metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : null
    });
    console.log(`Upserted relation: ${relation.id}`);
    console.log(`${sourceRef.kind}:${sourceRef.id} --${relationType}--> ${targetRef.kind}:${targetRef.id}`);
  } finally {
    runtime.close();
  }
}

async function captureCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv);

  if (subcommand === "classify") {
    captureClassifyCommand(argv);
    return;
  }
  if (subcommand === "relate") {
    captureRelateCommand(argv);
    return;
  }
  if (subcommand === "unrelate") {
    captureUnrelateCommand(argv);
    return;
  }
  if (subcommand === "list") {
    captureListCommand(argv);
    return;
  }
  if (subcommand === "delete") {
    captureDeleteCommand(argv);
    return;
  }
  if (subcommand === "reingest") {
    await captureReingestCommand(argv);
    return;
  }
  if (subcommand === "reclassify") {
    captureReclassifyCommand(argv);
    return;
  }
  if (subcommand === "show") {
    captureShowCommand(argv);
    return;
  }
  if (subcommand === "open") {
    captureOpenCommand(argv);
    return;
  }
  if (subcommand === "review") {
    captureReviewCommand(argv);
    return;
  }
  if (subcommand === "archive" || subcommand === "resolve" || subcommand === "restore") {
    captureLifecycleCommand(argv, subcommand);
    return;
  }
  if (subcommand === "create") {
    await captureCreateCommand(argv);
    return;
  }
  if (subcommand === "update") {
    await captureUpdateCommand(argv);
    return;
  }
  if (subcommand === "curate") {
    captureCurateCommand(argv);
    return;
  }

  throw new Error("Unknown capture command. Use: pnpm wm capture create|update|archive|resolve|restore|classify|relate|unrelate|reingest|reclassify|review|curate|show|open|list.");
}

/** Manage the workspace owner ("me"): the person entity first-person mentions resolve to. */
function meCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);

  if (subcommand === "set") {
    const raw = positionalValues(argv)[1];
    if (!raw) {
      throw new Error("Missing person id: pnpm wm me set <person-id> [--label <name>].");
    }
    const ref = raw.includes(":") ? parseEntityRef(raw) : { kind: "person" as EntityKind, id: raw };
    if (ref.kind !== "person") {
      throw new Error(`The workspace owner must be a person entity, got ${ref.kind}:${ref.id}.`);
    }
    const runtime = createCliRuntime(argv);
    try {
      const existing = runtime.db.getEntity("person", ref.id);
      runtime.db.upsertEntity({
        id: ref.id,
        kind: "person",
        label: optionValue(argv, "--label") ?? existing?.label ?? ref.id,
        description: existing?.description ?? "Workspace owner.",
        status: existing?.status ?? "active"
      });
      setWorkspaceSelfInConfig(requireConfigPath(argv), `person:${ref.id}`);
      console.log(`Workspace owner set: person:${ref.id}`);
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "clear") {
    setWorkspaceSelfInConfig(requireConfigPath(argv), undefined);
    console.log("Workspace owner cleared.");
    return;
  }

  if (subcommand === undefined || subcommand === "show") {
    const runtime = createCliRuntime(argv);
    try {
      const selfRef = runtime.config.workspace.self;
      if (!selfRef) {
        if (hasFlag(argv, "--json")) {
          console.log("null");
          return;
        }
        console.log("No workspace owner set. Use: pnpm wm me set <person-id> [--label <name>].");
        return;
      }
      const ref = parseEntityRef(selfRef);
      const entity = runtime.db.getEntity(ref.kind, ref.id);
      const relations = runtime.db.listEntityRelations({ kind: ref.kind, id: ref.id });
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({ ref: selfRef, entity, relationCount: relations.length }, null, 2));
        return;
      }
      console.log(`Workspace owner: ${selfRef}${entity ? ` (${entity.label})` : " (entity missing — run wm me set again)"}`);
      console.log(`Relations: ${relations.length}`);
    } finally {
      runtime.close();
    }
    return;
  }

  throw new Error("Unknown me command. Use: pnpm wm me [show|set <person-id> [--label <name>]|clear].");
}

function curationCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);

  if (subcommand === "queue" || subcommand === undefined) {
    const includeFailed = !hasFlag(argv, "--pending-only");
    const runtime = createCliRuntime(argv);
    try {
      const pending = runtime.db.listCaptures({ curationStatus: "pending" });
      const failed = includeFailed ? runtime.db.listCaptures({ curationStatus: "failed" }) : [];
      const queue = [...pending, ...failed].sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1));
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(
          queue.map((capture) => ({
            id: capture.id,
            title: capture.title,
            contentType: capture.contentType,
            primaryEntity: `${capture.primaryEntityKind}:${capture.primaryEntityId}`,
            curationStatus: capture.curationStatus,
            ingestionStatus: capture.ingestionStatus,
            createdAt: capture.createdAt
          })),
          null,
          2
        ));
        return;
      }
      if (queue.length === 0) {
        console.log("Curation queue is empty.");
        return;
      }
      for (const capture of queue) {
        console.log(`${capture.id}\t[${capture.curationStatus}] ${capture.title} -> ${capture.primaryEntityKind}:${capture.primaryEntityId}`);
      }
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "check") {
    const captureId = positionalValues(argv)[1];
    const repair = hasFlag(argv, "--repair");
    if (!captureId && !hasFlag(argv, "--all")) {
      throw new Error("Specify a capture id or --all.");
    }
    const runtime = createCliRuntime(argv);
    try {
      const ids = captureId ? [captureId] : runtime.db.listCaptures({}).map((capture) => capture.id);
      const results = ids.map((id) => checkCaptureCuration(runtime, id, { repair }));
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(captureId ? results[0] : results, null, 2));
        return;
      }
      for (const result of results) {
        if (!result.ok || result.repairs.length > 0) {
          console.log(`Capture ${result.captureId}:`);
          printCurationCheck(result);
        }
      }
      const clean = results.filter((result) => result.ok).length;
      console.log(`Checked ${results.length} capture(s): ${clean} ok, ${results.length - clean} with violations.`);
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "backfill") {
    const runtime = createCliRuntime(argv);
    try {
      const failed = runtime.db.listCaptures({ curationStatus: "failed" });
      // Stuck "curating" captures (e.g. VS Code closed mid-loop) are requeued too.
      const stuck = runtime.db.listCaptures({ curationStatus: "curating" });
      for (const capture of [...failed, ...stuck]) {
        const updated = runtime.db.updateCaptureCuration(capture.id, { curationStatus: "pending" });
        rewriteCaptureFile(runtime, updated);
      }
      const pending = runtime.db.listCaptures({ curationStatus: "pending" });
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({ requeued: failed.length + stuck.length, pending: pending.length }, null, 2));
        return;
      }
      console.log(`Requeued ${failed.length + stuck.length} capture(s) (failed or stuck). Curation queue: ${pending.length} pending.`);
      console.log("Run 'OneAgent: Curate Pending Captures' in VS Code (or ask the agent) to drain the queue.");
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "migrate-observations") {
    const apply = hasFlag(argv, "--apply");
    const runtime = createCliRuntime(argv);
    try {
      const candidates = runtime.db.listCaptures({ curationStatus: "curated" }).flatMap((capture) => {
        const packages = runtime.db.listCurationPackages({ captureId: capture.id })
          .filter((item) => item.status !== "superseded");
        const observationCount = packages.reduce(
          (count, packageRecord) => count + runtime.db.listObservations({ packageId: packageRecord.id }).length,
          0
        );
        if (observationCount > 0) return [];
        return [{
          id: capture.id,
          title: capture.title,
          sourceId: capture.sourceId,
          previousStatus: capture.curationStatus,
          reason: packages.length === 0
            ? "No observation curation package exists."
            : "The curation package contains no sourced observations."
        }];
      });
      if (apply) {
        for (const candidate of candidates) {
          const current = runtime.db.getCapture(candidate.id);
          if (!current) continue;
          const updated = runtime.db.updateCaptureCuration(candidate.id, {
            curationStatus: "pending",
            curationSummary: current.curationSummary ?? null
          });
          rewriteCaptureFile(runtime, updated);
          appendCurationLog(runtime, {
            captureId: candidate.id,
            action: "migrate_to_observations",
            previousStatus: candidate.previousStatus,
            status: "pending",
            reason: candidate.reason
          });
        }
      }
      const report = { dryRun: !apply, candidates, migrated: apply ? candidates.length : 0 };
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`${apply ? "Requeued" : "Found"} ${candidates.length} legacy curated capture(s) without sourced observations.${apply ? "" : " Re-run with --apply to migrate them."}`);
      for (const candidate of candidates) console.log(`- ${candidate.id}: ${candidate.title} — ${candidate.reason}`);
    } finally {
      runtime.close();
    }
    return;
  }

  throw new Error("Unknown curation command. Use: pnpm wm curation queue [--pending-only] [--json] | check (<capture-id> | --all) [--repair] [--json] | backfill [--json] | migrate-observations [--apply] [--json].");
}

function curationPackageCommand(argv: string[]): void {
  const subcommand = firstPositional(argv) ?? "list";
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const wikiAssessmentOptions = contextScope?.scope.mode === "strict"
      ? { allowedObservationIds: contextScope.observationIds }
      : {};
    if (subcommand === "list") {
      // Stale-revision maintenance is intentionally global. A strict read must
      // not turn into an implicit mutation of observations outside its boundary.
      if (contextScope?.scope.mode !== "strict") markStaleSourceRevisions(runtime.db);
      const statusOption = optionValue(argv, "--status");
      const requestedStatuses = statusOption && statusOption !== "all"
        ? new Set(parseList(statusOption) as CurationPackageStatus[])
        : undefined;
      const limitOption = optionValue(argv, "--limit");
      const parsedLimit = limitOption === undefined ? undefined : Number(limitOption);
      if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
        throw new Error("--limit must be a positive integer.");
      }
      const limit = parsedLimit;
      const singleStatus = requestedStatuses?.size === 1 ? [...requestedStatuses][0] : undefined;
      const entityRefs = parseScopeEntityRefs(optionValue(argv, "--entities") ?? optionValue(argv, "--entity"));
      for (const ref of entityRefs) {
        if (!runtime.db.getEntity(ref.kind, ref.id)) {
          throw new Error(`Curation package entity does not exist: ${ref.kind}:${ref.id}`);
        }
      }
      const entityPackageIds = entityRefs.length > 0
        ? new Set(runtime.db.listCurationPackages({ entityRefs }).map((item) => item.id))
        : undefined;
      let packages = contextScope?.scope.mode === "strict"
        ? contextScope.curationPackageIds
          .filter((id) => !entityPackageIds || entityPackageIds.has(id))
          .map((id) => readCurationPackageDetailInsideScope(runtime.db, id, contextScope))
          .filter((detail) => !singleStatus || detail.package.status === singleStatus)
        : listCurationPackageDetails(runtime.db, {
            status: singleStatus,
            limit,
            entityRefs: entityRefs.length > 0 ? entityRefs : undefined
          }, wikiAssessmentOptions);
      if (requestedStatuses) packages = packages.filter((detail) => requestedStatuses.has(detail.package.status));
      if (limit !== undefined) packages = packages.slice(0, limit);
      printCurationPackages(packages, hasFlag(argv, "--json"));
      return;
    }
    if (subcommand === "show") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing curation package id.");
      assertCurationPackageIdInsideStrictScope(contextScope, id);
      const detail = readCurationPackageDetailInsideScope(runtime.db, id, contextScope);
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        printCurationPackageDetail(detail);
      }
      return;
    }
    if (subcommand === "create") {
      const captureId = optionValue(argv, "--capture");
      const sourceId = optionValue(argv, "--source");
      if (optionValue(argv, "--product")) {
        throw new Error("--product is no longer supported for curation packages; source and capture links resolve typed entities.");
      }
      if (captureId) assertCaptureInStrictScope(contextScope, captureId);
      if (sourceId && contextScope?.scope.mode === "strict" && !contextScope.sourceIds.includes(sourceId)) {
        throw new Error(`Source is outside the active strict context scope: ${sourceId}`);
      }
      // Source/capture inference happens inside ensureCurationPackage. Keep the
      // creation and the final boundary assertion atomic.
      const created = runtime.db.runInTransaction(() => {
        const packageRecord = ensureCurationPackage(runtime.db, {
          captureId,
          sourceId,
          title: optionValue(argv, "--title"),
          summary: optionValue(argv, "--summary")
        });
        assertCurationPackageAnchorInsideStrictScope(contextScope, packageRecord);
        return packageRecord;
      });
      console.log(hasFlag(argv, "--json") ? JSON.stringify(created, null, 2) : `Curation package: ${created.id}`);
      return;
    }
    if (subcommand === "review") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing curation package id.");
      assertCurationPackageIdInsideStrictScope(contextScope, id);
      assertStrictSourceAccess(contextScope, "snippets", "Reviewing a curation package");
      const acceptObservationIds = parseList(optionValue(argv, "--accept"));
      const rejectObservationIds = parseList(optionValue(argv, "--reject"));
      for (const observationId of [...(acceptObservationIds ?? []), ...(rejectObservationIds ?? [])]) {
        assertObservationIdInsideStrictScope(contextScope, observationId);
      }
      const reviewedResult = reviewCurationPackage(runtime.db, id, {
        acceptObservationIds,
        rejectObservationIds,
        rejectionReason: optionValue(argv, "--reason")
      }, observationMutationOptions(contextScope));
      const reviewed = contextScope?.scope.mode === "strict"
        ? readCurationPackageDetailInsideScope(runtime.db, id, contextScope)
        : reviewedResult;
      if (hasFlag(argv, "--json")) console.log(JSON.stringify(reviewed, null, 2));
      else printCurationPackageDetail(reviewed);
      return;
    }
    if (subcommand === "wiki-decision") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing curation package id.");
      assertCurationPackageIdInsideStrictScope(contextScope, id);
      const decision = optionValue(argv, "--decision");
      if (decision !== "not_needed" && decision !== "suggested") throw new Error("Use --decision not_needed|suggested.");
      assertStrictSourceAccess(contextScope, "snippets", "Recording a wiki decision from observation evidence");
      const evidenceObservationIds = parseList(optionValue(argv, "--evidence")) ?? [];
      for (const observationId of evidenceObservationIds) {
        assertObservationIdInsideStrictScope(contextScope, observationId);
        const observation = requireObservationRecord(runtime.db.getObservation(observationId), observationId);
        assertObservationEvidenceInsideStrictScope(runtime.db, contextScope, observation);
      }
      let target: WikiSynthesisTarget | undefined;
      if (decision === "suggested") {
        const targetValue = optionValue(argv, "--target");
        if (!targetValue) throw new Error("A suggested wiki synthesis requires --target <kind:id>.");
        const subject = parseEntityRef(targetValue);
        assertWritableEntityInStrictScope(contextScope, subject);
        const homeValue = optionValue(argv, "--home");
        const resolution = homeValue
          ? { home: parseEntityRef(homeValue), status: "resolved" as const, reason: "Explicit home." }
          : resolveWikiHome(runtime.config, runtime.db, subject);
        if (!resolution.home || resolution.status !== "resolved") {
          throw new Error(`Cannot resolve wiki home for ${targetValue}: ${resolution.reason}`);
        }
        assertWritableEntityInStrictScope(contextScope, resolution.home);
        const page = optionValue(argv, "--page") ?? "index.md";
        if (optionValue(argv, "--product")) {
          throw new Error("--product is no longer supported for wiki synthesis; use --target kind:id and --home kind:id.");
        }
        validateWikiPlacement(runtime.config, runtime.db, subject, resolution.home, page);
        target = {
          subject,
          home: resolution.home,
          page
        };
      }
      const updated = setPackageWikiDecision(runtime.db, id, {
        decision,
        reason: optionValue(argv, "--reason") as Parameters<typeof setPackageWikiDecision>[2]["reason"],
        evidenceObservationIds,
        target
      });
      console.log(hasFlag(argv, "--json") ? JSON.stringify(updated, null, 2) : `Wiki decision: ${updated.wikiDecision}${updated.wikiReason ? ` (${updated.wikiReason})` : ""}`);
      return;
    }
    if (subcommand === "wiki-assess") {
      const id = positionalValues(argv)[1];
      if (contextScope?.scope.mode === "strict" && !id) {
        throw new Error("Global wiki assessment is outside the active strict context. Provide an in-scope curation package id.");
      }
      if (id) assertCurationPackageIdInsideStrictScope(contextScope, id);
      const detail = id ? readCurationPackageDetailInsideScope(runtime.db, id, contextScope) : undefined;
      const assessment = detail?.wikiAssessment ?? assessWikiNeed(runtime.db, undefined, wikiAssessmentOptions);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(assessment, null, 2) : `${assessment.recommended ? "Wiki synthesis may be useful" : "No wiki page needed"}: ${assessment.reasons.join(" ") || "keep the knowledge as observations"}`);
      return;
    }
    throw new Error("Unknown curation-package command. Use list|show|create|review|wiki-decision|wiki-assess.");
  } finally {
    runtime.close();
  }
}

function observationCommand(argv: string[]): void {
  const subcommand = firstPositional(argv) ?? "list";
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (subcommand === "list") {
      if (contextScope?.scope.mode !== "strict") markStaleSourceRevisions(runtime.db);
      const filter = {
        packageId: optionValue(argv, "--package"),
        sourceId: optionValue(argv, "--source"),
        captureId: optionValue(argv, "--capture"),
        validationStatuses: parseList(optionValue(argv, "--status")) as ObservationRecord["validationStatus"][] | undefined,
        evidenceStatuses: parseList(optionValue(argv, "--evidence-status")) as ObservationRecord["evidenceStatus"][] | undefined
      };
      let observations = contextScope?.scope.mode === "strict"
        ? contextScope.scope.sourceAccess === "none"
          ? []
          : contextScope.observationIds
            .map((id) => runtime.db.getObservation(id))
            .filter((item): item is ObservationRecord => Boolean(item))
            .filter((item) => observationMatchesFilter(item, filter))
            .map((item) => observationForStrictScope(item, contextScope))
        : runtime.db.listObservations(filter);
      if (hasFlag(argv, "--json")) console.log(JSON.stringify(observations, null, 2));
      else for (const item of observations) console.log(`${item.id}\t[${item.validationStatus}/${item.evidenceStatus}] ${item.kind}: ${item.title} — ${observationCitation(item)}`);
      return;
    }
    if (subcommand === "show") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing observation id.");
      assertObservationIdInsideStrictScope(contextScope, id);
      assertStrictSourceAccess(contextScope, "metadata", "Reading an observation");
      const observation = requireObservationRecord(runtime.db.getObservation(id), id);
      const detail = observationDetailInsideScope(runtime.db, observation, contextScope);
      if (hasFlag(argv, "--json")) console.log(JSON.stringify(detail, null, 2));
      else {
        console.log(`${detail.observation.kind}: ${detail.observation.title}`);
        console.log(`Validation: ${detail.observation.validationStatus}; evidence: ${detail.observation.evidenceStatus}; confidence: ${detail.observation.confidence}`);
        if (strictSourceAccess(contextScope) === "snippets" || strictSourceAccess(contextScope) === "full") {
          console.log(`Statement: ${detail.observation.body}`);
          console.log(`Exact quote: “${detail.observation.excerpt}”`);
        }
        console.log(`Citation: ${observationCitation(detail.observation)}`);
      }
      return;
    }
    if (subcommand === "propose") {
      const captureId = optionValue(argv, "--capture");
      const sourceId = optionValue(argv, "--source");
      const packageId = optionValue(argv, "--package");
      if (optionValue(argv, "--product")) {
        throw new Error("--product is no longer supported for observations; use --entity kind:id.");
      }
      const subject = optionValue(argv, "--entity") ? parseEntityRef(optionValue(argv, "--entity")!) : undefined;
      assertStrictSourceAccess(contextScope, "snippets", "Proposing an observation from source evidence");
      if (packageId) {
        const packageRecord = runtime.db.getCurationPackage(packageId);
        if (!packageRecord) throw new Error(`Curation package not found: ${packageId}`);
        assertCurationPackageAnchorInsideStrictScope(contextScope, packageRecord);
      }
      if (captureId) assertCaptureInStrictScope(contextScope, captureId);
      if (subject) assertWritableEntityInStrictScope(contextScope, subject);
      if (sourceId && contextScope?.scope.mode === "strict" && !contextScope.sourceIds.includes(sourceId)) throw new Error(`Source is outside the active strict context scope: ${sourceId}`);
      assertNewObservationInsideStrictPolicy(contextScope, "proposed", "standalone");
      const kind = requireObservationKind(optionValue(argv, "--kind"));
      const observation = proposeObservation(runtime.db, {
        packageId,
        captureId,
        sourceId,
        sourceChunkId: optionValue(argv, "--chunk"),
        kind,
        title: optionValue(argv, "--title") ?? "",
        body: optionValue(argv, "--body") ?? "",
        excerpt: optionValue(argv, "--excerpt") ?? "",
        subject,
        confidence: optionValue(argv, "--confidence") ? Number(optionValue(argv, "--confidence")) : undefined,
        metadata: parseJsonOption(optionValue(argv, "--metadata"))
      }, observationMutationOptions(contextScope));
      const output = observationForStrictScope(observation, contextScope);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(output, null, 2) : `Observation proposed: ${output.id} — ${observationCitation(output)}`);
      return;
    }
    if (subcommand === "edit" || subcommand === "reclassify") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing observation id.");
      assertObservationIdInsideStrictScope(contextScope, id);
      assertStrictSourceAccess(contextScope, "snippets", "Editing an observation backed by source evidence");
      const current = requireObservationRecord(runtime.db.getObservation(id), id);
      const subjectOption = optionValue(argv, "--entity");
      const subject = subjectOption ? parseEntityRef(subjectOption) : undefined;
      if (subject) assertWritableEntityInStrictScope(contextScope, subject);
      if (current.validationStatus === "accepted" || current.validationStatus === "rejected" || current.validationStatus === "superseded") {
        assertNewObservationInsideStrictPolicy(contextScope, "proposed", "standalone");
      }
      const updated = editObservation(runtime.db, id, {
        title: optionValue(argv, "--title"),
        body: optionValue(argv, "--body"),
        kind: optionValue(argv, "--kind") ? requireObservationKind(optionValue(argv, "--kind")) : undefined,
        subject: hasFlag(argv, "--clear-entity") ? null : subject,
        confidence: optionValue(argv, "--confidence") ? Number(optionValue(argv, "--confidence")) : undefined,
        reason: optionValue(argv, "--reason") ?? ""
      }, observationMutationOptions(contextScope));
      const output = observationForStrictScope(updated, contextScope);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(output, null, 2) : `Observation ${subcommand === "reclassify" ? "reclassified" : "edited"}: ${output.id}`);
      return;
    }
    if (subcommand === "accept" || subcommand === "reject") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing observation id.");
      assertObservationIdInsideStrictScope(contextScope, id);
      assertStrictSourceAccess(contextScope, "snippets", "Reviewing an observation against its source evidence");
      const updated = reviewObservation(
        runtime.db,
        id,
        subcommand === "accept" ? "accepted" : "rejected",
        optionValue(argv, "--reason"),
        observationMutationOptions(contextScope)
      );
      const output = observationForStrictScope(updated, contextScope);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(output, null, 2) : `Observation ${output.validationStatus}: ${output.id}`);
      return;
    }
    if (subcommand === "merge") {
      const ids = positionalValues(argv).slice(1);
      assertStrictSourceAccess(contextScope, "snippets", "Merging observations backed by source evidence");
      const originals = ids.map((id) => {
        assertObservationIdInsideStrictScope(contextScope, id);
        return requireObservationRecord(runtime.db.getObservation(id), id);
      });
      assertNewObservationInsideStrictPolicy(
        contextScope,
        originals.length > 0 && originals.every((item) => item.validationStatus === "accepted") ? "accepted" : "proposed",
        "standalone"
      );
      const merged = mergeObservations(runtime.db, ids, {
        title: optionValue(argv, "--title"),
        body: optionValue(argv, "--body"),
        kind: optionValue(argv, "--kind") ? requireObservationKind(optionValue(argv, "--kind")) : undefined,
        reason: optionValue(argv, "--reason") ?? ""
      }, observationMutationOptions(contextScope));
      const output = observationForStrictScope(merged, contextScope);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(output, null, 2) : `Merged observation: ${output.id}`);
      return;
    }
    if (subcommand === "review-link") {
      const sourceObservationId = optionValue(argv, "--from") ?? "";
      const targetObservationId = optionValue(argv, "--to") ?? "";
      const type = optionValue(argv, "--type") as Parameters<typeof reviewObservationRelation>[1]["type"];
      const decision = optionValue(argv, "--decision");
      if (!sourceObservationId || !targetObservationId || !type || (decision !== "accepted" && decision !== "rejected")) throw new Error("Use --from, --to, --type and --decision accepted|rejected.");
      assertStrictSourceAccess(contextScope, "snippets", "Reviewing an observation evidence link");
      assertObservationIdInsideStrictScope(contextScope, sourceObservationId);
      assertObservationIdInsideStrictScope(contextScope, targetObservationId);
      const relation = reviewObservationRelation(
        runtime.db,
        { sourceObservationId, targetObservationId, type, decision, reason: optionValue(argv, "--reason") },
        observationMutationOptions(contextScope)
      );
      console.log(hasFlag(argv, "--json") ? JSON.stringify(relation, null, 2) : `Observation link ${relation.status}: ${relation.id}`);
      return;
    }
    if (subcommand === "measure") {
      const id = positionalValues(argv)[1];
      if (!id) throw new Error("Missing observation id.");
      assertObservationIdInsideStrictScope(contextScope, id);
      assertStrictSourceAccess(contextScope, "snippets", "Measuring an observation backed by source evidence");
      const updated = markObservationMeasured(runtime.db, id, optionValue(argv, "--reason") ?? "");
      const output = observationForStrictScope(updated, contextScope);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(output, null, 2) : `Observation measured: ${output.id}`);
      return;
    }
    throw new Error("Unknown observation command. Use list|show|propose|edit|reclassify|accept|reject|merge|review-link|measure.");
  } finally {
    runtime.close();
  }
}

function curationPackageInsideStrictScope(scope: ResolvedContextScope, detail: ReturnType<typeof getCurationPackageDetail>): boolean {
  if (scope.scope.mode !== "strict") return true;
  return scope.curationPackageIds.includes(detail.package.id);
}

function assertCurationPackageInsideStrictScope(scope: ResolvedContextScope | undefined, detail: ReturnType<typeof getCurationPackageDetail>): void {
  if (scope?.scope.mode === "strict" && !curationPackageInsideStrictScope(scope, detail)) throw new Error(`Curation package is outside the active strict context scope: ${detail.package.id}`);
}

function observationInsideStrictScope(scope: ResolvedContextScope, observation: ObservationRecord): boolean {
  if (scope.scope.mode !== "strict") return true;
  return scope.observationIds.includes(observation.id);
}

function assertObservationInsideStrictScope(scope: ResolvedContextScope | undefined, observation: ObservationRecord): void {
  if (scope?.scope.mode === "strict" && !observationInsideStrictScope(scope, observation)) throw new Error(`Observation is outside the active strict context scope: ${observation.id}`);
}

function assertCurationPackageIdInsideStrictScope(scope: ResolvedContextScope | undefined, packageId: string): void {
  if (scope?.scope.mode === "strict" && !scope.curationPackageIds.includes(packageId)) {
    throw new Error(`Curation package is outside the active strict context scope: ${packageId}`);
  }
}

function assertObservationIdInsideStrictScope(scope: ResolvedContextScope | undefined, observationId: string): void {
  if (scope?.scope.mode === "strict" && !scope.observationIds.includes(observationId)) {
    throw new Error(`Observation is outside the active strict context scope: ${observationId}`);
  }
}

function assertCurationPackageAnchorInsideStrictScope(
  scope: ResolvedContextScope | undefined,
  packageRecord: NonNullable<ReturnType<WorkMemoryDatabase["getCurationPackage"]>>
): void {
  if (scope?.scope.mode !== "strict") return;
  const productInside = !packageRecord.productId || scope.entities.some((ref) => ref.kind === "product" && ref.id === packageRecord.productId);
  if (
    !scope.sourceIds.includes(packageRecord.sourceId) ||
    (packageRecord.captureId && !scope.captureIds.includes(packageRecord.captureId)) ||
    !productInside
  ) {
    throw new Error(`Curation package is outside the active strict context scope: ${packageRecord.id}`);
  }
}

function observationMutationOptions(scope: ResolvedContextScope | undefined): { allowedObservationIds?: string[] } {
  return scope?.scope.mode === "strict" ? { allowedObservationIds: scope.observationIds } : {};
}

function strictSourceAccess(scope: ResolvedContextScope | undefined): "none" | "metadata" | "snippets" | "full" {
  return scope?.scope.mode === "strict" ? scope.scope.sourceAccess ?? "full" : "full";
}

function assertNewObservationInsideStrictPolicy(
  scope: ResolvedContextScope | undefined,
  validationStatus: ObservationRecord["validationStatus"],
  evidenceStatus: ObservationRecord["evidenceStatus"]
): void {
  if (scope?.scope.mode !== "strict") return;
  const validationStatuses = scope.scope.observationValidationStatuses
    ?? scope.scope.validationStatuses
    ?? ["captured", "proposed", "accepted"];
  if (!validationStatuses.includes(validationStatus)) {
    throw new Error(`A new ${validationStatus} observation is outside the active strict observation status policy.`);
  }
  if (scope.scope.observationEvidenceStatuses && !scope.scope.observationEvidenceStatuses.includes(evidenceStatus)) {
    throw new Error(`A new ${evidenceStatus} observation is outside the active strict evidence status policy.`);
  }
  if (scope.scope.observationMeasurement === "measured") {
    throw new Error("A new unmeasured observation is outside the active strict measurement policy.");
  }
  if (!valueInsideContextTimeRange(nowIso(), scope.scope.timeRange)) {
    throw new Error("A new observation would be outside the active strict time range.");
  }
}

function valueInsideContextTimeRange(value: string, range: AgentContextScope["timeRange"]): boolean {
  if (!range) return true;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const from = range.from ? Date.parse(range.from) : Number.NEGATIVE_INFINITY;
  const rawTo = range.to ? Date.parse(range.to) : Number.POSITIVE_INFINITY;
  const to = range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to) ? rawTo + 86_400_000 - 1 : rawTo;
  return timestamp >= (Number.isFinite(from) ? from : Number.NEGATIVE_INFINITY)
    && timestamp <= (Number.isFinite(to) ? to : Number.POSITIVE_INFINITY);
}

function observationMatchesFilter(
  observation: ObservationRecord,
  filter: {
    packageId?: string;
    sourceId?: string;
    captureId?: string;
    validationStatuses?: ObservationRecord["validationStatus"][];
    evidenceStatuses?: ObservationRecord["evidenceStatus"][];
  }
): boolean {
  return (!filter.packageId || observation.packageId === filter.packageId)
    && (!filter.sourceId || observation.sourceId === filter.sourceId)
    && (!filter.captureId || observation.captureId === filter.captureId)
    && (!filter.validationStatuses || filter.validationStatuses.includes(observation.validationStatus))
    && (!filter.evidenceStatuses || filter.evidenceStatuses.includes(observation.evidenceStatus));
}

function observationForStrictScope(observation: ObservationRecord, scope: ResolvedContextScope | undefined): ObservationRecord {
  if (scope?.scope.mode !== "strict") return observation;
  const access = strictSourceAccess(scope);
  if (access === "full") return observation;
  const exposesContent = access === "snippets";
  return {
    ...observation,
    title: exposesContent ? observation.title.slice(0, 500) : observation.title,
    body: exposesContent ? observation.body.slice(0, 2_000) : "",
    excerpt: exposesContent ? observation.excerpt.slice(0, 1_000) : "",
    reviewNote: exposesContent ? observation.reviewNote?.slice(0, 1_000) : undefined,
    metadata: exposesContent
      ? boundedContextObject(observation.metadata, 1_000)
      : {}
  };
}

function observationDetailInsideScope(
  db: WorkMemoryDatabase,
  observation: ObservationRecord,
  scope: ResolvedContextScope | undefined
) {
  if (scope?.scope.mode !== "strict") {
    return {
      observation,
      evidence: db.listObservationEvidence(observation.id),
      relations: db.listObservationRelations(observation.id),
      events: db.listObservationEvents(observation.id),
      source: db.getSource(observation.sourceId)
    };
  }
  const access = strictSourceAccess(scope);
  const allowedObservations = new Set(scope.observationIds);
  const evidence = access === "snippets" || access === "full"
    ? db.listObservationEvidence(observation.id)
      .filter((item) => scope.sourceIds.includes(item.sourceId) && (!item.captureId || scope.captureIds.includes(item.captureId)))
      .map((item) => access === "snippets" ? { ...item, excerpt: item.excerpt.slice(0, 1_000) } : item)
    : [];
  const relations = db.listObservationRelations(observation.id)
    .filter((item) => allowedObservations.has(item.sourceObservationId) && allowedObservations.has(item.targetObservationId))
    .map((item) => access === "full"
      ? item
      : { ...item, reason: access === "snippets" ? item.reason?.slice(0, 1_000) : undefined });
  const events = db.listObservationEvents(observation.id).map((item) => {
    if (access === "full") return item;
    if (access === "metadata") return { ...item, reason: undefined, before: undefined, after: undefined };
    return {
      ...item,
      reason: item.reason?.slice(0, 1_000),
      before: item.before ? boundedContextObject(item.before, 1_000) : undefined,
      after: item.after ? boundedContextObject(item.after, 1_000) : undefined
    };
  });
  return {
    observation: observationForStrictScope(observation, scope),
    evidence,
    relations,
    events,
    source: access === "none" ? undefined : sourceMetadataInsideStrictScope(db.getSource(observation.sourceId), access)
  };
}

function readCurationPackageDetailInsideScope(
  db: WorkMemoryDatabase,
  packageId: string,
  scope: ResolvedContextScope | undefined
): ReturnType<typeof getCurationPackageDetail> {
  if (scope?.scope.mode !== "strict") return getCurationPackageDetail(db, packageId);
  assertCurationPackageIdInsideStrictScope(scope, packageId);
  const packageRecord = db.getCurationPackage(packageId);
  if (!packageRecord) throw new Error(`Curation package not found: ${packageId}`);
  const scopedObservations = scope.observationIds
    .map((id) => db.getObservation(id))
    .filter((item): item is ObservationRecord => item !== undefined && item.packageId === packageId);
  const observations = strictSourceAccess(scope) === "none"
    ? []
    : scopedObservations.map((observation) => {
      const detail = observationDetailInsideScope(db, observation, scope);
      return {
        ...detail.observation,
        evidence: detail.evidence,
        relations: detail.relations,
        events: detail.events,
        staleSourceRevision: observation.metadata.staleSourceRevision === true
          || detail.evidence.some((item) => db.getSource(item.sourceId)?.status !== "indexed")
      };
    });
  const access = strictSourceAccess(scope);
  const wikiTargetInside = packageRecord.wikiTarget
    && scope.entities.some((ref) => ref.kind === packageRecord.wikiTarget?.subject.kind && ref.id === packageRecord.wikiTarget?.subject.id)
    && scope.entities.some((ref) => ref.kind === packageRecord.wikiTarget?.home.kind && ref.id === packageRecord.wikiTarget?.home.id);
  const sanitizedPackage = {
    ...packageRecord,
    summary: access === "full"
      ? packageRecord.summary
      : access === "snippets"
        ? packageRecord.summary?.slice(0, 2_000)
        : undefined,
    wikiEvidenceObservationIds: access === "none"
      ? []
      : packageRecord.wikiEvidenceObservationIds.filter((id) => scope.observationIds.includes(id)),
    wikiTarget: wikiTargetInside ? packageRecord.wikiTarget : undefined,
    wikiSynthesisKey: wikiTargetInside ? packageRecord.wikiSynthesisKey : undefined
  };
  const capture = packageRecord.captureId ? db.getCapture(packageRecord.captureId) : undefined;
  return {
    package: sanitizedPackage,
    source: access === "none" ? undefined : sourceMetadataInsideStrictScope(db.getSource(packageRecord.sourceId), access),
    capture: capture ? captureForStrictScope(capture, scope) as typeof capture : undefined,
    observations,
    counts: countScopedObservations(scopedObservations),
    wikiAssessment: assessWikiNeed(db, scopedObservations, { allowedObservationIds: scope.observationIds })
  };
}

function countScopedObservations(observations: ObservationRecord[]): Record<string, number> {
  const counts: Record<string, number> = { total: observations.length };
  for (const observation of observations) {
    counts[observation.validationStatus] = (counts[observation.validationStatus] ?? 0) + 1;
    counts[observation.evidenceStatus] = (counts[observation.evidenceStatus] ?? 0) + 1;
    if (observation.measurement) counts.measured = (counts.measured ?? 0) + 1;
  }
  return counts;
}

function sourceMetadataInsideStrictScope(
  source: Record<string, unknown> | undefined,
  access: "none" | "metadata" | "snippets" | "full"
): Record<string, unknown> | undefined {
  if (!source || access === "none") return undefined;
  if (access === "full") return source;
  const allowed = ["id", "logicalKey", "revision", "supersededBy", "title", "sourceType", "origin", "capturedAt", "sourceDate", "language", "status"];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function boundedContextObject(value: Record<string, unknown>, stringLimit: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).slice(0, 50).map(([key, item]) => [key, boundedContextValue(item, stringLimit)])
  );
}

function boundedContextValue(value: unknown, stringLimit: number): unknown {
  if (typeof value === "string") return value.slice(0, stringLimit);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => boundedContextValue(item, stringLimit));
  if (value && typeof value === "object") return boundedContextObject(value as Record<string, unknown>, stringLimit);
  return value;
}

function assertObservationEvidenceInsideStrictScope(
  db: WorkMemoryDatabase,
  scope: ResolvedContextScope | undefined,
  observation: ObservationRecord
): void {
  if (scope?.scope.mode !== "strict") return;
  for (const evidence of db.listObservationEvidence(observation.id)) {
    if (!scope.sourceIds.includes(evidence.sourceId)) {
      throw new Error(`Observation evidence is outside the active strict context scope: ${observation.id} -> ${evidence.sourceId}`);
    }
    if (evidence.captureId && !scope.captureIds.includes(evidence.captureId)) {
      throw new Error(`Observation evidence capture is outside the active strict context scope: ${observation.id} -> ${evidence.captureId}`);
    }
  }
}

function requireObservationRecord(value: ObservationRecord | undefined, id: string): ObservationRecord {
  if (!value) throw new Error(`Observation not found: ${id}`);
  return value;
}

function requireObservationKind(value: string | undefined): ObservationKind {
  const allowed: ObservationKind[] = ["claim", "decision", "question", "task", "risk", "feature_request", "insight", "metric", "relationship"];
  if (!value || !allowed.includes(value as ObservationKind)) throw new Error(`Invalid observation kind. Use: ${allowed.join(", ")}.`);
  return value as ObservationKind;
}

function observationCitation(observation: ObservationRecord): string {
  return `${observation.id} -> ${observation.sourceId}${observation.sourceChunkId ? `#${observation.sourceChunkId}` : ""}`;
}

function printCurationPackages(packages: ReturnType<typeof listCurationPackageDetails>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(packages, null, 2));
    return;
  }
  if (packages.length === 0) {
    console.log("No curation packages.");
    return;
  }
  for (const detail of packages) {
    console.log(`${detail.package.id}\t[${detail.package.status}] ${detail.package.title} — ${detail.counts.total ?? 0} observation(s), wiki ${detail.package.wikiDecision}`);
  }
}

function printCurationPackageDetail(detail: ReturnType<typeof getCurationPackageDetail>): void {
  console.log(`${detail.package.title} [${detail.package.status}]`);
  console.log(`Package: ${detail.package.id}; source: ${detail.package.sourceId}${detail.package.captureId ? `; capture: ${detail.package.captureId}` : ""}`);
  console.log(`Wiki: ${detail.package.wikiDecision}${detail.package.wikiReason ? ` (${detail.package.wikiReason})` : ""}`);
  if (detail.package.wikiTarget) {
    const target = detail.package.wikiTarget;
    console.log(`Wiki target: ${target.subject.kind}:${target.subject.id} -> ${target.home.kind}:${target.home.id}/${target.page}`);
    console.log(`Wiki synthesis: ${detail.package.wikiSynthesisKey ?? "unkeyed"}; evidence: ${detail.package.wikiEvidenceObservationIds.length}`);
  }
  for (const item of detail.observations) {
    console.log(`- ${item.id} [${item.validationStatus}/${item.evidenceStatus}] ${item.kind}: ${item.title}`);
    console.log(`  “${item.excerpt}” — ${observationCitation(item)}`);
  }
}

async function captureCreateCommand(argv: string[]): Promise<void> {
  const contentType = assertContentType(optionValue(argv, "--content-type") ?? "raw_input");
  const title = optionValue(argv, "--title");
  if (!title) {
    throw new Error("Missing --title.");
  }

  const sourceKind = optionValue(argv, "--source-kind") ?? "manual";
  if (!isCaptureSourceKind(sourceKind)) {
    throw new Error(`Unknown --source-kind: ${sourceKind}.`);
  }
  const sourceOrigin = optionValue(argv, "--source-origin") ?? "cli";
  if (!isCaptureSourceOrigin(sourceOrigin)) {
    throw new Error(`Unknown --source-origin: ${sourceOrigin}.`);
  }

  let body = optionValue(argv, "--body") ?? "";
  if (hasFlag(argv, "--stdin")) {
    body = await readStdin();
  }

  // Runtime first: loadConfig registers workspace-defined kinds before refs are validated.
  const runtime = createCliRuntime(argv);
  const primary = optionValue(argv, "--primary");
  const primaryRef = primary ? parseEntityRef(primary) : undefined;
  const relatedRefs = collectOptionValues(argv, "--related").map(parseCaptureRelated);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    assertStrictSourceAccess(contextScope, "full", "Creating a capture");
    if (contextScope?.scope.mode === "strict" && !hasFlag(argv, "--allow-boundary-change")) {
      if (!primaryRef) {
        throw new Error("A capture created under a strict context must have an in-scope primary entity.");
      }
      assertWritableEntityInStrictScope(contextScope, primaryRef);
      for (const related of relatedRefs) {
        assertWritableEntityInStrictScope(contextScope, { kind: related.entityKind, id: related.entityId });
        assertRelationInStrictScope(contextScope, related.relationType);
      }
    }
    // Markdown source-of-truth: every capture is written to a file before any ingestion.
    const memoryRoot = path.resolve(runtime.config.workspaceRoot, runtime.config.workspace.memoryRoot);
    const captureDir = path.join(memoryRoot, "captures");
    fs.mkdirSync(captureDir, { recursive: true });
    const id = createId("cap");
    const capturePath = path.join(captureDir, `${id}.md`);

    const tagsOption = optionValue(argv, "--tags");
    let captureFileWritten = false;
    let capture: CaptureRecord;
    try {
      capture = runtime.db.runInImmediateTransaction(() => {
        const created = runtime.db.createCapture({
          id,
          path: capturePath,
          title,
          contentType,
          primaryEntityKind: primaryRef?.kind,
          primaryEntityId: primaryRef?.id,
          relatedEntities: relatedRefs,
          sourceKind,
          sourceOrigin,
          tags: tagsOption ? tagsOption.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
          contentHash: `sha256:${sha256(body)}`
        });

        const markdown = serializeCaptureFile(
          runtime.db.getCapture(id) ?? created,
          body,
          (kind, entityId) => runtime.db.getEntity(kind, entityId)?.label
        );
        // If the source-of-truth cannot be created, the surrounding transaction
        // removes the capture row and its entity links instead of leaving a ghost.
        atomicWriteFile(capturePath, markdown);
        captureFileWritten = true;
        return created;
      });
    } catch (error) {
      // A rare SQLite COMMIT failure can happen after the atomic rename. Remove
      // the brand-new file as compensation so disk never gets ahead of the DB.
      if (captureFileWritten) {
        try { fs.unlinkSync(capturePath); } catch { /* preserve the transaction error */ }
      }
      throw error;
    }

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(captureForStrictScope(capture, contextScope), null, 2));
      return;
    }
    printCapture(captureForStrictScope(capture, contextScope));
  } finally {
    runtime.close();
  }
}

async function captureUpdateCommand(argv: string[]): Promise<void> {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  if (hasFlag(argv, "--stdin") && optionValue(argv, "--body") !== undefined) {
    throw new Error("Use either --body or --stdin, not both.");
  }
  const contentTypeValue = optionValue(argv, "--content-type");
  const contentType = contentTypeValue === undefined ? undefined : assertContentType(contentTypeValue);
  const primaryValue = optionValue(argv, "--primary");
  const tagsProvided = argv.includes("--tags");
  const tags = tagsProvided ? parseList(optionValue(argv, "--tags")) ?? [] : undefined;
  const content = hasFlag(argv, "--stdin")
    ? await readStdin()
    : optionValue(argv, "--body");
  const title = optionValue(argv, "--title");
  const expectedUpdatedAt = optionValue(argv, "--expected-updated-at");
  if (
    title === undefined
    && contentType === undefined
    && primaryValue === undefined
    && tags === undefined
    && content === undefined
  ) {
    throw new Error("Nothing to update. Provide --title, --content-type, --primary, --tags, --body or --stdin.");
  }

  const runtime = createCliRuntime(argv);
  try {
    // Loading the runtime registers workspace-defined entity kinds before refs
    // are parsed, matching capture create/classify behavior.
    const primaryEntity = primaryValue ? parseEntityRef(primaryValue) : undefined;
    const current = runtime.db.getCapture(captureId);
    if (!current) {
      throw new Error(`Capture not found: ${captureId}`);
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    assertStrictSourceAccess(contextScope, "full", "Editing a capture");
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertCaptureMutationInsideStrictScope(runtime, contextScope, current);
      assertCaptureSourceFamilyInsideStrictScope(runtime, contextScope, current, "Editing a capture");
      if (primaryEntity) {
        assertWritableEntityInStrictScope(contextScope, primaryEntity);
      }
    }
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      throw new Error(
        `Capture ${captureId} changed after it was opened `
        + `(expected updatedAt ${expectedUpdatedAt}, current ${current.updatedAt}). Reload it before saving.`
      );
    }

    const result = await editCapture(runtime, captureId, {
      title,
      contentType,
      primaryEntity,
      tags,
      content
    });
    const capture = captureForStrictScope(result.capture, contextScope);
    const reingest = result.reingest;
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ ...capture, content: result.content, reingest }, null, 2));
      return;
    }
    printCapture(capture);
    console.log(`Reindexed: ${reingest.status} (${reingest.chunks} chunks)`);
    if (reingest.error) {
      console.log(`Indexing error: ${reingest.error}`);
    }
  } finally {
    runtime.close();
  }
}

function captureLifecycleCommand(
  argv: string[],
  action: "archive" | "resolve" | "restore"
): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const current = assertCaptureMutationInsideStrictScope(runtime, contextScope, captureId);
    const actionLabel = action === "archive" ? "Archiving" : action === "resolve" ? "Resolving" : "Restoring";
    assertStrictSourceAccess(contextScope, "full", `${actionLabel} a capture`);
    assertCaptureSourceFamilyInsideStrictScope(
      runtime,
      contextScope,
      current,
      `${actionLabel} a capture`
    );
    if (!current.path) {
      throw new Error(`Capture ${captureId} has no Markdown file to ${action}.`);
    }
    if (!fs.existsSync(current.path)) {
      throw new Error(`Capture file is missing: ${current.path}`);
    }
    if (action === "restore" && current.status === "superseded") {
      throw new Error(`Capture ${captureId} is superseded history and cannot be restored.`);
    }
    if (action === "resolve" && current.contentType !== "question") {
      throw new Error(`Only a question capture can be resolved; ${captureId} is ${current.contentType}.`);
    }

    // Keep the database and Markdown source-of-truth consistent. A failed
    // atomic rewrite rolls the metadata transition (including updatedAt) back.
    const originalMarkdown = fs.readFileSync(current.path, "utf8");
    let markdownWritten = false;
    let updated: CaptureRecord;
    try {
      updated = runtime.db.runInImmediateTransaction(() => {
        let candidate = current;
        if (action === "resolve") {
          candidate = runtime.db.updateCapture(captureId, {
            tags: [...new Set([...(current.tags ?? []), "resolved"])]
          });
        } else if (action === "restore" && current.tags?.includes("resolved")) {
          candidate = runtime.db.updateCapture(captureId, {
            tags: current.tags.filter((tag) => tag !== "resolved")
          });
        }
        candidate = runtime.db.setCaptureStatus(
          captureId,
          action === "restore" ? "captured" : "archived"
        );
        rewriteCaptureFile(runtime, candidate);
        markdownWritten = true;
        return candidate;
      });
    } catch (error) {
      // If COMMIT fails after the rename, put the exact prior bytes back. On a
      // write failure the flag stays false and the DB transaction alone rolls back.
      if (markdownWritten) {
        try { atomicWriteFile(current.path, originalMarkdown); } catch { /* preserve the transition error */ }
      }
      throw error;
    }
    const capture = captureForStrictScope(updated, contextScope);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(capture, null, 2));
      return;
    }
    printCapture(capture);
  } finally {
    runtime.close();
  }
}

async function captureReingestCommand(argv: string[]): Promise<void> {
  const captureId = positionalValues(argv)[1];
  const force = hasFlag(argv, "--force");
  const runtime = createCliRuntime(argv);
  try {
    const ids = resolveReingestTargets(runtime, argv, captureId);
    const contextScope = activeResolvedContextScope(runtime, argv);
    for (const id of ids) {
      const capture = assertCaptureMutationInsideStrictScope(runtime, contextScope, id);
      assertCaptureSourceFamilyInsideStrictScope(runtime, contextScope, capture, "Capture reingestion");
    }

    if (ids.length === 1 && captureId) {
      const result = await reingestCapture(runtime, ids[0], { force });
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Reingested capture: ${result.captureId}`);
      console.log(`Status: ${result.status}`);
      if (result.sourceId) {
        console.log(`Source: ${result.sourceId}`);
      }
      console.log(`Entities: ${result.entityRefs.map((ref) => `${ref.kind}:${ref.id}`).join(", ") || "none"}`);
      console.log(`Chunks: ${result.chunks}`);
      if (result.error) {
        console.log(`Error: ${result.error}`);
      }
      return;
    }

    const results = [];
    for (const id of ids) {
      results.push(await reingestCapture(runtime, id, { force }));
    }
    const summary = {
      total: results.length,
      indexed: results.filter((result) => result.status === "indexed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length
    };
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ summary, results }, null, 2));
      return;
    }
    console.log(`Reingested ${summary.total} capture(s): ${summary.indexed} indexed, ${summary.skipped} skipped, ${summary.failed} failed.`);
    for (const result of results.filter((entry) => entry.status === "failed")) {
      console.log(`- failed: ${result.captureId}${result.error ? ` (${result.error})` : ""}`);
    }
  } finally {
    runtime.close();
  }
}

function resolveReingestTargets(runtime: ReturnType<typeof createCliRuntime>, argv: string[], captureId?: string): string[] {
  if (captureId) {
    return [captureId];
  }
  const entity = optionValue(argv, "--entity");
  const all = hasFlag(argv, "--all");
  const failed = hasFlag(argv, "--failed");
  if (!entity && !all && !failed) {
    throw new Error("Specify a capture id, or one of --all, --failed, --entity <kind:id>.");
  }
  const filter: { primaryEntityKind?: string; primaryEntityId?: string } = {};
  if (entity) {
    const ref = parseEntityRef(entity);
    filter.primaryEntityKind = ref.kind;
    filter.primaryEntityId = ref.id;
  }
  let captures = runtime.db.listCaptures(filter);
  if (failed) {
    captures = captures.filter((capture) => capture.ingestionStatus === "failed");
  }
  return captures.map((capture) => capture.id);
}

function captureShowCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const runtime = createCliRuntime(argv);
  try {
    const capture = runtime.db.getCapture(captureId);
    if (!capture) {
      throw new Error(`Capture not found: ${captureId}`);
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    assertCaptureMutationInsideStrictScope(runtime, contextScope, capture);
    assertStrictSourceAccess(contextScope, "full", "Showing capture content");
    const scopedCapture = captureForStrictScope(capture, contextScope);
    const content = capture.path && fs.existsSync(capture.path)
      ? parseCaptureFile(fs.readFileSync(capture.path, "utf8")).body
      : undefined;
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ ...scopedCapture, content }, null, 2));
      return;
    }
    printCapture(capture);
    if (capture.path && fs.existsSync(capture.path)) {
      console.log("");
      console.log(fs.readFileSync(capture.path, "utf8"));
    }
  } finally {
    runtime.close();
  }
}

function captureOpenCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const runtime = createCliRuntime(argv);
  try {
    const capture = runtime.db.getCapture(captureId);
    if (!capture) {
      throw new Error(`Capture not found: ${captureId}`);
    }
    if (!capture.path) {
      throw new Error(`Capture ${captureId} has no file.`);
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    assertCaptureMutationInsideStrictScope(runtime, contextScope, capture);
    assertStrictSourceAccess(contextScope, "full", "Opening a capture file");
    console.log(capture.path);
  } finally {
    runtime.close();
  }
}

function captureReviewCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const status = optionValue(argv, "--status") ?? "reviewed";
  if (!["captured", "reviewed", "archived", "superseded"].includes(status)) {
    throw new Error("Invalid --status. Use captured, reviewed, archived or superseded.");
  }
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    assertCaptureMutationInsideStrictScope(runtime, contextScope, captureId);
    const capture = runtime.db.setCaptureStatus(captureId, status as never);
    rewriteCaptureFile(runtime, capture);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(captureForStrictScope(capture, contextScope), null, 2));
      return;
    }
    printCapture(captureForStrictScope(capture, contextScope));
  } finally {
    runtime.close();
  }
}

/**
 * Permanently remove a bad capture: DB rows (capture, entity links, source +
 * chunks + FTS + mentions, pending inbox items) and the Markdown
 * capture file. Entity relations stay — they may be evidenced elsewhere; the
 * count still referencing this capture in their metadata is reported.
 */
function captureDeleteCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id. Use: pnpm wm capture delete <capture-id> [--json]");
  }
  const runtime = createCliRuntime(argv);
  try {
    const capture = runtime.db.getCapture(captureId);
    if (!capture) {
      throw new Error(`Capture not found: ${captureId}`);
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    assertCaptureMutationInsideStrictScope(runtime, contextScope, capture);
    assertStrictSourceAccess(contextScope, "full", "Deleting a capture");
    assertCaptureSourceFamilyInsideStrictScope(runtime, contextScope, capture, "Deleting a capture");
    if (contextScope?.scope.mode === "strict") {
      const pendingInbox = runtime.db.db
        .prepare("SELECT id FROM memory_inbox WHERE status = 'pending' AND payload_json LIKE ?")
        .all(`%${captureId}%`) as Array<{ id: string }>;
      const outsideInbox = pendingInbox.find((item) => !contextScope.inboxItemIds.includes(item.id));
      if (outsideInbox) {
        throw new Error(`Deleting a capture would remove an Inbox item outside the active strict context scope: ${outsideInbox.id}`);
      }
    }
    const removal = runtime.db.deleteCapture(captureId);
    let fileRemoved = false;
    if (capture.path && fs.existsSync(capture.path)) {
      fs.rmSync(capture.path);
      fileRemoved = true;
    }
    const provenanceRelations = runtime.db.db
      .prepare("SELECT COUNT(*) AS count FROM entity_relations WHERE metadata_json LIKE ?")
      .get(`%${captureId}%`) as { count: number };
    const summary = {
      id: captureId,
      title: capture.title,
      sourceId: removal.sourceId ?? null,
      fileRemoved,
      inboxCleared: removal.inboxCleared,
      relationsKeepingProvenance: provenanceRelations.count
    };
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log(`Deleted capture ${captureId} ("${capture.title}") — source ${removal.sourceId ?? "none"}, ${removal.inboxCleared} pending inbox item(s) cleared, file ${fileRemoved ? "removed" : "absent"}.`);
    if (provenanceRelations.count > 0) {
      console.log(`${provenanceRelations.count} relation(s) still cite this capture as provenance; review them with the graph if needed.`);
    }
  } finally {
    runtime.close();
  }
}

function captureClassifyCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const primary = optionValue(argv, "--primary");
  if (!primary) {
    throw new Error("Missing --primary kind:id.");
  }
  const runtime = createCliRuntime(argv);
  const ref = parseEntityRef(primary);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertCaptureMutationInsideStrictScope(runtime, contextScope, captureId);
      assertWritableEntityInStrictScope(contextScope, ref);
    }
    const capture = runtime.db.classifyCapture(captureId, ref.kind, ref.id);
    rewriteCaptureFile(runtime, capture);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(captureForStrictScope(capture, contextScope), null, 2));
      return;
    }
    printCapture(captureForStrictScope(capture, contextScope));
  } finally {
    runtime.close();
  }
}

function captureRelateCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const entity = optionValue(argv, "--entity");
  const relation = optionValue(argv, "--relation");
  if (!entity || !relation) {
    throw new Error("Missing --entity kind:id or --relation.");
  }
  const runtime = createCliRuntime(argv);
  const ref = parseEntityRef(entity);
  const relationType = assertRelationType(relation);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertCaptureMutationInsideStrictScope(runtime, contextScope, captureId);
      assertWritableEntityInStrictScope(contextScope, ref);
      assertRelationInStrictScope(contextScope, relationType);
    }
    const capture = runtime.db.relateCapture(captureId, {
      entityKind: ref.kind,
      entityId: ref.id,
      relationType
    });
    rewriteCaptureFile(runtime, capture);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(captureForStrictScope(capture, contextScope), null, 2));
      return;
    }
    printCapture(captureForStrictScope(capture, contextScope));
  } finally {
    runtime.close();
  }
}

function captureUnrelateCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const entity = optionValue(argv, "--entity");
  if (!entity) {
    throw new Error("Missing --entity kind:id.");
  }
  const runtime = createCliRuntime(argv);
  const ref = parseEntityRef(entity);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      const before = assertCaptureMutationInsideStrictScope(runtime, contextScope, captureId);
      assertWritableEntityInStrictScope(contextScope, ref);
      for (const related of before.relatedEntities) {
        if (related.entityKind === ref.kind && related.entityId === ref.id) {
          assertRelationInStrictScope(contextScope, related.relationType);
        }
      }
    }
    const capture = runtime.db.unrelateCapture(captureId, ref.kind, ref.id);
    rewriteCaptureFile(runtime, capture);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(captureForStrictScope(capture, contextScope), null, 2));
      return;
    }
    printCapture(captureForStrictScope(capture, contextScope));
  } finally {
    runtime.close();
  }
}

function captureReclassifyCommand(argv: string[]): void {
  const from = optionValue(argv, "--from");
  const to = optionValue(argv, "--to");
  if (!from || !to) {
    throw new Error("Missing --from or --to kind:id.");
  }
  const runtime = createCliRuntime(argv);
  const fromRef = parseEntityRef(from);
  const toRef = parseEntityRef(to);
  try {
    const captures = runtime.db.listCaptures({ primaryEntityKind: fromRef.kind, primaryEntityId: fromRef.id });
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertWritableEntityInStrictScope(contextScope, fromRef);
      assertWritableEntityInStrictScope(contextScope, toRef);
      for (const capture of captures) {
        assertCaptureMutationInsideStrictScope(runtime, contextScope, capture);
      }
    }
    let count = 0;
    for (const capture of captures) {
      const updated = runtime.db.classifyCapture(capture.id, toRef.kind, toRef.id);
      rewriteCaptureFile(runtime, updated);
      count += 1;
    }
    console.log(`Reclassified ${count} capture(s) from ${fromRef.kind}:${fromRef.id} to ${toRef.kind}:${toRef.id}.`);
  } finally {
    runtime.close();
  }
}

function captureListCommand(argv: string[]): void {
  const includeContent = hasFlag(argv, "--include-content");
  const idsValue = optionValue(argv, "--ids");
  const requestedIds = idsValue === undefined
    ? undefined
    : [...new Set(parseList(idsValue) ?? [])];
  if (includeContent && requestedIds === undefined) {
    throw new Error("--include-content requires --ids so capture body reads stay bounded.");
  }
  if (requestedIds && requestedIds.length > 100) {
    throw new Error(`--ids accepts at most 100 capture ids; received ${requestedIds.length}.`);
  }
  const contentTypeOption = optionValue(argv, "--content-type");
  if (contentTypeOption !== undefined) {
    assertContentType(contentTypeOption);
  }
  const curationStatusOption = optionValue(argv, "--curation-status");
  if (curationStatusOption !== undefined) {
    assertCurationStatus(curationStatusOption);
  }
  const statusOption = optionValue(argv, "--status");
  if (statusOption !== undefined && !isCaptureStatus(statusOption)) {
    throw new Error("Invalid --status. Use captured, reviewed, archived or superseded.");
  }
  const runtime = createCliRuntime(argv);
  const primary = optionValue(argv, "--primary");
  const entity = optionValue(argv, "--entity");
  try {
    if (primary && entity) {
      throw new Error("Use either --primary or --entity, not both.");
    }
    const primaryRef = primary ? parseEntityRef(primary) : undefined;
    const entityRef = entity ? parseEntityRef(entity) : undefined;
    const ingestionStatus = optionValue(argv, "--ingestion-status");
    let captures = requestedIds
      ? requestedIds
          .map((captureId) => runtime.db.getCapture(captureId))
          .filter((capture): capture is CaptureRecord => Boolean(capture))
      : entityRef
      ? runtime.db.listCapturesForEntity(entityRef.kind, entityRef.id).filter((capture) =>
          (!contentTypeOption || capture.contentType === contentTypeOption)
          && (!statusOption || capture.status === statusOption)
          && (!ingestionStatus || capture.ingestionStatus === ingestionStatus)
          && (!curationStatusOption || capture.curationStatus === curationStatusOption)
        )
      : runtime.db.listCaptures({
          primaryEntityKind: primaryRef?.kind,
          primaryEntityId: primaryRef?.id,
          contentType: contentTypeOption,
          status: statusOption,
          ingestionStatus,
          curationStatus: curationStatusOption
        });
    if (requestedIds) {
      captures = captures.filter((capture) =>
        (!primaryRef
          || (
            capture.primaryEntityKind === primaryRef.kind
            && capture.primaryEntityId === primaryRef.id
          ))
        && (!entityRef
          || (
            (
              capture.primaryEntityKind === entityRef.kind
              && capture.primaryEntityId === entityRef.id
            )
            || capture.relatedEntities.some((ref) =>
              ref.entityKind === entityRef.kind && ref.entityId === entityRef.id
            )
          ))
        && (!contentTypeOption || capture.contentType === contentTypeOption)
        && (!statusOption || capture.status === statusOption)
        && (!ingestionStatus || capture.ingestionStatus === ingestionStatus)
        && (!curationStatusOption || capture.curationStatus === curationStatusOption)
      );
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (includeContent) {
      assertStrictSourceAccess(contextScope, "full", "Listing capture content");
    }
    if (contextScope?.scope.mode === "strict") {
      const allowed = new Set(contextScope.captureIds);
      captures = captures.filter((capture) => allowed.has(capture.id));
      if (contextScope.scope.sourceAccess === "none") captures = [];
    }
    const scopedCaptures = captures.map((capture) => {
      const scoped = captureForStrictScope(capture, contextScope);
      if (!includeContent) {
        return scoped;
      }
      const content = capture.path && fs.existsSync(capture.path)
        ? parseCaptureFile(fs.readFileSync(capture.path, "utf8")).body
        : undefined;
      return { ...scoped, content };
    });
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(scopedCaptures, null, 2));
      return;
    }
    if (scopedCaptures.length === 0) {
      console.log("No captures.");
      return;
    }
    for (const capture of scopedCaptures) {
      const primary = capture.primaryEntityKind && capture.primaryEntityId
        ? `${capture.primaryEntityKind}:${capture.primaryEntityId}`
        : "redacted";
      console.log(
        `${capture.id}\t[${capture.contentType}] ${capture.title} -> ${primary} (${capture.ingestionStatus}, curation ${capture.curationStatus})`
      );
      if (includeContent) {
        console.log("");
        console.log((capture as typeof capture & { content?: string }).content ?? "");
      }
    }
  } finally {
    runtime.close();
  }
}

function captureCurateCommand(argv: string[]): void {
  const captureId = positionalValues(argv)[1];
  if (!captureId) {
    throw new Error("Missing capture id.");
  }
  const status = assertCurationStatus(optionValue(argv, "--status") ?? "curated");
  const summary = optionValue(argv, "--summary");
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const currentCapture = assertCaptureMutationInsideStrictScope(runtime, contextScope, captureId);
    const observationPackage = currentCapture.sourceId
      ? runtime.db.listCurationPackages({ captureId, sourceId: currentCapture.sourceId }).find((candidate) => candidate.status !== "superseded")
      : undefined;
    const observationCount = observationPackage ? runtime.db.listObservations({ packageId: observationPackage.id }).length : 0;
    const observationFirstCuration = Boolean(observationPackage && observationCount > 0);
    // Marking a capture curated always runs the invariant check with auto-repair, so no
    // curation pass can leave isolated (invisible) entities behind, whichever entry point
    // drove it (cockpit loop, Copilot chat, CLI).
    // P2 observation-first curation intentionally performs no graph mutation before
    // review, so graph invariants are irrelevant until accepted knowledge is materialized.
    const check = status === "curated" && !observationFirstCuration && !hasFlag(argv, "--no-check")
      ? checkCaptureCuration(runtime, captureId, { repair: contextScope?.scope.mode !== "strict" })
      : undefined;
    const effectiveStatus = status === "curated" && check && !check.ok ? "failed" : status;
    const capture = runtime.db.updateCaptureCuration(captureId, {
      curationStatus: effectiveStatus,
      curationSummary: summary ?? null
    });
    rewriteCaptureFile(runtime, capture);
    if (observationPackage) {
      runtime.db.updateCurationPackage(observationPackage.id, { summary: summary ?? observationPackage.summary });
    }
    // Every autonomous interpretation remains reviewable, including a pass blocked by
    // unresolved invariants. Wiki writes themselves are separate pending proposals.
    if (status === "curated" && !observationFirstCuration && !hasFlag(argv, "--no-review")) {
      runtime.db.insertInboxItem({
        type: "wiki_proposal",
        title: `${effectiveStatus === "curated" ? "Curation review" : "Curation blocked"}: ${capture.title}`,
        body: [
          summary ? `Summary: ${summary}` : undefined,
          ...(check?.repairs ?? []).map((repair) => `Repair: ${repair}`),
          ...(check?.violations ?? []).map((violation) => `Violation [${violation.rule}]: ${violation.message}`)
        ].filter(Boolean).join("\n") || "Capture curated.",
        status: "pending",
        sourceId: capture.sourceId,
        productId: capture.primaryEntityKind === "product" ? capture.primaryEntityId : undefined,
        payload: {
          captureId: capture.id,
          primaryEntity: `${capture.primaryEntityKind}:${capture.primaryEntityId}`,
          proposalKind: "curation_review",
          captureTitle: capture.title,
          repairs: check?.repairs ?? [],
          violations: check?.violations ?? []
        }
      });
    }
    appendCurationLog(runtime, {
      captureId,
      status: effectiveStatus,
      summary,
      repairs: check?.repairs,
      violations: check?.violations.map((violation) => violation.rule)
    });
    if (hasFlag(argv, "--json")) {
      const scopedCapture = captureForStrictScope(capture, contextScope);
      console.log(JSON.stringify(check ? { ...scopedCapture, curationCheck: check } : scopedCapture, null, 2));
      return;
    }
    printCapture(captureForStrictScope(capture, contextScope));
    if (check) {
      printCurationCheck(check);
    }
  } finally {
    runtime.close();
  }
}

/** One JSONL line per curation transition, mirroring the ingest-log, for operational debugging. */
function appendCurationLog(runtime: ReturnType<typeof createCliRuntime>, entry: Record<string, unknown>): void {
  try {
    const memoryRoot = path.resolve(runtime.config.workspaceRoot, runtime.config.workspace.memoryRoot);
    const logDir = path.join(memoryRoot, "curation-log");
    fs.mkdirSync(logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `${day}.jsonl`), JSON.stringify({ at: nowIso(), ...entry }) + "\n", "utf8");
  } catch {
    // Logging must never break curation.
  }
}

function printCurationCheck(check: ReturnType<typeof checkCaptureCuration>): void {
  for (const repair of check.repairs) {
    console.log(`Repair: ${repair}`);
  }
  for (const violation of check.violations) {
    console.log(`Violation [${violation.rule}]: ${violation.message}`);
  }
  if (check.ok && check.repairs.length === 0) {
    console.log("Curation check: ok");
  }
}

async function wikiCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv);
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (subcommand === "repo-pages") {
      const access = strictSourceAccessForOutput(contextScope);
      if (contextScope?.scope.mode === "strict" && access === "none") {
        console.log(hasFlag(argv, "--json") ? "[]" : "No repository wiki pages: sourceAccess=none is active.");
        return;
      }
      const metadataOnly = new Set(contextScope?.metadataOnlyEntityRefs ?? []);
      const explicitEntityRefs = parseScopeEntityRefs(optionValue(argv, "--entities") ?? optionValue(argv, "--entity"));
      const writableContextEntities = contextScope?.entities
        .filter((ref) => !metadataOnly.has(`${ref.kind}:${ref.id}`));
      const entityRefs = explicitEntityRefs.length > 0
        ? explicitEntityRefs
        : contextScope?.scope.mode === "strict"
          ? writableContextEntities
          : undefined;
      if (contextScope?.scope.mode === "strict") {
        const allowed = new Set((writableContextEntities ?? []).map((ref) => `${ref.kind}:${ref.id}`));
        for (const ref of explicitEntityRefs) {
          if (!allowed.has(`${ref.kind}:${ref.id}`)) {
            throw new Error(`Repository wiki scan entity is outside the active strict context scope: ${ref.kind}:${ref.id}`);
          }
        }
      }
      const repositoryIds = contextScope?.scope.mode === "strict"
        ? contextScope.entities
          .filter((ref) => ref.kind === "repository" && !metadataOnly.has(`${ref.kind}:${ref.id}`))
          .map((ref) => ref.id)
        : undefined;
      const pages = listRepositoryWikiPages(runtime.config, runtime.db, { entityRefs, repositoryIds });
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(pages, null, 2));
        return;
      }
      for (const page of pages) {
        console.log(`${page.entityRefs.map((ref) => `${ref.kind}:${ref.id}`).join(",")}\t${page.repositoryId}\t${page.relativePath}`);
      }
      return;
    }
    if (subcommand === "migrate-layout") {
      const planned = planWikiLayoutMigration(runtime.config, runtime.db);
      const report = hasFlag(argv, "--apply")
        ? applyWikiLayoutMigration(runtime.config, runtime.db, planned)
        : planned;
      if (!report.dryRun) ensureWikiScaffold(runtime.config);
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(report.dryRun ? "Wiki layout migration preview:" : "Wiki layout migration applied:");
      if (report.backupPath) console.log(`Backup: ${report.backupPath}`);
      for (const entry of report.entries) {
        console.log(`- ${entry.status}: ${entry.source}${entry.target ? ` -> ${entry.target}` : ""} (${entry.reason})`);
        for (const conflict of entry.conflicts ?? []) console.log(`  conflict: ${conflict}`);
      }
      console.log(`Ready: ${report.summary.ready}; migrated: ${report.summary.migrated}; review: ${report.summary.review}; conflicts: ${report.summary.conflict}`);
      return;
    }
    if (subcommand === "resolve-path") {
      const subjectValue = optionValue(argv, "--entity");
      if (!subjectValue) throw new Error("Missing --entity <kind:id>.");
      const subject = parseEntityRef(subjectValue);
      assertEntityInStrictScope(contextScope, subject);
      const homeValue = optionValue(argv, "--home");
      const resolution = homeValue
        ? { home: parseEntityRef(homeValue), status: "resolved" as const, reason: "Explicit home." }
        : resolveWikiHome(runtime.config, runtime.db, subject);
      if (!resolution.home || resolution.status !== "resolved") {
        throw new Error(`Cannot resolve wiki home for ${subjectValue}: ${resolution.reason}`);
      }
      assertEntityInStrictScope(contextScope, resolution.home);
      const page = optionValue(argv, "--page") ?? "index.md";
      const relativePath = validateWikiPlacement(runtime.config, runtime.db, subject, resolution.home, page);
      const result = { subject, home: resolution.home, page, relativePath };
      console.log(hasFlag(argv, "--json") ? JSON.stringify(result, null, 2) : relativePath);
      return;
    }

    ensureWikiScaffold(runtime.config);

    if (subcommand === "path") {
      console.log(globalWikiRoot(runtime.config));
      return;
    }
    if (subcommand === "lint") {
      const report = lintWiki(runtime.config, runtime.db);
      if (hasFlag(argv, "--inbox") && report.findings.length > 0) {
        // One review item per rule keeps the inbox readable when the wiki drifts a lot.
        const byRule = new Map<string, typeof report.findings>();
        for (const finding of report.findings) {
          byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
        }
        for (const [rule, findings] of byRule) {
          runtime.db.insertInboxItem({
            type: "wiki_proposal",
            title: `Wiki lint: ${findings.length} ${rule.replace(/_/g, " ")}(s)`,
            body: findings.map((finding) => `- ${finding.message}`).join("\n"),
            status: "pending",
            payload: { proposalKind: "wiki_lint", rule, findings }
          });
        }
      }
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      if (report.findings.length === 0) {
        console.log(`Wiki lint: clean (${report.pagesScanned} pages, ${report.entitiesChecked} entities).`);
        return;
      }
      for (const finding of report.findings) {
        console.log(`[${finding.rule}] ${finding.message}`);
      }
      console.log(`Wiki lint: ${report.findings.length} finding(s) over ${report.pagesScanned} pages.`);
      return;
    }
    if (subcommand === "list") {
      if (contextScope?.scope.mode === "strict") {
        throw new Error("Global wiki listing is outside the active strict context. Resolve and read an in-scope entity page instead.");
      }
      const pages = listWikiPages(runtime.config);
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(pages, null, 2));
        return;
      }
      if (pages.length === 0) {
        console.log("No wiki pages yet.");
        return;
      }
      for (const page of pages) {
        console.log(`${page.relativePath}\t${page.bytes}b`);
      }
      return;
    }
    if (subcommand === "read") {
      const relativePath = positionalValues(argv)[1];
      if (!relativePath) {
        throw new Error("Missing wiki page path. Use: pnpm wm wiki read <relative/path.md>.");
      }
      if (contextScope?.scope.mode === "strict") {
        const access = strictSourceAccessForOutput(contextScope);
        if (access === "none" || access === "metadata") {
          throw new Error(`Wiki content requires snippets or full source access; the active strict policy allows ${access}.`);
        }
        const subjectValue = optionValue(argv, "--entity");
        if (!subjectValue) {
          throw new Error("Path-only wiki reads are outside the active strict context. Provide --entity and --page.");
        }
        const subject = parseEntityRef(subjectValue);
        assertEntityInStrictScope(contextScope, subject);
        const homeValue = optionValue(argv, "--home");
        const resolution = homeValue
          ? { home: parseEntityRef(homeValue), status: "resolved" as const, reason: "Explicit home." }
          : resolveWikiHome(runtime.config, runtime.db, subject);
        if (!resolution.home || resolution.status !== "resolved") {
          throw new Error(`Cannot resolve wiki home for ${subjectValue}: ${resolution.reason}`);
        }
        assertEntityInStrictScope(contextScope, resolution.home);
        const expected = validateWikiPlacement(runtime.config, runtime.db, subject, resolution.home, optionValue(argv, "--page") ?? "index.md");
        if (path.normalize(relativePath) !== path.normalize(expected)) {
          throw new Error(`Wiki path is outside the in-scope entity page: ${relativePath}`);
        }
      }
      const content = readWikiPage(runtime.config, relativePath);
      console.log(strictSourceAccessForOutput(contextScope) === "snippets" ? content.slice(0, 2_000) : content);
      return;
    }
    if (subcommand === "write") {
      let body = optionValue(argv, "--body") ?? "";
      if (hasFlag(argv, "--stdin")) {
        body = await readStdin();
      }
      const subjectValue = optionValue(argv, "--entity");
      if (subjectValue) {
        const subject = parseEntityRef(subjectValue);
        assertWritableEntityInStrictScope(contextScope, subject);
        const homeValue = optionValue(argv, "--home");
        const resolution = homeValue
          ? { home: parseEntityRef(homeValue), status: "resolved" as const, reason: "Explicit home." }
          : resolveWikiHome(runtime.config, runtime.db, subject);
        if (!resolution.home || resolution.status !== "resolved") {
          throw new Error(`Cannot resolve wiki home for ${subjectValue}: ${resolution.reason}`);
        }
        assertWritableEntityInStrictScope(contextScope, resolution.home);
        const result = writeEntityWikiPage(runtime.config, runtime.db, {
          subject,
          home: resolution.home,
          page: optionValue(argv, "--page") ?? "index.md",
          content: body
        });
        console.log(hasFlag(argv, "--json")
          ? JSON.stringify(result, null, 2)
          : `Wrote ${path.relative(process.cwd(), result.absolutePath)}`);
        return;
      }
      throw new Error(
        "Path-only wiki writes are disabled. Provide --entity <kind:id>; OneAgent will resolve and validate the canonical path."
      );
    }
    if (subcommand === "log") {
      const message = positionalValues(argv).slice(1).join(" ").trim();
      if (!message) {
        throw new Error("Missing log message.");
      }
      appendWikiLog(runtime.config, optionValue(argv, "--action") ?? "note", message);
      console.log("Logged.");
      return;
    }
    if (subcommand === "sync") {
      const ref = positionalValues(argv)[1];
      if (!ref) {
        throw new Error("Missing entity reference. Use: pnpm wm wiki sync <kind:id>.");
      }
      const parsed = parseEntityRef(ref);
      assertWritableEntityInStrictScope(contextScope, parsed);
      syncEntityWikiToRepo(runtime.config, runtime.db, parsed.kind, parsed.id);
    }

    throw new Error("Unknown wiki command. Use: pnpm wm wiki migrate-layout|resolve-path|path|list|read|write|log|sync.");
  } finally {
    runtime.close();
  }
}

/**
 * Workspace taxonomy manager: list/add/update/merge entity kinds and relation types.
 * Core kinds (person, product, team, repository, oneagent, discovery, domain, subdomain) are
 * locked; vocabulary built-ins merge by alias; custom types merge and disappear.
 */
function taxonomyCommand(argv: string[]): void {
  const subcommand = firstPositional(argv) ?? "list";
  const runtime = createCliRuntime(argv);
  try {
    const taxonomy = runtime.config.taxonomy;
    const save = () => saveWorkspaceTaxonomy(runtime.config.workspaceRoot, taxonomy);
    const json = hasFlag(argv, "--json");

    if (subcommand === "list") {
      const model = buildTaxonomyModel(runtime);
      if (json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }
      for (const kind of model.entityKinds) {
        const flags = [kind.core ? "core" : kind.builtin ? "built-in" : "custom", kind.aliasOf ? `alias -> ${kind.aliasOf}` : ""].filter(Boolean).join(", ");
        console.log(`kind ${kind.id} (${flags}) — ${kind.count} entities${kind.label && kind.label !== kind.id ? ` — ${kind.label}` : ""}`);
      }
      for (const relation of model.relationTypes.filter((entry) => !entry.builtin || entry.aliasOf)) {
        console.log(`relation ${relation.type} (${relation.builtin ? "built-in" : "custom"}, ${relation.category})${relation.aliasOf ? ` alias -> ${relation.aliasOf}` : ""} — ${relation.count} relations`);
      }
      for (const detected of model.detectedCustomRelations) {
        console.log(`detected ${detected.type} — ${detected.count} relations (not formalized)`);
      }
      return;
    }

    if (subcommand === "add-kind") {
      const rawId = positionalValues(argv)[1];
      if (!rawId) {
        throw new Error("Usage: pnpm wm taxonomy add-kind <id> --description <when-to-use> [--label <label>] [--color <hex>].");
      }
      const id = normalizeKindId(rawId);
      const description = (optionValue(argv, "--description") ?? "").trim();
      if (!description) {
        throw new Error("--description is required: it is injected into the curation prompt so the agent knows when to use this type.");
      }
      if (isBuiltinEntityKind(id) || taxonomy.customEntityKinds.some((kind) => kind.id === id) || taxonomy.entityKindAliases[id]) {
        throw new Error(`Entity kind already exists (or is an alias): ${id}.`);
      }
      const now = nowIso();
      taxonomy.customEntityKinds.push({
        id,
        label: optionValue(argv, "--label") ?? rawId,
        color: optionValue(argv, "--color"),
        description,
        createdAt: now,
        updatedAt: now
      });
      save();
      console.log(`Added entity kind ${id}. It is immediately available in the graph, capture and curation.`);
      return;
    }

    if (subcommand === "update-kind") {
      const id = normalizeKindId(positionalValues(argv)[1] ?? "");
      const kind = taxonomy.customEntityKinds.find((entry) => entry.id === id);
      if (!kind) {
        throw new Error(`Unknown custom entity kind: ${id}. Built-in kinds cannot be edited.`);
      }
      const label = optionValue(argv, "--label");
      const color = optionValue(argv, "--color");
      const description = optionValue(argv, "--description");
      if (label) kind.label = label;
      if (color) kind.color = color;
      if (description !== undefined) {
        if (!description.trim()) {
          throw new Error("--description cannot be emptied: the curation agent needs it.");
        }
        kind.description = description;
      }
      kind.updatedAt = nowIso();
      save();
      console.log(`Updated entity kind ${id}.`);
      return;
    }

    if (subcommand === "merge-kind") {
      const fromRaw = positionalValues(argv)[1];
      const intoRaw = optionValue(argv, "--into");
      if (!fromRaw || !intoRaw) {
        throw new Error("Usage: pnpm wm taxonomy merge-kind <from> --into <target>.");
      }
      const from = normalizeKindId(fromRaw);
      const target = normalizeKindId(intoRaw);
      if (from === target) {
        throw new Error("Source and target kinds must differ.");
      }
      if (isCoreEntityKind(from)) {
        throw new Error(`Core kind ${from} carries pipeline semantics and can never be merged away.`);
      }
      const fromCustom = taxonomy.customEntityKinds.find((entry) => entry.id === from);
      if (!isBuiltinEntityKind(from) && !fromCustom) {
        throw new Error(`Unknown entity kind: ${from}.`);
      }
      const targetIsEffective =
        (isBuiltinEntityKind(target) && !taxonomy.entityKindAliases[target]) ||
        taxonomy.customEntityKinds.some((entry) => entry.id === target);
      if (!targetIsEffective) {
        throw new Error(`Target kind ${target} does not exist (or is itself merged away).`);
      }
      if (resolveEntityKind(target) === from) {
        throw new Error(`Merging ${from} into ${target} would create an alias cycle.`);
      }

      const entities = runtime.db.listEntities(from);
      const totals = { capturesReassigned: 0, relationsRewritten: 0, relationsDropped: 0, wikiFilesMoved: 0 };
      for (const entity of entities) {
        // Retyping keeps the id: materialize the target record from the source one
        // (mergeEntities requires an existing target), then let the merge engine
        // repoint relations, captures, aliases and the wiki slice.
        if (!runtime.db.getEntity(target, entity.id)) {
          runtime.db.upsertEntity({
            id: entity.id,
            kind: target,
            label: entity.label,
            description: entity.description,
            aliases: entity.aliases,
            status: entity.status,
            parentId: entity.parentId,
            ownerIds: entity.ownerIds,
            contributorIds: entity.contributorIds,
            tags: entity.tags,
            focusLevel: entity.focusLevel,
            metadata: entity.metadata,
            repoPath: entity.repoPath,
            wikiRoot: entity.wikiRoot
          });
        }
        const result = mergeEntityIntoTarget(runtime, { kind: from, id: entity.id }, { kind: target, id: entity.id });
        totals.capturesReassigned += result.capturesReassigned;
        totals.relationsRewritten += result.relationsRewritten;
        totals.relationsDropped += result.relationsDropped;
        totals.wikiFilesMoved += result.wikiFilesMoved;
      }

      if (fromCustom) {
        taxonomy.customEntityKinds = taxonomy.customEntityKinds.filter((entry) => entry.id !== from);
      }
      // The alias keeps stale refs and future writes (agent, imports) resolving to the target.
      taxonomy.entityKindAliases[from] = target;
      save();
      appendWikiLog(runtime.config, "curate", `merged entity kind ${from} into ${target} (${entities.length} entities retyped)`);

      if (json) {
        console.log(JSON.stringify({ from, into: target, entitiesRetyped: entities.length, aliased: !fromCustom, ...totals }, null, 2));
        return;
      }
      console.log(`Merged kind ${from} into ${target}: ${entities.length} entities retyped${fromCustom ? ", custom kind removed" : ", built-in kind aliased"}.`);
      return;
    }

    if (subcommand === "delete-kind") {
      const id = normalizeKindId(positionalValues(argv)[1] ?? "");
      const index = taxonomy.customEntityKinds.findIndex((entry) => entry.id === id);
      if (index === -1) {
        throw new Error(`Unknown custom entity kind: ${id}. Built-in kinds cannot be deleted (merge vocabulary kinds instead).`);
      }
      const count = runtime.db.listEntities(id).length;
      if (count > 0) {
        throw new Error(`${count} entities still use kind ${id}. Use: pnpm wm taxonomy merge-kind ${id} --into <target>.`);
      }
      if (Object.values(taxonomy.entityKindAliases).includes(id)) {
        throw new Error(`Kind ${id} is the target of an alias. Remove or repoint the alias first (unalias-kind).`);
      }
      taxonomy.customEntityKinds.splice(index, 1);
      save();
      console.log(`Deleted entity kind ${id}.`);
      return;
    }

    if (subcommand === "unalias-kind") {
      const from = normalizeKindId(positionalValues(argv)[1] ?? "");
      if (!taxonomy.entityKindAliases[from]) {
        throw new Error(`No alias registered for kind ${from}.`);
      }
      delete taxonomy.entityKindAliases[from];
      save();
      console.log(`Removed kind alias ${from}. New entities of this kind will keep it.`);
      return;
    }

    if (subcommand === "add-relation") {
      const rawType = positionalValues(argv)[1];
      if (!rawType) {
        throw new Error("Usage: pnpm wm taxonomy add-relation <type> [--category structural|work|people|practice_mission] [--reading <sentence>] [--description <text>] [--absorb <custom:type>].");
      }
      const type = normalizeKindId(rawType.replace(/^custom:/, ""));
      const category = optionValue(argv, "--category") ?? "work";
      if (!["structural", "work", "people", "practice_mission"].includes(category)) {
        throw new Error(`Unknown relation category: ${category}. Allowed: structural, work, people, practice_mission.`);
      }
      if (isRelationType(type)) {
        throw new Error(`Relation type already exists: ${type}.`);
      }
      const now = nowIso();
      taxonomy.customRelationTypes.push({
        type,
        category: category as "structural" | "work" | "people" | "practice_mission",
        reading: optionValue(argv, "--reading"),
        description: optionValue(argv, "--description"),
        createdAt: now,
        updatedAt: now
      });
      const absorb = optionValue(argv, "--absorb");
      let absorbed = 0;
      if (absorb && absorb !== type) {
        absorbed = retypeRelations(runtime, absorb, type, false);
        taxonomy.relationTypeAliases[absorb] = { into: type };
      }
      save();
      console.log(`Added relation type ${type} (${category})${absorb ? `; absorbed ${absorbed} ${absorb} relations` : ""}.`);
      return;
    }

    if (subcommand === "update-relation") {
      const type = normalizeKindId(positionalValues(argv)[1] ?? "");
      const relation = taxonomy.customRelationTypes.find((entry) => entry.type === type);
      if (!relation) {
        throw new Error(`Unknown custom relation type: ${type}. Built-in types cannot be edited.`);
      }
      const category = optionValue(argv, "--category");
      if (category) {
        if (!["structural", "work", "people", "practice_mission"].includes(category)) {
          throw new Error(`Unknown relation category: ${category}.`);
        }
        relation.category = category as "structural" | "work" | "people" | "practice_mission";
      }
      const reading = optionValue(argv, "--reading");
      const description = optionValue(argv, "--description");
      if (reading !== undefined) relation.reading = reading;
      if (description !== undefined) relation.description = description;
      relation.updatedAt = nowIso();
      save();
      console.log(`Updated relation type ${type}.`);
      return;
    }

    if (subcommand === "merge-relation") {
      const from = positionalValues(argv)[1];
      const into = optionValue(argv, "--into");
      if (!from || !into) {
        throw new Error("Usage: pnpm wm taxonomy merge-relation <from> --into <target> [--swap].");
      }
      if (from === into) {
        throw new Error("Source and target relation types must differ.");
      }
      if (!isRelationType(into) || resolveRelationType(into).type !== into) {
        throw new Error(`Target relation type ${into} does not exist (or is itself merged away).`);
      }
      if (resolveRelationType(into).type === from) {
        throw new Error(`Merging ${from} into ${into} would create an alias cycle.`);
      }
      const swap = hasFlag(argv, "--swap");
      const rewritten = retypeRelations(runtime, from, into, swap);
      taxonomy.customRelationTypes = taxonomy.customRelationTypes.filter((entry) => entry.type !== from);
      taxonomy.relationTypeAliases[from] = { into, swapDirection: swap };
      save();
      appendWikiLog(runtime.config, "curate", `merged relation type ${from} into ${into}${swap ? " (direction swapped)" : ""} (${rewritten} relations)`);
      if (json) {
        console.log(JSON.stringify({ from, into, swapDirection: swap, relationsRewritten: rewritten }, null, 2));
        return;
      }
      console.log(`Merged relation type ${from} into ${into}${swap ? " with source/target swapped" : ""}: ${rewritten} relations rewritten.`);
      return;
    }

    if (subcommand === "unalias-relation") {
      const from = positionalValues(argv)[1] ?? "";
      if (!taxonomy.relationTypeAliases[from]) {
        throw new Error(`No alias registered for relation type ${from}.`);
      }
      delete taxonomy.relationTypeAliases[from];
      save();
      console.log(`Removed relation alias ${from}.`);
      return;
    }

    throw new Error("Unknown taxonomy command. Use: list|add-kind|update-kind|merge-kind|delete-kind|unalias-kind|add-relation|update-relation|merge-relation|unalias-relation.");
  } finally {
    runtime.close();
  }
}

/** Rewrite every relation of one type onto another, optionally swapping source and target. */
function retypeRelations(runtime: ReturnType<typeof createCliRuntime>, fromType: string, intoType: string, swap: boolean): number {
  const relations = runtime.db.listEntityRelations({}).filter((relation) => relation.relationType === fromType);
  for (const relation of relations) {
    runtime.db.upsertEntityRelation({
      sourceKind: swap ? relation.targetKind : relation.sourceKind,
      sourceId: swap ? relation.targetId : relation.sourceId,
      targetKind: swap ? relation.sourceKind : relation.targetKind,
      targetId: swap ? relation.sourceId : relation.targetId,
      relationType: intoType,
      description: relation.description,
      metadata: relation.metadata
    });
    runtime.db.deleteEntityRelation(relation.id);
  }
  return relations.length;
}

interface TaxonomyModel {
  entityKinds: Array<{ id: string; label: string; color?: string; description?: string; builtin: boolean; core: boolean; aliasOf?: string; count: number }>;
  relationTypes: Array<{ type: string; category: string; builtin: boolean; reading?: string; description?: string; aliasOf?: string; swapDirection?: boolean; count: number }>;
  detectedCustomRelations: Array<{ type: string; count: number }>;
  entityKindAliases: Record<string, string>;
  relationTypeAliases: Record<string, { into: string; swapDirection?: boolean }>;
}

function buildTaxonomyModel(runtime: ReturnType<typeof createCliRuntime>): TaxonomyModel {
  const taxonomy = runtime.config.taxonomy;
  const entityCounts = new Map<string, number>();
  for (const entity of runtime.db.listEntities()) {
    entityCounts.set(entity.kind, (entityCounts.get(entity.kind) ?? 0) + 1);
  }
  const relationCounts = new Map<string, number>();
  for (const relation of runtime.db.listEntityRelations({})) {
    relationCounts.set(relation.relationType, (relationCounts.get(relation.relationType) ?? 0) + 1);
  }

  const builtinCategory = (type: string): string => {
    if ((STRUCTURAL_RELATIONS as readonly string[]).includes(type)) return "structural";
    if ((PERSON_RELATIONS as readonly string[]).includes(type)) return "people";
    if ((PRACTICE_MISSION_RELATIONS as readonly string[]).includes(type)) return "practice_mission";
    return "work";
  };

  return {
    entityKinds: [
      ...ENTITY_KINDS.map((kind) => ({
        id: kind as string,
        label: kind as string,
        builtin: true,
        core: isCoreEntityKind(kind),
        aliasOf: taxonomy.entityKindAliases[kind],
        count: entityCounts.get(kind) ?? 0
      })),
      ...taxonomy.customEntityKinds.map((kind) => ({
        id: kind.id,
        label: kind.label,
        color: kind.color,
        description: kind.description,
        builtin: false,
        core: false,
        aliasOf: undefined,
        count: entityCounts.get(kind.id) ?? 0
      }))
    ],
    relationTypes: [
      ...RELATION_TYPES.map((type) => ({
        type: type as string,
        category: builtinCategory(type),
        builtin: true,
        aliasOf: taxonomy.relationTypeAliases[type]?.into,
        swapDirection: taxonomy.relationTypeAliases[type]?.swapDirection,
        count: relationCounts.get(type) ?? 0
      })),
      ...taxonomy.customRelationTypes.map((relation) => ({
        type: relation.type,
        category: relation.category,
        builtin: false,
        reading: relation.reading,
        description: relation.description,
        aliasOf: undefined,
        swapDirection: undefined,
        count: relationCounts.get(relation.type) ?? 0
      }))
    ],
    detectedCustomRelations: [...relationCounts.entries()]
      .filter(([type]) => type.startsWith("custom:") && !taxonomy.relationTypeAliases[type])
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count),
    entityKindAliases: taxonomy.entityKindAliases,
    relationTypeAliases: taxonomy.relationTypeAliases
  };
}

function parseCaptureRelated(value: string): CaptureEntityRef {
  const ref = parseRelatedEntityRef(value);
  return { entityKind: ref.kind, entityId: ref.id, relationType: ref.relation };
}

function printCapture(capture: {
  id: string;
  title?: string;
  contentType?: string;
  status: string;
  primaryEntityKind?: string;
  primaryEntityId?: string;
  relatedEntities: CaptureEntityRef[];
  ingestionStatus: string;
  curationStatus?: string;
  curationSummary?: string;
  path?: string;
}): void {
  console.log(`Capture: ${capture.id}`);
  console.log(`Title: ${capture.title ?? "redacted"}`);
  console.log(`Content type: ${capture.contentType ?? "redacted"}`);
  console.log(`Status: ${capture.status}`);
  console.log(`Primary: ${capture.primaryEntityKind && capture.primaryEntityId ? `${capture.primaryEntityKind}:${capture.primaryEntityId}` : "redacted"}`);
  for (const related of capture.relatedEntities) {
    console.log(`Related: ${related.entityKind}:${related.entityId} (${related.relationType})`);
  }
  console.log(`Ingestion: ${capture.ingestionStatus}`);
  if (capture.curationStatus) {
    console.log(`Curation: ${capture.curationStatus}${capture.curationSummary ? ` — ${capture.curationSummary}` : ""}`);
  }
  if (capture.path) {
    console.log(`Path: ${capture.path}`);
  }
}

function linkCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);
  const configPath = requireConfigPath(argv);
  if (subcommand === "delete") {
    const linkId = positionalValues(argv)[1];
    if (!linkId) {
      throw new Error("Missing link id.");
    }
    const runtime = createCliRuntime(argv);
    try {
      const contextScope = activeResolvedContextScope(runtime, argv);
      const existing = runtime.config.entityLinks.find((link) => link.id === linkId);
      if (!existing) throw new Error(`Entity link not found: ${linkId}`);
      if (!hasFlag(argv, "--allow-boundary-change")) {
        assertEntityIdInStrictScope(contextScope, existing.sourceId);
        assertEntityIdInStrictScope(contextScope, existing.targetId);
        assertRelationInStrictScope(contextScope, resolveRelationType(existing.type).type);
      }
    } finally {
      runtime.close();
    }
    deleteEntityLinkFromConfig(configPath, linkId);
    console.log(`Deleted link: ${linkId}`);
    return;
  }
  if (subcommand !== "upsert") {
    throw new Error("Unknown link command. Use: pnpm wm link upsert --source <id> --target <id> --type <type>.");
  }
  const sourceId = optionValue(argv, "--source");
  const targetId = optionValue(argv, "--target");
  const type = optionValue(argv, "--type");
  if (!sourceId || !targetId || !type) {
    throw new Error("Missing --source, --target or --type.");
  }
  let relationType = type;
  const runtime = createCliRuntime(argv);
  try {
    relationType = assertRelationType(resolveRelationType(type).type);
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (!hasFlag(argv, "--allow-boundary-change")) {
      assertEntityIdInStrictScope(contextScope, sourceId);
      assertEntityIdInStrictScope(contextScope, targetId);
      assertRelationInStrictScope(contextScope, relationType);
    }
  } finally {
    runtime.close();
  }
  const linkId = optionValue(argv, "--id") || `${sourceId}-${relationType}-${targetId}`;
  upsertEntityLinkInConfig(configPath, {
    id: linkId,
    sourceId,
    targetId,
    type: relationType,
    description: optionValue(argv, "--description")
  });
  console.log(`Upserted link: ${sourceId} --${relationType}--> ${targetId}`);
}

function repoCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);
  if (subcommand !== "add") {
    throw new Error("Unknown repo command. Use: pnpm wm repo add <product-id> <repo-id> --path <path>.");
  }

  const values = positionalValues(argv);
  const productId = values[1];
  const repoId = values[2];
  if (!productId || !repoId) {
    throw new Error("Missing product id or repository id.");
  }

  const repoPath = optionValue(argv, "--path");
  if (!repoPath) {
    throw new Error("Missing repository path. Pass --path <path>.");
  }

  const configPath = requireConfigPath(argv);
  const purpose = optionValue(argv, "--purpose");
  if (purpose !== undefined && purpose !== "product-reference") {
    throw new Error("repo add registers a product-reference. Configure privateBackup separately; it never enables a wiki projection.");
  }
  const config = addRepositoryToConfig(configPath, {
    productId,
    id: repoId,
    role: optionValue(argv, "--role") ?? "specs",
    path: repoPath,
    wikiRoot: optionValue(argv, "--wiki-root"),
    specsRoot: optionValue(argv, "--specs-root"),
    gitRemote: optionValue(argv, "--git-remote")
  });

  console.log(`Added repository: ${repoId}`);
  console.log(`Product: ${productId}`);
  console.log(`Config: ${path.relative(process.cwd(), config.configPath)}`);
}

async function ingestCommand(argv: string[]): Promise<void> {
  const filePath = firstPositional(argv);
  if (!filePath) {
    throw new Error("Missing source file path.");
  }

  const runtime = createCliRuntime(argv);
  try {
    if (optionValue(argv, "--product")) {
      throw new Error("--product is no longer supported for ingestion; use --entity kind:id (or --entities kind:id,...).");
    }
    const entityRefs = parseScopeEntityRefs(optionValue(argv, "--entities") ?? optionValue(argv, "--entity"));
    if (entityRefs.length === 0) {
      throw new Error("Ingestion requires at least one typed entity reference via --entity kind:id.");
    }
    for (const ref of entityRefs) {
      if (!runtime.db.getEntity(ref.kind, ref.id)) {
        throw new Error(`Ingestion entity does not exist: ${ref.kind}:${ref.id}`);
      }
    }
    const result = await ingestSource(runtime, {
      filePath,
      entityRefs,
      sourceType: parseSourceType(optionValue(argv, "--source-type"))
    });

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({
        source: {
          id: result.source.id,
          title: result.source.title,
          sourceType: result.source.sourceType,
          rawPath: result.source.rawPath,
          status: result.source.status
        },
        entityRefs,
        chunks: result.chunks.length,
        insights: result.insights.length,
        inboxProposals: result.inboxItemIds.length
      }, null, 2));
      return;
    }

    console.log(`Ingested: ${result.source.title}`);
    console.log(`Source: ${result.source.id}`);
    console.log(`Chunks: ${result.chunks.length}`);
    console.log(`Inbox proposals: ${result.inboxItemIds.length}`);
  } finally {
    runtime.close();
  }
}

async function reindexCommand(argv: string[]): Promise<void> {
  const runtime = createCliRuntime(argv);
  try {
    if (optionValue(argv, "--product")) {
      throw new Error("--product is no longer supported for reindexing; use --entity repository:<id>.");
    }
    const entityValue = optionValue(argv, "--entity");
    if (!entityValue) throw new Error("Reindexing requires --entity repository:<id>.");
    const ref = parseEntityRef(entityValue);
    if (ref.kind !== "repository") {
      throw new Error(`Reindexing requires a repository entity, received ${ref.kind}:${ref.id}.`);
    }
    const repository = runtime.db.getEntity(ref.kind, ref.id);
    if (!repository) throw new Error(`Repository entity does not exist: ${ref.kind}:${ref.id}`);
    const include = parseInclude(optionValue(argv, "--include"));
    const result = await reindexRepository(runtime, {
      repository,
      include,
      referenceBranch: optionValue(argv, "--branch")
    });

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.complete) process.exitCode = 1;
      return;
    }
    if (!result.complete) process.exitCode = 1;
    if (result.error) console.log(`Index retained: ${result.error}`);
    console.log(`Complete: ${result.complete}; missing: ${result.missing}; moved: ${result.moved}; branch: ${result.branch ?? "unversioned"}`);
    console.log(`Reindexed entity: ${result.entity.kind}:${result.entity.id}`);
    console.log(`Indexed: ${result.indexed}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Failed: ${result.failed}`);

    for (const file of result.files.filter((candidate) => candidate.status !== "indexed")) {
      console.log(`- ${file.status}: ${file.path}${file.error ? ` (${file.error})` : ""}`);
    }
  } finally {
    runtime.close();
  }
}

function parseScopeEntityRefs(value: string | undefined): EntityRef[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => parseEntityRef(token));
}

function parseEntityKinds(value: string | undefined): EntityKind[] | undefined {
  if (!value) {
    return undefined;
  }
  const kinds = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => assertEntityKind(token));
  return kinds.length > 0 ? kinds : undefined;
}

function readActiveContextScope(runtime: ReturnType<typeof createCliRuntime>): AgentContextScope | undefined {
  const stored = runtime.db.getUiState<Partial<AgentContextScope>>(AGENT_CONTEXT_SCOPE_UI_KEY);
  if (!stored) {
    return undefined;
  }
  const scope = normalizeContextScope(stored);
  return scope.selectedEntities.length > 0 ? scope : undefined;
}

function reconcileContextScopeViewBinding(
  runtime: ReturnType<typeof createCliRuntime>,
  scope: AgentContextScope
): AgentContextScope {
  if (!scope.viewId) return scope;
  const view = getContextView(runtime.db, scope.viewId);
  const comparable = (value: AgentContextScope): string => {
    const copy = structuredClone(value) as AgentContextScope;
    delete copy.updatedAt;
    return JSON.stringify(copy);
  };
  if (!view || view.version !== scope.viewVersion || comparable(view.context) !== comparable(scope)) {
    // An edited draft is a valid ad-hoc context, but it must not keep claiming
    // that the stored view/version is active until that view has been updated.
    return normalizeContextScope({ ...scope, viewId: undefined, viewVersion: undefined, updatedAt: nowIso() });
  }
  return scope;
}

function activeResolvedContextScope(runtime: ReturnType<typeof createCliRuntime>, argv: string[]) {
  if (optionValue(argv, "--context-scope") !== "active") return undefined;
  const scope = readActiveContextScope(runtime);
  return scope && scope.mode !== "disabled" ? resolveContextScope({ db: runtime.db, scope }) : undefined;
}

function strictContextCommandBoundary(runtime: ReturnType<typeof createCliRuntime>, argv: string[]): {
  resolved: ResolvedContextScope;
  activeViewId?: string;
  allowBoundaryChange: boolean;
} | undefined {
  const resolved = activeResolvedContextScope(runtime, argv);
  if (!resolved || resolved.scope.mode !== "strict") return undefined;
  return {
    resolved,
    activeViewId: getActiveContextView(runtime.db)?.id,
    allowBoundaryChange: hasFlag(argv, "--allow-boundary-change")
  };
}

function assertContextViewAvailableInsideBoundary(
  boundary: ReturnType<typeof strictContextCommandBoundary>,
  viewId: string | undefined,
  action: string
): void {
  if (!boundary || boundary.allowBoundaryChange) return;
  if (!viewId || viewId !== boundary.activeViewId) {
    throw new Error(
      `Context view ${viewId ?? "(none)"} is outside the active strict context. ` +
      `Activate it explicitly before ${action}, or confirm an intentional boundary change.`
    );
  }
}

function assertResolvedScopeInsideBoundary(
  boundary: ResolvedContextScope,
  candidate: ResolvedContextScope,
  action: string
): void {
  if (boundary.scope.mode !== "strict") return;
  assertContextPolicyInsideStrictBoundary(boundary.scope, candidate.scope, action);
  const dimensions: Array<[string, string[], string[]]> = [
    ["entity", boundary.entities.map((ref) => `${ref.kind}:${ref.id}`), candidate.entities.map((ref) => `${ref.kind}:${ref.id}`)],
    ["source", boundary.sourceIds, candidate.sourceIds],
    ["capture", boundary.captureIds, candidate.captureIds],
    ["task", boundary.taskIds, candidate.taskIds],
    ["Inbox item", boundary.inboxItemIds, candidate.inboxItemIds],
    ["observation", boundary.observationIds, candidate.observationIds]
  ];
  for (const [label, allowedValues, requestedValues] of dimensions) {
    const allowed = new Set(allowedValues);
    const outside = requestedValues.find((value) => !allowed.has(value));
    if (outside) throw new Error(`${action} would access ${label} outside the active strict context: ${outside}`);
  }
  const accessRank = { none: 0, metadata: 1, snippets: 2, full: 3 } as const;
  const boundaryAccess = boundary.scope.sourceAccess ?? "full";
  const candidateAccess = candidate.scope.sourceAccess ?? "full";
  if (accessRank[candidateAccess] > accessRank[boundaryAccess]) {
    throw new Error(`${action} would broaden source access from ${boundaryAccess} to ${candidateAccess}.`);
  }
}

function assertContextPolicyInsideStrictBoundary(
  boundary: AgentContextScope,
  candidate: AgentContextScope,
  action: string
): void {
  if (candidate.mode !== "strict") {
    throw new Error(`${action} would disable the active strict context policy (requested mode: ${candidate.mode}).`);
  }
  if (candidate.depth > boundary.depth) {
    throw new Error(`${action} would broaden graph depth from ${boundary.depth} to ${candidate.depth}.`);
  }
  const subsetPolicies: Array<[string, string[] | undefined, string[] | undefined]> = [
    ["entity types", boundary.includedTypes, candidate.includedTypes],
    ["relation types", boundary.allowedRelationTypes, candidate.allowedRelationTypes],
    ["entity statuses", boundary.entityStatuses, candidate.entityStatuses],
    ["source statuses", boundary.sourceStatuses, candidate.sourceStatuses],
    ["observation evidence statuses", boundary.observationEvidenceStatuses, candidate.observationEvidenceStatuses]
  ];
  for (const [label, allowedValues, requestedValues] of subsetPolicies) {
    if (!allowedValues) continue;
    if (!requestedValues) throw new Error(`${action} would remove the active strict ${label} filter.`);
    const allowed = new Set(allowedValues);
    const outside = requestedValues.find((value) => !allowed.has(value));
    if (outside) throw new Error(`${action} would broaden the active strict ${label} policy with: ${outside}`);
  }
  const defaultObservationStatuses = ["captured", "proposed", "accepted"];
  const boundaryObservationStatuses = boundary.observationValidationStatuses ?? boundary.validationStatuses ?? defaultObservationStatuses;
  const candidateObservationStatuses = candidate.observationValidationStatuses ?? candidate.validationStatuses ?? defaultObservationStatuses;
  const allowedObservationStatuses = new Set(boundaryObservationStatuses);
  const outsideObservationStatus = candidateObservationStatuses.find((status) => !allowedObservationStatuses.has(status));
  if (outsideObservationStatus) {
    throw new Error(`${action} would broaden the active strict observation validation policy with: ${outsideObservationStatus}`);
  }
  const boundaryExcluded = new Set((boundary.excludedEntities ?? []).map((ref) => `${ref.kind}:${ref.id}`));
  const candidateExcluded = new Set((candidate.excludedEntities ?? []).map((ref) => `${ref.kind}:${ref.id}`));
  const removedExclusion = [...boundaryExcluded].find((ref) => !candidateExcluded.has(ref));
  if (removedExclusion) throw new Error(`${action} would remove an active strict exclusion: ${removedExclusion}`);

  const boundaryRange = boundary.timeRange;
  const candidateRange = candidate.timeRange;
  const parseRange = (value: string | undefined, endOfDay: boolean): number | undefined => {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`${action} contains an invalid strict time boundary: ${value}`);
    return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parsed + 86_400_000 - 1 : parsed;
  };
  const boundaryFrom = parseRange(boundaryRange?.from, false);
  const candidateFrom = parseRange(candidateRange?.from, false);
  const boundaryTo = parseRange(boundaryRange?.to, true);
  const candidateTo = parseRange(candidateRange?.to, true);
  if (boundaryFrom !== undefined && (candidateFrom === undefined || candidateFrom < boundaryFrom)) {
    throw new Error(`${action} would broaden the active strict time range before ${boundaryRange?.from}.`);
  }
  if (boundaryTo !== undefined && (candidateTo === undefined || candidateTo > boundaryTo)) {
    throw new Error(`${action} would broaden the active strict time range after ${boundaryRange?.to}.`);
  }
  if (boundary.observationMeasurement !== "any" && candidate.observationMeasurement !== boundary.observationMeasurement) {
    throw new Error(`${action} would broaden the active strict measurement filter from ${boundary.observationMeasurement} to ${candidate.observationMeasurement}.`);
  }
  const boundaryBudget = boundary.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const candidateBudget = candidate.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  if (candidateBudget > boundaryBudget) {
    throw new Error(`${action} would broaden the active strict token budget from ${boundaryBudget} to ${candidateBudget}.`);
  }
  const refreshRank = { frozen: 0, monitored: 1, dynamic: 2 } as const;
  const boundaryRefresh = boundary.refreshPolicy ?? "monitored";
  const candidateRefresh = candidate.refreshPolicy ?? "monitored";
  if (refreshRank[candidateRefresh] > refreshRank[boundaryRefresh]) {
    throw new Error(`${action} would broaden the active strict refresh policy from ${boundaryRefresh} to ${candidateRefresh}.`);
  }
}

function assertContextScopeInsideBoundary(
  runtime: ReturnType<typeof createCliRuntime>,
  boundary: ReturnType<typeof strictContextCommandBoundary>,
  scope: Partial<AgentContextScope>,
  action: string
): void {
  if (!boundary || boundary.allowBoundaryChange) return;
  const candidate = resolveContextScope({ db: runtime.db, scope: normalizeContextScope(scope) });
  assertResolvedScopeInsideBoundary(boundary.resolved, candidate, action);
}

function assertContextPackInsideBoundary(
  runtime: ReturnType<typeof createCliRuntime>,
  boundary: ReturnType<typeof strictContextCommandBoundary>,
  pack: ContextPack,
  action: string
): void {
  if (!boundary || boundary.allowBoundaryChange) return;
  const candidate = resolveContextScope({ db: runtime.db, scope: normalizeContextScope(pack.scope) });
  assertResolvedScopeInsideBoundary(boundary.resolved, candidate, action);
  const allowedEntities = new Set(boundary.resolved.entities.map((ref) => `${ref.kind}:${ref.id}`));
  const allowedSources = new Set(boundary.resolved.sourceIds);
  const allowedTasks = new Set(boundary.resolved.taskIds);
  const allowedInbox = new Set(boundary.resolved.inboxItemIds);
  const allowedObservations = new Set(boundary.resolved.observationIds);
  for (const ref of pack.resolvedEntities.map((item) => `${item.kind}:${item.id}`)) {
    if (!allowedEntities.has(ref)) throw new Error(`${action} would disclose a stored entity outside the active strict context: ${ref}`);
  }
  for (const sourceId of pack.provenance.map((item) => item.sourceId)) {
    if (!allowedSources.has(sourceId)) {
      throw new Error(`${action} would disclose a source outside the active strict context: ${sourceId}`);
    }
  }
  for (const entry of pack.entries) {
    const allowed = entry.kind === "entity"
      ? allowedEntities.has(entry.ref)
      : entry.kind === "source"
        ? allowedSources.has(entry.ref.replace(/^source:/, ""))
        : entry.kind === "task"
          ? allowedTasks.has(entry.ref.replace(/^task:/, ""))
          : entry.kind === "inbox"
            ? allowedInbox.has(entry.ref.replace(/^inbox:/, ""))
            : allowedObservations.has(entry.ref.replace(/^observation:/, ""));
    if (!allowed) throw new Error(`${action} would disclose a stored ${entry.kind} outside the active strict context: ${entry.ref}`);
    const outsideSource = entry.provenance.find((sourceId) => !allowedSources.has(sourceId));
    if (outsideSource) throw new Error(`${action} would disclose stored provenance outside the active strict context: ${outsideSource}`);
  }
}

function contextPackHistorySummary(pack: ContextPack, boundary: ResolvedContextScope): Omit<ContextPack, "entries"> & {
  entries: Array<Pick<ContextPack["entries"][number], "kind" | "ref" | "title" | "role" | "tokenCount" | "provenance">>;
  contentRedacted: true;
} {
  return {
    ...pack,
    scope: boundary.scope,
    exclusions: [],
    entries: pack.entries.map(({ kind, ref, title, role, tokenCount, provenance }) => ({ kind, ref, title, role, tokenCount, provenance })),
    contentRedacted: true
  };
}

function contextPackSummaryFromPack(pack: ContextPack, boundary?: ResolvedContextScope): ContextPackSummary {
  return {
    id: pack.id,
    version: pack.version,
    viewId: pack.viewId,
    viewVersion: pack.viewVersion,
    sessionId: pack.sessionId,
    request: pack.request,
    scope: boundary?.scope ?? pack.scope,
    entryCount: pack.entries.length,
    provenance: pack.provenance,
    estimatedTokens: pack.estimatedTokens,
    actualTokens: pack.actualTokens,
    budget: pack.budget,
    truncated: pack.truncated,
    createdAt: pack.createdAt
  };
}

function strictScopeSets(scope: ResolvedContextScope): {
  entities: Set<string>;
  writableEntities: Set<string>;
  products: Set<string>;
  sources: Set<string>;
} {
  const entities = new Set(scope.entities.map((ref) => `${ref.kind}:${ref.id}`));
  const metadataOnly = new Set(scope.metadataOnlyEntityRefs ?? []);
  return {
    entities,
    writableEntities: new Set([...entities].filter((ref) => !metadataOnly.has(ref))),
    products: new Set(
      scope.entities
        .filter((ref) => ref.kind === "product" && !metadataOnly.has(`${ref.kind}:${ref.id}`))
        .map((ref) => ref.id)
    ),
    sources: new Set(scope.sourceIds)
  };
}

function isClearValue(value: string | undefined): boolean {
  return value === "none" || value === "clear";
}

function assertTaskInsideStrictScope(
  scope: ResolvedContextScope,
  task: Pick<TaskReadModelItem, "productId" | "sourceId" | "links">
): void {
  if (scope.scope.mode !== "strict") return;
  const allowed = strictScopeSets(scope);
  if (task.productId && !allowed.products.has(task.productId)) {
    throw new Error(`Task product is outside the active strict context scope: ${task.productId}`);
  }
  if (task.sourceId && !allowed.sources.has(task.sourceId)) {
    throw new Error(`Task source is outside the active strict context scope: ${task.sourceId}`);
  }
  for (const link of task.links) {
    const ref = `${link.targetKind}:${link.targetId}`;
    if (!allowed.writableEntities.has(ref)) {
      throw new Error(`Task link is outside the writable active strict context scope: ${ref}`);
    }
    assertRelationInStrictScope(scope, link.relationType);
  }
  if (!task.productId && !task.sourceId && task.links.length === 0) {
    throw new Error("A task under a strict context must remain linked to an in-scope product, source or entity.");
  }
}

function sanitizeTaskForStrictScope(task: TaskReadModelItem, scope: ResolvedContextScope): TaskReadModelItem {
  const allowed = strictScopeSets(scope);
  return {
    ...task,
    productId: task.productId && allowed.products.has(task.productId) ? task.productId : undefined,
    sourceId: task.sourceId && allowed.sources.has(task.sourceId) ? task.sourceId : undefined,
    links: task.links.filter((link) => allowed.entities.has(`${link.targetKind}:${link.targetId}`))
  };
}

function assertCaptureInStrictScope(scope: ResolvedContextScope | undefined, captureId: string): void {
  if (scope?.scope.mode === "strict" && !scope.captureIds.includes(captureId)) {
    throw new Error(`Capture is outside the active strict context scope: ${captureId}`);
  }
}

/**
 * A capture can enter a resolved scope through any one of its linked entities.
 * Before mutating it, validate every dimension it would carry through the write;
 * otherwise an in-scope related entity could be used to rewrite an out-of-scope
 * primary entity, source or relation.
 */
function assertCaptureMutationInsideStrictScope(
  runtime: ReturnType<typeof createCliRuntime>,
  scope: ResolvedContextScope | undefined,
  captureOrId: CaptureRecord | string
): CaptureRecord {
  const capture = typeof captureOrId === "string" ? runtime.db.getCapture(captureOrId) : captureOrId;
  if (!capture) {
    throw new Error(`Capture not found: ${String(captureOrId)}`);
  }
  if (scope?.scope.mode !== "strict") return capture;
  assertCaptureInStrictScope(scope, capture.id);
  assertEntityInStrictScope(scope, { kind: capture.primaryEntityKind, id: capture.primaryEntityId });
  if (capture.sourceId && !scope.sourceIds.includes(capture.sourceId)) {
    throw new Error(`Capture source is outside the active strict context scope: ${capture.id} -> ${capture.sourceId}`);
  }
  for (const related of capture.relatedEntities) {
    assertEntityInStrictScope(scope, { kind: related.entityKind, id: related.entityId });
    assertRelationInStrictScope(scope, related.relationType);
  }
  return capture;
}

function captureSourceRevisionIds(
  runtime: ReturnType<typeof createCliRuntime>,
  capture: CaptureRecord
): string[] {
  const logicalKeys = new Set<string>();
  if (capture.path) logicalKeys.add(capture.path);
  if (capture.sourceId) {
    const current = runtime.db.db
      .prepare("SELECT logical_key AS logicalKey, raw_path AS rawPath FROM sources WHERE id = ?")
      .get(capture.sourceId) as { logicalKey: string | null; rawPath: string | null } | undefined;
    if (current?.logicalKey) logicalKeys.add(current.logicalKey);
    if (current?.rawPath) logicalKeys.add(current.rawPath);
  }
  if (logicalKeys.size === 0) return capture.sourceId ? [capture.sourceId] : [];
  const ids = new Set<string>();
  for (const key of logicalKeys) {
    const rows = runtime.db.db
      .prepare("SELECT id FROM sources WHERE logical_key = ? OR raw_path = ?")
      .all(key, key) as Array<{ id: string }>;
    for (const row of rows) ids.add(row.id);
  }
  if (capture.sourceId) ids.add(capture.sourceId);
  return [...ids];
}

function assertCaptureSourceFamilyInsideStrictScope(
  runtime: ReturnType<typeof createCliRuntime>,
  scope: ResolvedContextScope | undefined,
  capture: CaptureRecord,
  action: string
): void {
  if (scope?.scope.mode !== "strict") return;
  const revisionIds = captureSourceRevisionIds(runtime, capture);
  const outside = revisionIds.find((sourceId) => !scope.sourceIds.includes(sourceId));
  if (outside) {
    throw new Error(`${action} would mutate a source revision outside the active strict context scope: ${outside}`);
  }
  for (const sourceId of revisionIds) {
    const products = runtime.db.db
      .prepare("SELECT product_id AS productId FROM source_products WHERE source_id = ?")
      .all(sourceId) as Array<{ productId: string }>;
    for (const product of products) {
      assertEntityInStrictScope(scope, { kind: "product", id: product.productId });
    }
  }
}

/** Validate every row an entity merge/delete can rewrite or remove. */
function assertEntityMutationInsideStrictScope(
  runtime: ReturnType<typeof createCliRuntime>,
  scope: ResolvedContextScope | undefined,
  ref: EntityRef
): void {
  if (scope?.scope.mode !== "strict") return;
  assertWritableEntityInStrictScope(scope, ref);
  for (const relation of runtime.db.listEntityRelations(ref)) {
    // Deleting or merging the entity also removes/rewrites every incident
    // relation. A metadata-only endpoint is visible for orientation but is not
    // writable, including indirectly through its neighbour.
    assertWritableEntityInStrictScope(scope, { kind: relation.sourceKind, id: relation.sourceId });
    assertWritableEntityInStrictScope(scope, { kind: relation.targetKind, id: relation.targetId });
    assertRelationInStrictScope(scope, relation.relationType);
  }
  for (const capture of runtime.db.listCapturesForEntity(ref.kind, ref.id)) {
    assertCaptureMutationInsideStrictScope(runtime, scope, capture);
  }
}

/** Validate config-side cascades performed when an organization entity disappears. */
function assertConfigEntityDeletionInsideStrictScope(
  runtime: ReturnType<typeof createCliRuntime>,
  scope: ResolvedContextScope | undefined,
  entityId: string
): void {
  if (scope?.scope.mode !== "strict") return;
  const configEntity = runtime.config.entities.find((entity) => entity.id === entityId);
  if (configEntity) {
    assertWritableEntityInStrictScope(scope, { kind: configEntity.kind, id: configEntity.id });
  }
  for (const link of runtime.config.entityLinks) {
    if (link.sourceId !== entityId && link.targetId !== entityId) continue;
    assertEntityIdInStrictScope(scope, link.sourceId);
    assertEntityIdInStrictScope(scope, link.targetId);
    assertRelationInStrictScope(scope, resolveRelationType(link.type).type);
  }
  for (const product of runtime.config.products) {
    if (product.parentEntityId === entityId) {
      assertWritableEntityInStrictScope(scope, { kind: "product", id: product.id });
    }
  }
}

function assertStrictSourceAccess(
  scope: ResolvedContextScope | undefined,
  required: "metadata" | "snippets" | "full",
  action: string
): void {
  if (scope?.scope.mode !== "strict") return;
  const rank = { none: 0, metadata: 1, snippets: 2, full: 3 } as const;
  const actual = scope.scope.sourceAccess ?? "full";
  if (rank[actual] < rank[required]) {
    throw new Error(`${action} requires ${required} source access; the active strict context allows ${actual}.`);
  }
}

function assertEntityInStrictScope(scope: ResolvedContextScope | undefined, ref: EntityRef): void {
  if (scope?.scope.mode !== "strict") return;
  if (!scope.entities.some((candidate) => candidate.kind === ref.kind && candidate.id === ref.id)) {
    throw new Error(`Entity is outside the active strict context scope: ${ref.kind}:${ref.id}`);
  }
}

function assertWritableEntityInStrictScope(scope: ResolvedContextScope | undefined, ref: EntityRef): void {
  assertEntityInStrictScope(scope, ref);
  if (scope?.scope.mode !== "strict") return;
  const key = `${ref.kind}:${ref.id}`;
  if ((scope.metadataOnlyEntityRefs ?? []).includes(key)) {
    throw new Error(
      `Entity is metadata-only in the active strict context and cannot be mutated without an explicit boundary change: ${key}`
    );
  }
}

function assertEntityIdInStrictScope(scope: ResolvedContextScope | undefined, entityId: string): void {
  if (scope?.scope.mode !== "strict") return;
  const metadataOnly = new Set(scope.metadataOnlyEntityRefs ?? []);
  if (!scope.entities.some((entity) => entity.id === entityId && !metadataOnly.has(`${entity.kind}:${entity.id}`))) {
    throw new Error(`Entity is outside the active strict context scope: ${entityId}`);
  }
}

function assertRelationInStrictScope(scope: ResolvedContextScope | undefined, relationType: string): void {
  if (scope?.scope.mode !== "strict" || !scope.scope.allowedRelationTypes) return;
  if (!scope.scope.allowedRelationTypes.includes(relationType)) {
    throw new Error(`Relation type is outside the active strict context policy: ${relationType}`);
  }
}

function captureForStrictScope(capture: CaptureRecord, scope: ResolvedContextScope | undefined) {
  if (scope?.scope.mode !== "strict") return capture;
  const entities = new Set(scope.entities.map((ref) => `${ref.kind}:${ref.id}`));
  const primaryAllowed = entities.has(`${capture.primaryEntityKind}:${capture.primaryEntityId}`);
  const sourceAccess = scope.scope.sourceAccess ?? "full";
  return {
    ...capture,
    title: sourceAccess === "none" ? undefined : capture.title,
    contentType: sourceAccess === "none" ? undefined : capture.contentType,
    primaryEntityKind: primaryAllowed ? capture.primaryEntityKind : undefined,
    primaryEntityId: primaryAllowed ? capture.primaryEntityId : undefined,
    relatedEntities: capture.relatedEntities.filter((ref) =>
      entities.has(`${ref.entityKind}:${ref.entityId}`) &&
      (!scope.scope.allowedRelationTypes || scope.scope.allowedRelationTypes.includes(ref.relationType))
    ),
    sourceId: sourceAccess !== "none" && capture.sourceId && scope.sourceIds.includes(capture.sourceId) ? capture.sourceId : undefined,
    path: sourceAccess === "full" ? capture.path : undefined,
    contentHash: sourceAccess === "full" ? capture.contentHash : undefined,
    error: sourceAccess === "full" ? capture.error : undefined,
    sourceKind: sourceAccess === "none" ? undefined : capture.sourceKind,
    sourceOrigin: sourceAccess === "none" ? undefined : capture.sourceOrigin,
    tags: sourceAccess === "none" ? undefined : capture.tags,
    curationSummary: sourceAccess === "full"
      ? capture.curationSummary
      : sourceAccess === "snippets"
        ? capture.curationSummary?.slice(0, 2_000)
        : undefined
  };
}

function printContextScope(runtime: ReturnType<typeof createCliRuntime>, scope: AgentContextScope, argv: string[]): void {
  const resolved = sanitizeResolvedContextForOutput(resolveContextScope({ db: runtime.db, scope }));
  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify(resolved, null, 2));
    return;
  }
  console.log(`Context scope: mode=${scope.mode} depth=${scope.depth}`);
  console.log(`selected: ${scope.selectedEntities.map((ref) => `${ref.kind}:${ref.id}`).join(", ") || "none"}`);
  if (scope.includedTypes) {
    console.log(`types: ${scope.includedTypes.join(", ")}`);
  }
  console.log(`reachable: ${resolved.counts.entities} entities, ${resolved.counts.captures} captures, ${resolved.counts.sources} sources`);
}

async function readContextScopeInput(argv: string[]): Promise<AgentContextScope> {
  if (hasFlag(argv, "--stdin")) {
    const raw = await readStdin();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid context scope JSON on stdin.");
    }
    return normalizeContextScope({ ...(parsed as Partial<AgentContextScope>), updatedAt: nowIso() });
  }
  const selectedEntities = parseScopeEntityRefs(optionValue(argv, "--entity"));
  if (selectedEntities.length === 0) {
    throw new Error("Missing --entity kind:id[,kind:id] or --stdin. Use: pnpm wm context-scope set --entity team:store-team[,person:jane] [--depth 1] [--mode guided] [--types feature,product].");
  }
  const depthOption = optionValue(argv, "--depth");
  return normalizeContextScope({
    selectedEntities,
    depth: depthOption !== undefined ? Number(depthOption) : undefined,
    mode: optionValue(argv, "--mode") as AgentContextScopeMode | undefined,
    includedTypes: parseEntityKinds(optionValue(argv, "--types")),
    updatedAt: nowIso()
  });
}

async function contextScopeCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv) ?? "get";

  if (subcommand === "clear") {
    const runtime = createCliRuntime(argv);
    try {
      const current = readActiveContextScope(runtime);
      if (current?.mode === "strict" && !hasFlag(argv, "--allow-boundary-change")) {
        throw new Error("Clearing the active strict context requires explicitly confirmed boundary change (--allow-boundary-change).");
      }
      runtime.db.runInImmediateTransaction(() => {
        runtime.db.setUiState(AGENT_CONTEXT_SCOPE_UI_KEY, null);
        runtime.db.setUiState(ACTIVE_CONTEXT_VIEW_UI_KEY, null);
      });
      console.log(hasFlag(argv, "--json") ? "null" : "Context scope cleared.");
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "set") {
    // Runtime first: loadConfig registers workspace-defined kinds before refs are validated.
    const runtime = createCliRuntime(argv);
    let scope = await readContextScopeInput(argv);
    try {
      scope = reconcileContextScopeViewBinding(runtime, scope);
      const current = readActiveContextScope(runtime);
      if (current?.mode === "strict" && !hasFlag(argv, "--allow-boundary-change")) {
        const boundary = resolveContextScope({ db: runtime.db, scope: current });
        const candidate = resolveContextScope({ db: runtime.db, scope });
        assertResolvedScopeInsideBoundary(boundary, candidate, "Changing the active context scope");
      }
      runtime.db.runInImmediateTransaction(() => {
        runtime.db.setUiState(AGENT_CONTEXT_SCOPE_UI_KEY, scope);
        runtime.db.setUiState(
          ACTIVE_CONTEXT_VIEW_UI_KEY,
          scope.viewId ? { viewId: scope.viewId, version: scope.viewVersion, activatedAt: nowIso() } : null
        );
      });
      printContextScope(runtime, scope, argv);
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "preview") {
    const scope = await readContextScopeInput(argv);
    const runtime = createCliRuntime(argv);
    try {
      const preview = previewContextScope(runtime.db, scope);
      const resolved = sanitizeResolvedContextForOutput(preview.resolved);
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({ ...preview, resolved, counts: resolved.counts }, null, 2));
      } else {
        console.log(`Context preview: ${resolved.counts.entities} entities, ${resolved.counts.sources} sources, ~${preview.estimatedTokens}/${preview.budget} tokens`);
        console.log(`included=${preview.included.length} proposed=${preview.proposed.length} excluded=${preview.excluded.length} stale=${preview.stale.length} out-of-scope=${preview.outOfScope.length}`);
      }
    } finally {
      runtime.close();
    }
    return;
  }

  if (subcommand === "get") {
    const runtime = createCliRuntime(argv);
    try {
      const scope = readActiveContextScope(runtime);
      if (!scope) {
        console.log(hasFlag(argv, "--json") ? "null" : "No active context scope.");
        return;
      }
      printContextScope(runtime, scope, argv);
    } finally {
      runtime.close();
    }
    return;
  }

  throw new Error("Unknown context-scope command. Use: pnpm wm context-scope get|set|preview|clear.");
}

async function contextViewCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv) ?? "list";
  const positionals = positionalValues(argv);
  const runtime = createCliRuntime(argv);
  try {
    const boundary = strictContextCommandBoundary(runtime, argv);
    if (subcommand === "list") {
      const active = getActiveContextView(runtime.db);
      const views = boundary && !boundary.allowBoundaryChange
        ? listContextViews(runtime.db).filter((view) => view.id === boundary.activeViewId)
        : listContextViews(runtime.db);
      printJsonOrSummary(argv, { views, activeViewId: active?.id }, (value) => {
        const payload = value as { views: ReturnType<typeof listContextViews>; activeViewId?: string };
        if (payload.views.length === 0) return "No saved Context views.";
        return payload.views.map((view) => `${view.id}\t${view.name}\tv${view.version}${view.id === payload.activeViewId ? "\tactive" : ""}`).join("\n");
      });
      return;
    }

    if (subcommand === "get") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      assertContextViewAvailableInsideBoundary(boundary, id ?? boundary?.activeViewId, "reading it");
      const view = id ? getContextView(runtime.db, id) : getActiveContextView(runtime.db);
      printJsonOrSummary(argv, view ?? null, (value) => value ? JSON.stringify(value, null, 2) : "No Context view found.");
      return;
    }

    if (subcommand === "clear") {
      if (boundary && !boundary.allowBoundaryChange) {
        throw new Error("Clearing an active strict context requires an explicitly confirmed boundary change.");
      }
      runtime.db.runInImmediateTransaction(() => {
        runtime.db.setUiState(ACTIVE_CONTEXT_VIEW_UI_KEY, null);
        runtime.db.setUiState(AGENT_CONTEXT_SCOPE_UI_KEY, null);
      });
      printJsonOrSummary(argv, { ok: true, activeViewId: null }, () => "Active Context view cleared.");
      return;
    }

    if (subcommand === "create") {
      const input = hasFlag(argv, "--stdin")
        ? await readJsonStdin<SaveContextViewInput>()
        : {
            name: optionValue(argv, "--name") ?? positionals.slice(1).join(" "),
            context: contextScopeFromOptions(argv)
          };
      assertContextScopeInsideBoundary(runtime, boundary, {
        ...(input.context ?? {}),
        refreshPolicy: input.refreshPolicy ?? input.context?.refreshPolicy
      }, "Creating this Context view");
      const view = createContextView(runtime.db, input);
      printJsonOrSummary(argv, view, (value) => `Created Context view ${value.id} (${value.name}) v${value.version}.`);
      return;
    }

    if (subcommand === "update") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      if (!id) throw new Error("Missing Context view id.");
      const input = hasFlag(argv, "--stdin")
        ? await readJsonStdin<UpdateContextViewInput>()
        : { name: optionValue(argv, "--name"), context: contextScopeFromOptions(argv, true) };
      assertContextViewAvailableInsideBoundary(boundary, id, "updating it");
      const current = getContextView(runtime.db, id);
      assertContextScopeInsideBoundary(runtime, boundary, {
        ...(current?.context ?? {}),
        ...(input.context ?? {}),
        refreshPolicy: input.refreshPolicy ?? input.context?.refreshPolicy ?? current?.refreshPolicy
      }, "Updating this Context view");
      const view = updateContextView(runtime.db, id, input);
      printJsonOrSummary(argv, view, (value) => `Updated Context view ${value.id} to v${value.version}.`);
      return;
    }

    if (subcommand === "rename") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      const name = optionValue(argv, "--name") ?? positionals.slice(2).join(" ");
      if (!id || !name.trim()) throw new Error("Use: context-view rename <id> --name <name>.");
      assertContextViewAvailableInsideBoundary(boundary, id, "renaming it");
      const view = updateContextView(runtime.db, id, { name });
      printJsonOrSummary(argv, view, (value) => `Renamed Context view to ${value.name}.`);
      return;
    }

    if (subcommand === "duplicate") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      if (!id) throw new Error("Missing Context view id.");
      assertContextViewAvailableInsideBoundary(boundary, id, "duplicating it");
      const view = duplicateContextView(runtime.db, id, optionValue(argv, "--name"));
      printJsonOrSummary(argv, view, (value) => `Duplicated Context view as ${value.id} (${value.name}).`);
      return;
    }

    if (subcommand === "delete") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      if (!id) throw new Error("Missing Context view id.");
      if (boundary && !boundary.allowBoundaryChange && id === boundary.activeViewId) {
        throw new Error("Deleting the active strict Context view requires an explicitly confirmed boundary change.");
      }
      assertContextViewAvailableInsideBoundary(boundary, id, "deleting it");
      const deleted = deleteContextView(runtime.db, id);
      printJsonOrSummary(argv, { ok: deleted, id }, (value) => value.ok ? `Deleted Context view ${id}.` : `Context view not found: ${id}.`);
      return;
    }

    if (subcommand === "activate") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      if (!id) throw new Error("Missing Context view id.");
      if (boundary && !boundary.allowBoundaryChange && id !== boundary.activeViewId) {
        throw new Error("Activating another Context view requires an explicitly confirmed boundary change.");
      }
      const view = activateContextView(runtime.db, id);
      const rawPreview = previewContextScope(runtime.db, view.context);
      const preview = { ...rawPreview, resolved: sanitizeResolvedContextForOutput(rawPreview.resolved) };
      printJsonOrSummary(argv, { view, preview }, (value) => `Activated ${value.view.name}: ${value.preview.resolved.counts.entities} entities, ~${value.preview.estimatedTokens} tokens.`);
      return;
    }

    if (subcommand === "compare") {
      const left = optionValue(argv, "--left") ?? positionals[1];
      const right = optionValue(argv, "--right") ?? positionals[2];
      if (!left || !right) throw new Error("Use: context-view compare <left-id> <right-id>.");
      assertContextViewAvailableInsideBoundary(boundary, left, "comparing it");
      assertContextViewAvailableInsideBoundary(boundary, right, "comparing it");
      const comparison = compareContextViews(runtime.db, left, right);
      printJsonOrSummary(argv, comparison, (value) => `added=${value.added.length} removed=${value.removed.length} role-changes=${value.roleChanges.length} policy-changes=${value.policyChanges.length}`);
      return;
    }

    if (subcommand === "preview") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      const scope = hasFlag(argv, "--stdin")
        ? await readJsonStdin<Partial<AgentContextScope>>()
        : id
          ? getContextView(runtime.db, id)?.context
          : contextScopeFromOptions(argv);
      if (!scope) throw new Error(`Context view not found: ${id}`);
      if (id) assertContextViewAvailableInsideBoundary(boundary, id, "previewing it");
      assertContextScopeInsideBoundary(runtime, boundary, scope, "Previewing this Context scope");
      const rawPreview = previewContextScope(runtime.db, scope);
      const preview = { ...rawPreview, resolved: sanitizeResolvedContextForOutput(rawPreview.resolved) };
      printJsonOrSummary(argv, preview, (value) => `included=${value.included.length} proposed=${value.proposed.length} excluded=${value.excluded.length} stale=${value.stale.length} ~${value.estimatedTokens}/${value.budget} tokens`);
      return;
    }

    if (subcommand === "suggest") {
      const payload = hasFlag(argv, "--stdin")
        ? await readJsonStdin<SuggestContextInput & { viewId?: string }>()
        : {
            topic: optionValue(argv, "--topic") ?? positionals.slice(1).join(" "),
            viewId: optionValue(argv, "--view"),
            limit: Number(optionValue(argv, "--limit") ?? 12),
            boundary: contextScopeFromOptions(argv, true)
          };
      if (payload.viewId) assertContextViewAvailableInsideBoundary(boundary, payload.viewId, "suggesting nodes for it");
      const requestedBoundary = Object.fromEntries(
        Object.entries(payload.boundary ?? {}).filter(([, value]) => value !== undefined)
      ) as Partial<AgentContextScope>;
      const effectiveSuggestionBoundary = boundary && !boundary.allowBoundaryChange && !payload.viewId
        ? {
            ...boundary.resolved.scope,
            ...requestedBoundary,
            selectedEntities: requestedBoundary.selectedEntities?.length
              ? requestedBoundary.selectedEntities
              : boundary.resolved.scope.selectedEntities
          }
        : payload.boundary;
      if (effectiveSuggestionBoundary) {
        assertContextScopeInsideBoundary(runtime, boundary, effectiveSuggestionBoundary, "Suggesting nodes in this boundary");
      }
      const suggestionInput = { ...payload, boundary: effectiveSuggestionBoundary };
      const result = payload.viewId
        ? proposeContextNodes(runtime.db, payload.viewId, suggestionInput)
        : { suggestions: suggestContextNodes(runtime.db, suggestionInput) };
      printJsonOrSummary(argv, result, (value) => `${value.suggestions.length} Context node proposal(s).`);
      return;
    }

    if (subcommand === "refresh") {
      const id = positionals[1] ?? optionValue(argv, "--view");
      if (!id) throw new Error("Missing Context view id.");
      assertContextViewAvailableInsideBoundary(boundary, id, "refreshing it");
      const result = refreshMonitoredContextView(runtime.db, id, optionValue(argv, "--topic"), Number(optionValue(argv, "--limit") ?? 12));
      printJsonOrSummary(argv, result, (value) => value.skipped ?? `${value.suggestions.length} new proposal(s) added for review.`);
      return;
    }

    throw new Error("Unknown context-view command. Use list|get|create|update|rename|duplicate|delete|activate|clear|compare|preview|suggest|refresh.");
  } finally {
    runtime.close();
  }
}

async function contextPackCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv) ?? "list";
  const positionals = positionalValues(argv);
  const runtime = createCliRuntime(argv);
  try {
    const boundary = strictContextCommandBoundary(runtime, argv);
    const enforcedBoundary = boundary && !boundary.allowBoundaryChange ? boundary : undefined;
    if (subcommand === "compile") {
      const input = hasFlag(argv, "--stdin")
        ? await readJsonStdin<CompileContextPackInput>()
        : {
            request: optionValue(argv, "--topic") ?? positionals.slice(1).join(" "),
            viewId: optionValue(argv, "--view"),
            sessionId: optionValue(argv, "--session"),
            tokenBudget: optionValue(argv, "--token-budget") ? Number(optionValue(argv, "--token-budget")) : undefined
          };
      if (boundary) {
        if (input.viewId) {
          assertContextViewAvailableInsideBoundary(boundary, input.viewId, "compiling its Context Pack");
        }
        if (!input.viewId && !input.scope) input.scope = boundary.resolved.scope;
        const viewContext = input.viewId ? getContextView(runtime.db, input.viewId)?.context : undefined;
        const requestedScope = viewContext || input.scope
          ? {
              ...(viewContext ?? input.scope),
              ...(input.scope ?? {}),
              tokenBudget: input.tokenBudget ?? input.scope?.tokenBudget ?? viewContext?.tokenBudget
            }
          : undefined;
        if (requestedScope) assertContextScopeInsideBoundary(runtime, boundary, requestedScope, "Compiling this Context Pack");
      }
      const pack = compileContextPack(runtime.db, input);
      printJsonOrSummary(argv, pack, (value) => `Context Pack ${value.id} v${value.version}: ${value.entries.length} entries, ${value.actualTokens}/${value.budget} tokens${value.truncated ? " (truncated)" : ""}.`);
      return;
    }
    if (subcommand === "get") {
      const id = positionals[1];
      if (!id) throw new Error("Missing Context Pack id.");
      const pack = runtime.db.getContextPack(id) ?? null;
      if (pack) assertContextPackInsideBoundary(runtime, enforcedBoundary, pack, "Reading this Context Pack");
      const result = pack && enforcedBoundary ? contextPackHistorySummary(pack, enforcedBoundary.resolved) : pack;
      printJsonOrSummary(argv, result, (value) => value ? `Context Pack ${value.id} v${value.version}: ${value.entries.length} entries.` : `Context Pack not found: ${id}.`);
      return;
    }
    if (subcommand === "list") {
      const requestedViewId = optionValue(argv, "--view");
      if (requestedViewId) assertContextViewAvailableInsideBoundary(boundary, requestedViewId, "listing its Context Packs");
      const filter = {
        viewId: boundary && !boundary.allowBoundaryChange ? boundary.activeViewId : requestedViewId,
        sessionId: optionValue(argv, "--session"),
        limit: Number(optionValue(argv, "--limit") ?? 50)
      };
      // Human history and explicit --summary JSON avoid selecting/parsing the
      // potentially large entries_json payload. Default JSON remains complete
      // for backward compatibility with existing agents and scripts.
      if (!hasFlag(argv, "--json") || hasFlag(argv, "--summary")) {
        const allowed = enforcedBoundary
          ? runtime.db.listContextPacks(filter).filter((pack) => {
              try {
                assertContextPackInsideBoundary(runtime, enforcedBoundary, pack, "Listing Context Packs");
                return true;
              } catch {
                return false;
              }
            }).map((pack) => contextPackSummaryFromPack(pack, enforcedBoundary.resolved))
          : runtime.db.listContextPackSummaries(filter);
        printJsonOrSummary(argv, allowed, (value) => value.map((pack) =>
          `${pack.id}\tv${pack.version}\t${pack.entryCount} entries\t${pack.actualTokens}/${pack.budget}\t${pack.request}`
        ).join("\n") || "No Context Packs.");
        return;
      }
      const packs = runtime.db.listContextPacks(filter);
      const allowed = packs.filter((pack) => {
        try {
          assertContextPackInsideBoundary(runtime, enforcedBoundary, pack, "Listing Context Packs");
          return true;
        } catch {
          return false;
        }
      });
      const result = enforcedBoundary ? allowed.map((pack) => contextPackHistorySummary(pack, enforcedBoundary.resolved)) : allowed;
      printJsonOrSummary(argv, result, (value) => value.map((pack) => `${pack.id}\tv${pack.version}\t${pack.actualTokens}/${pack.budget}\t${pack.request}`).join("\n") || "No Context Packs.");
      return;
    }
    if (subcommand === "prune") {
      const requestedViewId = optionValue(argv, "--view");
      if (requestedViewId) assertContextViewAvailableInsideBoundary(boundary, requestedViewId, "pruning its Context Packs");
      if (boundary && !boundary.allowBoundaryChange && !boundary.activeViewId) {
        throw new Error("Pruning Context Packs inside a strict boundary requires an active Context view.");
      }
      const policy: Partial<ContextPackRetentionPolicy> = {};
      const assignPolicy = (
        flag: string,
        key: keyof ContextPackRetentionPolicy,
        minimum: number
      ): void => {
        const raw = optionValue(argv, flag);
        if (raw === undefined) return;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < minimum) {
          throw new Error(`${flag} must be an integer >= ${minimum}.`);
        }
        policy[key] = value;
      };
      assignPolicy("--max-per-view", "maxPacksPerView", 1);
      assignPolicy("--max-per-session", "maxPacksPerSession", 1);
      assignPolicy("--max-age-days", "maxAgeDays", 0);
      assignPolicy("--preserve-latest", "preserveLatestPerView", 1);
      const result = runtime.db.pruneContextPacks({
        policy,
        viewId: boundary && !boundary.allowBoundaryChange ? boundary.activeViewId : requestedViewId,
        dryRun: hasFlag(argv, "--dry-run")
      });
      printJsonOrSummary(argv, result, (value) =>
        `${value.dryRun ? "Would delete" : "Deleted"} ${value.deleted}/${value.scanned} Context Pack(s); ` +
        `${value.retained} retained, ${value.protected} protected.`
      );
      return;
    }
    throw new Error("Unknown context-pack command. Use compile|get|list|prune.");
  } finally {
    runtime.close();
  }
}

function contextScopeFromOptions(argv: string[], partial = false): Partial<AgentContextScope> {
  const selectedEntities = parseScopeEntityRefs(optionValue(argv, "--entity"));
  const depth = optionValue(argv, "--depth");
  const mode = optionValue(argv, "--mode") as AgentContextScopeMode | undefined;
  const includedTypes = parseEntityKinds(optionValue(argv, "--types"));
  const tokenBudget = optionValue(argv, "--token-budget");
  if (partial) {
    return {
      selectedEntities: selectedEntities.length > 0 ? selectedEntities : undefined,
      depth: depth !== undefined ? Number(depth) : undefined,
      mode,
      includedTypes,
      tokenBudget: tokenBudget !== undefined ? Number(tokenBudget) : undefined
    } as Partial<AgentContextScope>;
  }
  return {
    selectedEntities,
    depth: depth !== undefined ? Number(depth) : 1,
    mode: mode ?? "guided",
    includedTypes,
    tokenBudget: tokenBudget !== undefined ? Number(tokenBudget) : undefined
  };
}

async function readJsonStdin<T>(): Promise<T> {
  const raw = await readStdin();
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object on stdin.");
  return parsed as T;
}

function printJsonOrSummary<T>(argv: string[], value: T, summarize: (value: T) => string): void {
  console.log(hasFlag(argv, "--json") ? JSON.stringify(value, null, 2) : summarize(value));
}

async function searchCommand(argv: string[]): Promise<void> {
  const query = positionalValues(argv).join(" ").trim();
  if (!query) {
    throw new Error("Missing search query.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const limit = Number(optionValue(argv, "--limit") ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("--limit must be an integer between 1 and 500.");
    }
    const plane = parseSearchPlane(optionValue(argv, "--plane"));
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    let productIds = scope.scope === "portfolio" ? [] : scope.includedProductIds;
    let sourceIds: string[] | undefined;
    let observationIds: string[] | undefined;
    let guidedScope = false;
    let strictContextScope = false;
    let contentSearchAllowed = true;
    if (optionValue(argv, "--context-scope") === "active") {
      const contextScope = readActiveContextScope(runtime);
      if (contextScope && contextScope.mode !== "disabled") {
        const resolved = resolveContextScope({ db: runtime.db, scope: contextScope });
        contentSearchAllowed = (contextScope.sourceAccess ?? "full") === "snippets"
          || (contextScope.sourceAccess ?? "full") === "full";
        sourceIds = contentSearchAllowed ? resolved.sourceIds : [];
        observationIds = contentSearchAllowed ? resolved.observationIds : [];
        guidedScope = contextScope.mode === "guided" && contentSearchAllowed;
        if (contextScope.mode === "strict") {
          strictContextScope = true;
          const allowedProducts = new Set(
            resolved.entities.filter((ref) => ref.kind === "product").map((ref) => ref.id)
          );
          productIds = productIds.filter((productId) => allowedProducts.has(productId));
        }
      }
    }

    const requestedPlanes: SearchResultPlane[] = plane === "all"
      ? ["accepted", "signals", "sources", "history"]
      : [plane as SearchResultPlane];
    const resultsByPlane = new Map<SearchPlane, ContextualSearchResult[]>();
    if (contentSearchAllowed) {
      for (const requestedPlane of requestedPlanes) {
        if (requestedPlane === "sources") {
          resultsByPlane.set(requestedPlane, await searchSourcePlane({
            runtime,
            argv,
            query,
            productIds,
            sourceIds,
            guidedScope,
            strictScope: strictContextScope,
            limit,
            plane: "sources",
            statuses: ["indexed"]
          }));
          continue;
        }
        if (requestedPlane === "history") {
          const observationResults = searchObservationPlane({
            runtime,
            query,
            productIds: strictContextScope || scope.scope === "portfolio" ? undefined : productIds,
            observationIds,
            guidedScope,
            limit,
            plane: "history",
            validationStatuses: ["rejected", "superseded"]
          });
          const sourceResults = await searchSourcePlane({
            runtime,
            argv,
            query,
            productIds,
            sourceIds,
            guidedScope,
            strictScope: strictContextScope,
            limit,
            plane: "history",
            statuses: ["superseded", "missing"],
            forceLexical: true
          });
          resultsByPlane.set(requestedPlane, interleaveSearchResults([observationResults, sourceResults], limit));
          continue;
        }
        resultsByPlane.set(requestedPlane, searchObservationPlane({
          runtime,
          query,
          productIds: strictContextScope || scope.scope === "portfolio" ? undefined : productIds,
          observationIds,
          guidedScope,
          limit,
          plane: requestedPlane,
          validationStatuses: requestedPlane === "accepted" ? ["accepted"] : ["captured", "proposed"]
        }));
      }
    }
    const results = interleaveSearchResults(
      requestedPlanes.map((requestedPlane) => resultsByPlane.get(requestedPlane) ?? []),
      limit
    );

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log("No results.");
      return;
    }

    for (const result of results) {
      console.log(`- [${result.plane}] ${result.title}${result.entity ? ` (${result.entity.kind}:${result.entity.id})` : ""}${result.outOfScope ? " [out of scope]" : ""}`);
      console.log(`  ${result.snippet}`);
      console.log(`  status=${result.status} revision=${result.revision?.number ?? "-"} source=${result.sourceId}${result.chunkId ? ` chunk=${result.chunkId}` : ""}`);
      if (result.provenance.repository) {
        const repo = result.provenance.repository;
        console.log(`  reference=${repo.repositoryId}:${repo.relativePath} branch=${repo.branch ?? "unversioned"} commit=${repo.commit ?? "-"} content=${repo.contentState} availability=${repo.availability} lastAttempt=${repo.lastAttemptStatus}`);
      }
      console.log(`  reason=${result.reason}`);
    }
  } finally {
    runtime.close();
  }
}

type SearchPlane = "sources" | "accepted" | "signals" | "history" | "all";
type SearchResultPlane = Exclude<SearchPlane, "all">;

interface ContextualSearchResult extends SearchResult {
  id: string;
  plane: SearchResultPlane;
  resultType: "source_chunk" | "observation";
  observationId?: string;
  packageId?: string;
  captureId?: string;
  evidenceStatus?: ObservationRecord["evidenceStatus"];
  revision?: { number?: number; status: string; supersededBy?: string };
  entity?: { kind: string; id: string };
  provenance: {
    sourceId: string;
    sourceRevision?: number;
    sourceStatus?: string;
    repository?: import("../../shared/src/types.ts").RepositorySourceProvenance;
    chunkId?: string;
    observationId?: string;
    packageId?: string;
    captureId?: string;
  };
  reason: string;
}

function parseSearchPlane(value: string | undefined): SearchPlane {
  const plane = value ?? "sources";
  if (plane === "sources" || plane === "accepted" || plane === "signals" || plane === "history" || plane === "all") {
    return plane;
  }
  throw new Error(`Unknown search plane: ${plane}. Use sources|accepted|signals|history|all.`);
}

async function searchSourcePlane(input: {
  runtime: ReturnType<typeof createCliRuntime>;
  argv: string[];
  query: string;
  productIds: string[];
  sourceIds: string[] | undefined;
  guidedScope: boolean;
  strictScope: boolean;
  limit: number;
  plane: "sources" | "history";
  statuses: string[];
  forceLexical?: boolean;
}): Promise<ContextualSearchResult[]> {
  const runSearch = async (allowlist: string[] | undefined): Promise<SearchResult[]> => {
    return input.runtime.db.search(input.query, input.productIds, input.limit, allowlist, input.statuses);
  };
  const hits = await runSearch(input.sourceIds);
  if (input.guidedScope && hits.length < input.limit) {
    const scoped = new Set(hits.map((result) =>
      `${result.chunkId}:${result.entity ? `${result.entity.kind}:${result.entity.id}` : result.productId ?? ""}`
    ));
    for (const result of await runSearch(undefined)) {
      if (hits.length >= input.limit) break;
      const key = `${result.chunkId}:${result.entity ? `${result.entity.kind}:${result.entity.id}` : result.productId ?? ""}`;
      if (!scoped.has(key)) hits.push({ ...result, outOfScope: true });
    }
  }
  const sources = new Map<string, SourceRecord>(
    input.runtime.db.listSourcesByIds(hits.map((result) => result.sourceId))
      .map((source) => [String(source.id), source as unknown as SourceRecord])
  );
  return hits.map((result) => {
    const source = sources.get(result.sourceId);
    const sourceRevision = typeof source?.revision === "number" ? source.revision : undefined;
    const supersededBy = source?.supersededBy ?? undefined;
    return {
      ...result,
      id: result.chunkId,
      plane: input.plane,
      resultType: "source_chunk",
      status: source?.status ?? result.status ?? "unknown",
      revision: source ? { number: sourceRevision, status: source.status, supersededBy } : undefined,
      entity: result.entity ?? (result.productId ? { kind: "product", id: result.productId } : undefined),
      provenance: {
        sourceId: result.sourceId,
        sourceRevision,
        sourceStatus: source?.status,
        repository: source?.repositoryProvenance,
        chunkId: result.chunkId
      },
      reason: input.plane === "history"
        ? "Matched content from a superseded or missing source revision."
        : "Matched indexed source content."
    };
  });
}

function searchObservationPlane(input: {
  runtime: ReturnType<typeof createCliRuntime>;
  query: string;
  productIds: string[] | undefined;
  observationIds: string[] | undefined;
  guidedScope: boolean;
  limit: number;
  plane: "accepted" | "signals" | "history";
  validationStatuses: ObservationRecord["validationStatus"][];
}): ContextualSearchResult[] {
  const runSearch = (allowlist: string[] | undefined): ObservationSearchResult[] => input.runtime.db.searchObservations(input.query, {
    validationStatuses: input.validationStatuses,
    observationIds: allowlist,
    productIds: input.productIds,
    limit: input.limit
  });
  const hits: Array<ObservationSearchResult & { outOfScope?: boolean }> = runSearch(input.observationIds);
  if (input.guidedScope && hits.length < input.limit) {
    const scoped = new Set(hits.map((result) => result.observation.id));
    for (const result of runSearch(undefined)) {
      if (hits.length >= input.limit) break;
      if (!scoped.has(result.observation.id)) hits.push({ ...result, outOfScope: true });
    }
  }
  const sources = new Map<string, SourceRecord>(
    input.runtime.db.listSourcesByIds(hits.map((hit) => hit.observation.sourceId))
      .map((source) => [String(source.id), source as unknown as SourceRecord])
  );
  return hits.map(({ observation, snippet, score, outOfScope }) => {
    const source = sources.get(observation.sourceId);
    const sourceRevision = typeof source?.revision === "number" ? source.revision : undefined;
    const supersededBy = source?.supersededBy ?? undefined;
    const productId = observation.productId ?? "";
    return {
      id: observation.id,
      observationId: observation.id,
      packageId: observation.packageId,
      captureId: observation.captureId,
      chunkId: observation.sourceChunkId ?? "",
      sourceId: observation.sourceId,
      productId,
      title: observation.title,
      snippet,
      score,
      status: observation.validationStatus,
      evidenceStatus: observation.evidenceStatus,
      outOfScope,
      plane: input.plane,
      resultType: "observation",
      revision: source ? { number: sourceRevision, status: source.status, supersededBy } : undefined,
      entity: observation.subjectKind && observation.subjectId
        ? { kind: observation.subjectKind, id: observation.subjectId }
        : observation.productId
          ? { kind: "product", id: observation.productId }
          : undefined,
      provenance: {
        sourceId: observation.sourceId,
        sourceRevision,
        sourceStatus: source?.status,
        repository: source?.repositoryProvenance,
        chunkId: observation.sourceChunkId,
        observationId: observation.id,
        packageId: observation.packageId,
        captureId: observation.captureId
      },
      reason: input.plane === "accepted"
        ? `Matched a human-accepted ${observation.kind} observation.`
        : input.plane === "signals"
          ? `Matched a ${observation.validationStatus} weak signal awaiting validation.`
          : `Matched a ${observation.validationStatus} observation retained for audit history.`
    };
  });
}

function interleaveSearchResults(groups: ContextualSearchResult[][], limit: number): ContextualSearchResult[] {
  const results: ContextualSearchResult[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength && results.length < limit; index += 1) {
    for (const group of groups) {
      const result = group[index];
      if (!result) continue;
      const key = `${result.resultType}:${result.id}:${result.entity ? `${result.entity.kind}:${result.entity.id}` : result.productId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
      if (results.length >= limit) break;
    }
  }
  return results;
}

async function graphChangeCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv) ?? "list";
  const positionals = positionalValues(argv);
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const graphBoundary = graphChangeBoundaryOptions(contextScope, argv);
    const access = strictSourceAccessForOutput(contextScope);
    if (subcommand === "propose") {
      assertStrictSourceAccess(contextScope, "metadata", "Proposing a graph change from accepted observations");
      const input = hasFlag(argv, "--stdin")
        ? await readJsonStdin<ProposeGraphChangeInput>()
        : {
            title: optionValue(argv, "--title"),
            reason: optionValue(argv, "--reason") ?? "",
            evidenceObservationIds: parseList(optionValue(argv, "--evidence")) ?? [],
            changes: JSON.parse(optionValue(argv, "--changes") ?? "[]")
          };
      assertGraphChangeInputInsideStrictScope(contextScope, input);
      const result = proposeGraphChange(runtime.db, input, graphBoundary);
      printJsonOrSummary(argv, result, (value) =>
        `Graph change proposal ${value.item.id}: ${value.preview.changes.length} change(s), evidence=${value.payload.evidenceObservationIds.length}.`
      );
      return;
    }
    if (subcommand === "list") {
      const status = optionValue(argv, "--status") as InboxStatus | undefined;
      const limitOption = optionValue(argv, "--limit");
      const parsedLimit = limitOption === undefined ? undefined : Number(limitOption);
      if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
        throw new Error("--limit must be a positive integer.");
      }
      const limit = parsedLimit;
      const items = access === "none"
        ? []
        : runtime.db.listInboxFiltered({
            status,
            types: ["graph_change_proposal"],
            ids: contextScope?.scope.mode === "strict" ? contextScope.inboxItemIds : undefined,
            limit
          }).map((item) => sanitizeInboxItemForOutput(item, access));
      printJsonOrSummary(argv, items, (value) => value.map((item) => `${item.id}\t${item.status}\t${item.title}`).join("\n") || "No graph change proposals.");
      return;
    }
    const id = positionals[1] ?? optionValue(argv, "--id");
    if (!id) throw new Error("Missing graph change proposal id.");
    assertGraphChangeItemInsideStrictScope(contextScope, id);
    assertStrictSourceAccess(contextScope, "metadata", "Reviewing a graph change proposal");
    if (subcommand === "get") {
      const result = getGraphChangeProposal(runtime.db, id, graphBoundary);
      const output = sanitizeInboxPreviewForOutput(result, access) as typeof result;
      printJsonOrSummary(argv, output, (value) => `${value.item.id}\t${value.item.status}\t${value.item.title}`);
      return;
    }
    if (subcommand === "preview") {
      const preview = previewGraphChangeProposal(runtime.db, id, graphBoundary);
      printJsonOrSummary(argv, graphChangePreviewForSourceAccess(runtime.db, id, preview, access), graphChangePreviewSummary);
      return;
    }
    if (subcommand === "accept") {
      assertStrictSourceAccess(contextScope, "snippets", "Accepting a graph change proposal");
      const preview = acceptGraphChangeProposal(runtime.db, id, graphBoundary);
      printJsonOrSummary(argv, graphChangePreviewForSourceAccess(runtime.db, id, preview, access), (value) => `Accepted graph change proposal ${value.proposalId}: ${value.changes.length} change(s).`);
      return;
    }
    if (subcommand === "reject") {
      const preview = rejectGraphChangeProposal(runtime.db, id, optionValue(argv, "--reason") ?? optionValue(argv, "--feedback") ?? "", graphBoundary);
      printJsonOrSummary(argv, graphChangePreviewForSourceAccess(runtime.db, id, preview, access), (value) => `Rejected graph change proposal ${value.proposalId}.`);
      return;
    }
    throw new Error("Unknown graph-change command. Use propose|list|get|preview|accept|reject.");
  } finally {
    runtime.close();
  }
}

function assertGraphChangeInputInsideStrictScope(
  resolved: ResolvedContextScope | undefined,
  input: ProposeGraphChangeInput
): void {
  if (resolved?.scope.mode !== "strict") return;
  const observations = new Set(resolved.observationIds);
  for (const id of input.evidenceObservationIds ?? []) {
    if (!observations.has(id)) throw new Error(`Graph change evidence is outside the active strict context scope: ${id}`);
  }
  const metadataOnly = new Set(resolved.metadataOnlyEntityRefs ?? []);
  const writableEntities = resolved.entities.filter((ref) => !metadataOnly.has(`${ref.kind}:${ref.id}`));
  const existingEntities = new Set(writableEntities.map((ref) => `${ref.kind}:${ref.id}`));
  const existingEntityIds = new Set(writableEntities.map((ref) => ref.id));
  const createdEntities = new Set((input.changes ?? [])
    .filter((change) => change.op === "create_entity")
    .map((change) => `${change.entity.kind}:${change.entity.id || normalizeEntityId(change.entity.label)}`));
  const createdEntityIds = new Set([...createdEntities].map((ref) => ref.slice(ref.indexOf(":") + 1)));
  for (const change of input.changes ?? []) {
    if (change.op === "update_entity") {
      const ref = `${change.entity.kind}:${change.entity.id}`;
      if (!existingEntities.has(ref)) throw new Error(`Graph change entity is outside the active strict context scope: ${ref}`);
    }
    if (change.op === "upsert_relation") {
      assertRelationInStrictScope(resolved, change.relationType);
      for (const ref of [`${change.source.kind}:${change.source.id}`, `${change.target.kind}:${change.target.id}`]) {
        if (!existingEntities.has(ref) && !createdEntities.has(ref)) {
          throw new Error(`Graph change relation endpoint is outside the active strict context scope: ${ref}`);
        }
      }
    }
    if (change.op === "create_entity" || change.op === "update_entity") {
      const draft = change.op === "create_entity" ? change.entity : change.patch;
      const entityId = change.op === "create_entity" ? (change.entity.id || normalizeEntityId(change.entity.label)) : change.entity.id;
      if (draft.parentId) {
        if (draft.parentId === entityId) throw new Error(`Graph change entity cannot be its own parent: ${entityId}`);
        if (!existingEntityIds.has(draft.parentId) && !createdEntityIds.has(draft.parentId)) {
          throw new Error(`Graph change parent is outside the active strict context scope: ${draft.parentId}`);
        }
      }
      for (const [label, ids] of [["owner", draft.ownerIds], ["contributor", draft.contributorIds]] as const) {
        for (const id of ids ?? []) {
          if (!existingEntities.has(`person:${id}`) && !createdEntities.has(`person:${id}`)) {
            throw new Error(`Graph change ${label} is outside the active strict context scope: person:${id}`);
          }
        }
      }
    }
  }
  if ((input.evidenceObservationIds ?? []).length === 0) {
    throw new Error("A graph change under a strict context requires in-scope accepted observation evidence.");
  }
}

function assertGraphChangeItemInsideStrictScope(resolved: ResolvedContextScope | undefined, id: string): void {
  if (resolved?.scope.mode === "strict" && !resolved.inboxItemIds.includes(id)) {
    throw new Error(`Graph change proposal is outside the active strict context scope: ${id}`);
  }
}

function graphChangeBoundaryOptions(resolved: ResolvedContextScope | undefined, argv: string[]) {
  if (resolved?.scope.mode !== "strict") return {};
  const metadataOnly = new Set(resolved.metadataOnlyEntityRefs ?? []);
  return {
    allowedEntityRefs: resolved.entities
      .map((ref) => `${ref.kind}:${ref.id}`)
      .filter((ref) => !metadataOnly.has(ref)),
    allowedObservationIds: resolved.observationIds,
    allowedRelationTypes: resolved.scope.allowedRelationTypes,
    allowBoundaryChange: hasFlag(argv, "--allow-boundary-change")
  };
}

function graphChangePreviewForSourceAccess(
  db: WorkMemoryDatabase,
  id: string,
  preview: ReturnType<typeof previewGraphChangeProposal>,
  access: ReturnType<typeof strictSourceAccessForOutput>
): ReturnType<typeof previewGraphChangeProposal> {
  if (access === "full") return preview;
  const item = db.getInboxItem(id);
  if (!item) return preview;
  const output = sanitizeInboxPreviewForOutput({ item, preview }, access) as { preview?: typeof preview };
  return output.preview ?? preview;
}

function graphChangePreviewSummary(value: ReturnType<typeof previewGraphChangeProposal>): string {
  const actions = value.changes.map((change) => `${change.index + 1}. ${change.action} ${change.target}`).join("\n");
  const conflicts = value.conflicts.length > 0 ? `\nConflicts: ${value.conflicts.join("; ")}` : "";
  const boundary = value.boundaryChangeRequired
    ? `\nBoundary change required: ${(value.boundaryChangeReasons ?? []).join("; ") || "new graph entities"}`
    : "";
  return `Graph change proposal ${value.proposalId} [${value.status}]${value.canAccept ? " ready" : " not ready"}\n${actions}${conflicts}${boundary}`;
}

async function inboxCommand(argv: string[]): Promise<void> {
  const subcommand = firstPositional(argv);
  if (subcommand === "recover-publications") {
    await inboxRecoverPublicationsCommand(argv);
    return;
  }
  if (subcommand === "preview") {
    inboxPreviewCommand(argv);
    return;
  }
  if (subcommand === "accept") {
    await inboxAcceptCommand(argv);
    return;
  }
  if (subcommand === "reject") {
    inboxRejectCommand(argv);
    return;
  }
  if (subcommand === "add") {
    inboxAddCommand(argv);
    return;
  }

  inboxListCommand(argv);
}

interface ValidatedWikiWriteProposal {
  packageId: string;
  observationIds: string[];
  documentationReason: NonNullable<Parameters<typeof validateWikiSynthesis>[2]["reason"]>;
  target: WikiSynthesisTarget;
  relativePath: string;
  content: string;
  synthesisKey: string;
}

interface CanonicalWikiTarget {
  subject: EntityRef;
  home: EntityRef;
  page: string;
  relativePath: string;
}

function isWikiWriteReviewPayload(payload: Record<string, unknown>): boolean {
  return payload.proposalKind === "wiki_write_review";
}

function validateCanonicalWikiTarget(
  runtime: ReturnType<typeof createCliRuntime>,
  payload: Record<string, unknown>,
  contextScope: ResolvedContextScope | undefined
): CanonicalWikiTarget | undefined {
  if (typeof payload.targetPath !== "string" || payload.targetPath.length === 0) {
    return undefined;
  }
  const subjectValue = typeof payload.wikiSubject === "string" ? payload.wikiSubject : undefined;
  const homeValue = typeof payload.wikiHome === "string" ? payload.wikiHome : undefined;
  if (!subjectValue || !homeValue || typeof payload.content !== "string") {
    throw new Error(
      "Path-only wiki proposals are disabled. " +
      "Provide a canonical wikiSubject, wikiHome, wikiPage and content."
    );
  }
  const subject = parseEntityRef(subjectValue);
  const home = parseEntityRef(homeValue);
  assertWritableEntityInStrictScope(contextScope, subject);
  assertWritableEntityInStrictScope(contextScope, home);
  const page = typeof payload.wikiPage === "string" && payload.wikiPage.trim()
    ? payload.wikiPage.trim()
    : "index.md";
  const relativePath = validateWikiPlacement(runtime.config, runtime.db, subject, home, page);
  if (payload.targetPath !== relativePath) {
    throw new Error(`Wiki proposal targetPath must be the canonical in-scope placement ${relativePath}, not ${payload.targetPath}.`);
  }
  return { subject, home, page, relativePath };
}

function validateWikiWriteReviewProposal(
  runtime: ReturnType<typeof createCliRuntime>,
  payload: Record<string, unknown>,
  contextScope: ResolvedContextScope | undefined,
  requireStoredPayloadKey: boolean
): ValidatedWikiWriteProposal {
  const packageId = requiredPayloadString(payload, "curationPackageId");
  const documentationReason = requiredPayloadString(payload, "documentationReason") as ValidatedWikiWriteProposal["documentationReason"];
  const observationIds = Array.isArray(payload.observationIds)
    ? payload.observationIds.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (observationIds.length === 0) throw new Error("A wiki write review requires accepted observationIds.");
  const subject = parseEntityRef(requiredPayloadString(payload, "wikiSubject"));
  const home = parseEntityRef(requiredPayloadString(payload, "wikiHome"));
  const page = requiredPayloadString(payload, "wikiPage");
  const content = requiredPayloadString(payload, "content", false);
  const relativePath = validateWikiPlacement(runtime.config, runtime.db, subject, home, page);
  const requestedPath = requiredPayloadString(payload, "targetPath");
  if (requestedPath !== relativePath) {
    throw new Error(`Wiki proposal targetPath must be the canonical placement ${relativePath}, not ${requestedPath}.`);
  }
  const validation = validateWikiSynthesis(runtime.db, packageId, {
    reason: documentationReason,
    evidenceObservationIds: observationIds,
    target: { subject, home, page }
  });
  if (
    validation.anchorPackage.wikiDecision !== "suggested" ||
    validation.anchorPackage.wikiSynthesisKey !== validation.synthesisKey
  ) {
    throw new Error(`Curation package ${packageId} does not control this reviewed wiki synthesis.`);
  }
  const payloadKey = typeof payload.wikiSynthesisKey === "string" ? payload.wikiSynthesisKey.trim() : undefined;
  if (payloadKey && payloadKey !== validation.synthesisKey) {
    throw new Error("Wiki proposal synthesis key does not match its live reviewed evidence and target.");
  }
  if (requireStoredPayloadKey && !payloadKey) {
    throw new Error("Wiki proposal is missing its reviewed wikiSynthesisKey.");
  }
  assertCurationPackageInsideStrictScope(contextScope, getCurationPackageDetail(runtime.db, packageId));
  assertWritableEntityInStrictScope(contextScope, validation.target.subject);
  assertWritableEntityInStrictScope(contextScope, validation.target.home);
  for (const observation of validation.evidence) {
    assertObservationInsideStrictScope(contextScope, observation);
    assertObservationEvidenceInsideStrictScope(runtime.db, contextScope, observation);
  }
  return {
    packageId,
    observationIds: validation.evidence.map((item) => item.id),
    documentationReason,
    target: validation.target,
    relativePath,
    content,
    synthesisKey: validation.synthesisKey
  };
}

function requiredPayloadString(payload: Record<string, unknown>, field: string, trim = true): string {
  const value = typeof payload[field] === "string" ? payload[field] : "";
  const normalized = trim ? value.trim() : value;
  if (!normalized.trim()) throw new Error(`Wiki proposal payload requires ${field}.`);
  return normalized;
}

function inboxAddCommand(argv: string[]): void {
  // Plain array (not module-level const): the CLI entry point runs before top-level consts initialize.
  const allowedTypes = ["wiki_proposal", "decision_candidate", "open_question", "task", "risk"];
  const type = optionValue(argv, "--type") ?? "";
  if (!allowedTypes.includes(type)) {
    throw new Error(`Invalid --type. Use: ${allowedTypes.join(", ")}.`);
  }
  const title = optionValue(argv, "--title");
  const body = optionValue(argv, "--body") ?? "";
  if (!title) {
    throw new Error("Missing --title.");
  }
  const captureId = optionValue(argv, "--capture");
  const payloadOption = optionValue(argv, "--payload");
  const payload: Record<string, unknown> = payloadOption ? JSON.parse(payloadOption) : {};
  if (captureId) {
    payload.captureId = captureId;
  }
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const sourceId = optionValue(argv, "--source");
    const entityValue = optionValue(argv, "--entity");
    if (entityValue) {
      const entity = parseEntityRef(entityValue);
      if (!runtime.db.getEntity(entity.kind, entity.id)) {
        throw new Error(`Inbox proposal entity does not exist: ${entity.kind}:${entity.id}`);
      }
      payload.entityRef = `${entity.kind}:${entity.id}`;
    }
    let productId = optionValue(argv, "--product");
    let inboxId = optionValue(argv, "--id");
    let wikiValidation: ValidatedWikiWriteProposal | undefined;
    if (type === "wiki_proposal" && isWikiWriteReviewPayload(payload)) {
      if (productId) {
        throw new Error("--product is not supported for canonical wiki proposals; wikiSubject and wikiHome are typed entity references.");
      }
      wikiValidation = validateWikiWriteReviewProposal(runtime, payload, contextScope, false);
      Object.assign(payload, {
        targetPath: wikiValidation.relativePath,
        wikiSubject: `${wikiValidation.target.subject.kind}:${wikiValidation.target.subject.id}`,
        wikiHome: `${wikiValidation.target.home.kind}:${wikiValidation.target.home.id}`,
        wikiPage: wikiValidation.target.page,
        wikiSynthesisKey: wikiValidation.synthesisKey,
        observationIds: wikiValidation.observationIds
      });
      const stableId = createStableId("inbox_wiki", [
        wikiValidation.synthesisKey,
        wikiValidation.relativePath,
        sha256(wikiValidation.content)
      ]);
      if (inboxId && inboxId !== stableId) {
        throw new Error(`Reviewed wiki proposals use the deterministic id ${stableId}; omit --id or use that value.`);
      }
      inboxId = stableId;
    }
    if (!wikiValidation) validateCanonicalWikiTarget(runtime, payload, contextScope);
    if (contextScope?.scope.mode === "strict") {
      const allowed = strictScopeSets(contextScope);
      const proposalCaptureId = captureId ?? (typeof payload.captureId === "string" ? payload.captureId : undefined);
      const payloadRefs = inspectInboxPayloadReferences(payload);
      if (proposalCaptureId && !contextScope.captureIds.includes(proposalCaptureId)) {
        throw new Error(`Inbox proposal capture is outside the active strict context scope: ${proposalCaptureId}`);
      }
      if (sourceId && !allowed.sources.has(sourceId)) {
        throw new Error(`Inbox proposal source is outside the active strict context scope: ${sourceId}`);
      }
      if (productId && !allowed.products.has(productId)) {
        throw new Error(`Inbox proposal product is outside the active strict context scope: ${productId}`);
      }
      for (const id of payloadRefs.productIds) {
        if (!allowed.products.has(id)) throw new Error(`Inbox proposal product is outside the writable active strict context scope: ${id}`);
      }
      for (const id of payloadRefs.sourceIds) {
        if (!allowed.sources.has(id)) throw new Error(`Inbox proposal source is outside the active strict context scope: ${id}`);
      }
      for (const id of payloadRefs.captureIds) {
        if (!contextScope.captureIds.includes(id)) throw new Error(`Inbox proposal capture is outside the active strict context scope: ${id}`);
      }
      for (const ref of payloadRefs.entityRefs) {
        if (!allowed.writableEntities.has(ref)) throw new Error(`Inbox proposal entity is outside the writable active strict context scope: ${ref}`);
      }
      for (const id of payloadRefs.observationIds) {
        if (!contextScope.observationIds.includes(id)) throw new Error(`Inbox proposal observation is outside the active strict context scope: ${id}`);
      }
      for (const relationType of payloadRefs.relationTypes) {
        assertRelationInStrictScope(contextScope, relationType);
      }
      if (
        !proposalCaptureId && !sourceId && !productId
        && payloadRefs.productIds.length === 0
        && payloadRefs.sourceIds.length === 0
        && payloadRefs.captureIds.length === 0
        && payloadRefs.entityRefs.length === 0
        && payloadRefs.observationIds.length === 0
      ) {
        throw new Error("An inbox proposal under a strict context must reference an in-scope capture, source, product, entity or observation.");
      }
    }
    const id = runtime.db.insertInboxItem({
      id: inboxId,
      type: type as InboxItem["type"],
      title,
      body,
      status: "pending",
      sourceId,
      productId,
      payload
    });
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ id, type, title, ...(wikiValidation ? { wikiSynthesisKey: wikiValidation.synthesisKey } : {}) }, null, 2));
      return;
    }
    console.log(`Inbox item created: ${id} [${type}] ${title}`);
  } finally {
    runtime.close();
  }
}

function inboxListCommand(argv: string[]): void {
    const status = optionValue(argv, "--status") as InboxStatus | undefined;
    const runtime = createCliRuntime(argv);
    try {
      const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
      const contextScope = activeResolvedContextScope(runtime, argv);
      const access = strictSourceAccessForOutput(contextScope);
      const limit = Math.max(1, Math.min(500, Math.floor(Number(optionValue(argv, "--limit") ?? 80)) || 80));
      const entityRefs = parseScopeEntityRefs(optionValue(argv, "--entities") ?? optionValue(argv, "--entity"));
      for (const ref of entityRefs) {
        if (!runtime.db.getEntity(ref.kind, ref.id)) {
          throw new Error(`Inbox entity does not exist: ${ref.kind}:${ref.id}`);
        }
      }
      // An empty product scope still includes product-less review items. Strict
      // allowlists and the limit are pushed into SQLite before payload hydration.
      const items = access === "none"
        ? []
        : runtime.db.listInboxFiltered({
            status: status ?? "pending",
            productIds: entityRefs.length > 0 ? undefined : scope.includedProductIds,
            entityRefs: entityRefs.length > 0 ? entityRefs : undefined,
            ids: contextScope?.scope.mode === "strict" ? contextScope.inboxItemIds : undefined,
            limit
          }).map((item) => sanitizeInboxItemForOutput(item, access));
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
    if (items.length === 0) {
      console.log("Inbox is empty.");
      return;
    }

    for (const item of items) {
      const targetPath = typeof item.payload.targetPath === "string" ? ` -> ${item.payload.targetPath}` : "";
      console.log(`- ${item.id} [${item.type}] ${item.title}${targetPath}`);
      if (item.body) console.log(`  ${item.body}`);
    }
  } finally {
    runtime.close();
  }
}

function inboxPreviewCommand(argv: string[]): void {
  const id = positionalValues(argv)[1];
  if (!id) {
    throw new Error("Missing inbox item id.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const item = requireInboxItem(runtime.db.getInboxItem(id), id);
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && !contextScope.inboxItemIds.includes(id)) {
      throw new Error(`Inbox item is outside the active strict context scope: ${id}`);
    }
    const access = strictSourceAccessForOutput(contextScope);
    if (access === "none") {
      throw new Error("Inbox preview is disabled by the active strict sourceAccess=none policy.");
    }
    if (item.type === "graph_change_proposal") {
      const preview = previewGraphChangeProposal(runtime.db, id, graphChangeBoundaryOptions(contextScope, argv));
      const output = sanitizeInboxPreviewForOutput({ item, preview }, access);
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      console.log(graphChangePreviewSummary(preview));
      return;
    }
    const reviewedWiki = item.type === "wiki_proposal" && isWikiWriteReviewPayload(item.payload)
      ? validateWikiWriteReviewProposal(runtime, item.payload, contextScope, true)
      : undefined;
    const canonicalWiki = reviewedWiki
      ? undefined
      : validateCanonicalWikiTarget(runtime, item.payload, contextScope);
    const wikiSubject = typeof item.payload.wikiSubject === "string" ? item.payload.wikiSubject : undefined;
    const wikiHome = typeof item.payload.wikiHome === "string" ? item.payload.wikiHome : undefined;
    if (wikiSubject && wikiHome && typeof item.payload.content === "string") {
      const subject = reviewedWiki?.target.subject ?? canonicalWiki?.subject ?? parseEntityRef(wikiSubject);
      const home = reviewedWiki?.target.home ?? canonicalWiki?.home ?? parseEntityRef(wikiHome);
      const page = reviewedWiki?.target.page ?? canonicalWiki?.page ?? (typeof item.payload.wikiPage === "string" ? item.payload.wikiPage : "index.md");
      const relativePath = reviewedWiki?.relativePath ?? canonicalWiki?.relativePath ?? validateWikiPlacement(runtime.config, runtime.db, subject, home, page);
      const absolutePath = path.join(globalWikiRoot(runtime.config), ...relativePath.split("/"));
      const preview = {
        action: fs.existsSync(absolutePath) ? "replace" : "create",
        targetPath: absolutePath,
        content: item.payload.content
      };
      const output = sanitizeInboxPreviewForOutput({ item, preview }, access) as {
        item: InboxItem;
        preview?: { action?: string; targetPath?: string; content?: string };
      };
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify(output, null, 2));
        return;
      }
      if (access === "metadata") {
        console.log(`${item.id} [${item.type}] ${item.title} — content hidden by sourceAccess=metadata.`);
      } else {
        printInboxAction(
          output.item,
          output.preview?.action ?? preview.action,
          output.preview?.targetPath ?? preview.targetPath,
          output.preview?.content ?? preview.content
        );
      }
      return;
    }

    const productId = item.productId ?? optionValue(argv, "--product");
    const preview = productId
      ? previewWikiPatch(findProduct(runtime.config.products, productId), item)
      : previewGlobalWikiPatch(runtime.config, item);
    const output = sanitizeInboxPreviewForOutput({ item, preview }, access) as {
      item: InboxItem;
      preview?: { action?: string; targetPath?: string; content?: string; reason?: string };
    };
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    if (access === "metadata") {
      console.log(`${item.id} [${item.type}] ${item.title} — content hidden by sourceAccess=metadata.`);
    } else {
      printInboxAction(
        output.item,
        output.preview?.action ?? preview.action,
        output.preview?.targetPath ?? preview.targetPath,
        output.preview?.content ?? preview.content,
        output.preview?.reason ?? preview.reason
      );
    }
  } finally {
    runtime.close();
  }
}

async function inboxAcceptCommand(argv: string[]): Promise<void> {
  const id = positionalValues(argv)[1];
  if (!id) {
    throw new Error("Missing inbox item id.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const item = requireInboxItem(runtime.db.getInboxItem(id), id);
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && !contextScope.inboxItemIds.includes(id)) {
      throw new Error(`Inbox item is outside the active strict context scope: ${id}`);
    }
    if (item.status !== "pending") {
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({
          itemId: id,
          type: item.type,
          status: item.status,
          alreadyFinal: true
        }, null, 2));
      } else {
        console.log(`Inbox item ${id} is already ${item.status}.`);
      }
      return;
    }
    // Human acceptance must never publish or mutate from a proposal whose
    // substantive content is hidden by the active source policy.
    assertStrictSourceAccess(contextScope, "snippets", "Accepting an Inbox proposal");
    if (item.type === "graph_change_proposal") {
      const preview = acceptGraphChangeProposal(runtime.db, id, graphChangeBoundaryOptions(contextScope, argv));
      const output = graphChangePreviewForSourceAccess(runtime.db, id, preview, strictSourceAccessForOutput(contextScope));
      if (hasFlag(argv, "--json")) console.log(JSON.stringify(output, null, 2));
      else console.log(`Accepted graph change proposal ${id}: ${preview.changes.length} change(s).`);
      return;
    }
    const reviewedWiki = item.type === "wiki_proposal" && isWikiWriteReviewPayload(item.payload)
      ? validateWikiWriteReviewProposal(runtime, item.payload, contextScope, true)
      : undefined;
    const canonicalWiki = reviewedWiki
      ? undefined
      : validateCanonicalWikiTarget(runtime, item.payload, contextScope);

    // Review-after-write items (agent-curated wiki) carry no patch to apply: accepting
    // them simply acknowledges the review.
    if (typeof item.payload.targetPath !== "string" || item.payload.targetPath.length === 0) {
      runtime.db.updateInboxStatus(id, "accepted");
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({
          itemId: id,
          type: item.type,
          status: "accepted",
          action: "acknowledge"
        }, null, 2));
      } else {
        console.log(`Accepted: ${id}`);
      }
      return;
    }

    const wikiSubject = typeof item.payload.wikiSubject === "string" ? item.payload.wikiSubject : undefined;
    const wikiHome = typeof item.payload.wikiHome === "string" ? item.payload.wikiHome : undefined;
    if (wikiSubject && wikiHome && typeof item.payload.content === "string") {
      const subject = reviewedWiki?.target.subject ?? canonicalWiki?.subject ?? parseEntityRef(wikiSubject);
      const home = reviewedWiki?.target.home ?? canonicalWiki?.home ?? parseEntityRef(wikiHome);
      const page = reviewedWiki?.target.page ?? canonicalWiki?.page ?? (typeof item.payload.wikiPage === "string" ? item.payload.wikiPage : "index.md");
      const relativePath = reviewedWiki?.relativePath ?? canonicalWiki?.relativePath ?? validateWikiPlacement(runtime.config, runtime.db, subject, home, page);
      const absolutePath = path.join(globalWikiRoot(runtime.config), ...relativePath.split("/"));
      const action = fs.existsSync(absolutePath) ? "replace" : "create";
      const previousContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : undefined;
      let written: ReturnType<typeof writeEntityWikiPage> | undefined;
      runtime.db.updateInboxPayload(id, {
        ...item.payload,
        publication: {
          state: "publishing",
          startedAt: nowIso(),
          target: relativePath,
          subject: `${subject.kind}:${subject.id}`,
          home: `${home.kind}:${home.id}`
        }
      });
      try {
        written = writeEntityWikiPage(runtime.config, runtime.db, {
          subject,
          home,
          page,
          content: item.payload.content
        });
        // Acceptance publishes into private memory only. Product contribution and
        // private Git backup are separate, explicitly targeted operations.
        const entityRefs = wikiPublicationEntityRefs(subject, home, contextScope);
        const ingested = await ingestSource(runtime, {
          filePath: written.absolutePath,
          entityRefs,
          sourceType: "wiki_page",
          createInbox: false
        });
        if (contextScope?.scope.mode === "strict") {
          constrainPublishedWikiSourceEntities(runtime.db, ingested.source.id, entityRefs);
        }
      } catch (error) {
        // Compensate private file writes. Source revision activation happens
        // only after indexing succeeds, so a failed ingest leaves the prior revision active.
        if (previousContent === undefined) {
          if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath);
        } else {
          atomicWriteFile(absolutePath, previousContent);
        }
        try {
          runtime.db.updateInboxPayload(id, {
            ...item.payload,
            publication: {
              state: "failed",
              failedAt: nowIso(),
              target: relativePath,
              error: error instanceof Error ? error.message : String(error)
            }
          });
        } catch {
          // Keep the original publication error; the pending item remains retryable.
        }
        throw error;
      }
      runtime.db.runInTransaction(() => {
        const publishedSourceId = ingestedSourceId(runtime.db, written!.absolutePath);
        runtime.db.updateInboxPayload(id, {
          ...item.payload,
          publication: {
            state: "published",
            publishedAt: nowIso(),
            target: relativePath,
            sourceId: publishedSourceId
          }
        });
        runtime.db.updateInboxStatus(id, "accepted");
      });
      appendWikiLog(runtime.config, "publish", `${subject.kind}:${subject.id} -> ${relativePath} (inbox ${id})`);
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({
          itemId: id,
          type: item.type,
          status: "accepted",
          action,
          subject,
          home,
          page,
          targetPath: relativePath,
          sourceId: ingestedSourceId(runtime.db, written.absolutePath)
        }, null, 2));
      } else {
        printInboxAction(item, action, written.absolutePath, written.content);
        console.log(`Accepted: ${id}`);
      }
      return;
    }

    const productId = item.productId ?? optionValue(argv, "--product");
    const product = productId ? findProduct(runtime.config.products, productId) : undefined;
    const planned = product ? previewWikiPatch(product, item) : previewGlobalWikiPatch(runtime.config, item);
    const plannedTargetPath = planned.targetPath;
    const previousContent = plannedTargetPath && fs.existsSync(plannedTargetPath)
      ? fs.readFileSync(plannedTargetPath, "utf8")
      : undefined;
    runtime.db.updateInboxPayload(id, {
      ...item.payload,
      publication: { state: "publishing", startedAt: nowIso(), target: planned.targetPath }
    });
    let preview: typeof planned;
    let sourceId: string | undefined;
    try {
      preview = product ? applyWikiPatch(product, item) : applyGlobalWikiPatch(runtime.config, item);
      if (preview.targetPath && product) {
        const ingested = await ingestSource(runtime, {
          filePath: preview.targetPath,
          entityRefs: [{ kind: "product", id: product.id }],
          sourceType: "wiki_page",
          createInbox: false
        });
        sourceId = ingested.source.id;
      }
    } catch (error) {
      if (plannedTargetPath) {
        if (previousContent === undefined) {
          if (fs.existsSync(plannedTargetPath)) fs.rmSync(plannedTargetPath);
        } else {
          atomicWriteFile(plannedTargetPath, previousContent);
        }
      }
      try {
        runtime.db.updateInboxPayload(id, {
          ...item.payload,
          publication: {
            state: "failed",
            failedAt: nowIso(),
            target: planned.targetPath,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      } catch {
        // Keep the original error and leave the proposal pending for retry.
      }
      throw error;
    }
    runtime.db.runInTransaction(() => {
      runtime.db.updateInboxPayload(id, {
        ...item.payload,
        publication: { state: "published", publishedAt: nowIso(), target: preview.targetPath, sourceId }
      });
      runtime.db.updateInboxStatus(id, "accepted");
    });

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({
        itemId: id,
        type: item.type,
        status: "accepted",
        action: preview.action,
        targetPath: preview.targetPath,
        sourceId
      }, null, 2));
    } else {
      printInboxAction(item, preview.action, preview.targetPath, preview.content, preview.reason);
      console.log(`Accepted: ${id}`);
    }
  } finally {
    runtime.close();
  }
}

/**
 * Resume publications that were durably journaled before a process interruption.
 * Every write/index step is idempotent, so replay completes the accepted human
 * decision without inventing a second source revision.
 */
async function inboxRecoverPublicationsCommand(argv: string[]): Promise<void> {
  const runtime = createCliRuntime(argv);
  let pending: InboxItem[] = [];
  try {
    pending = runtime.db.listInboxFiltered({ status: "pending", types: ["wiki_proposal"] })
      .filter((item) => (item.payload.publication as { state?: string } | undefined)?.state === "publishing");
  } finally {
    runtime.close();
  }
  const recovered: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const configPath = optionValue(argv, "--config");
  for (const item of pending) {
    const nested = ["accept", item.id, ...(configPath ? ["--config", configPath] : [])];
    const originalLog = console.log;
    try {
      console.log = () => undefined;
      await inboxAcceptCommand(nested);
      recovered.push(item.id);
    } catch (error) {
      failed.push({ id: item.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      console.log = originalLog;
    }
  }
  const report = { pending: pending.length, recovered, failed };
  if (hasFlag(argv, "--json")) console.log(JSON.stringify(report, null, 2));
  else console.log(`Publication recovery: ${recovered.length}/${pending.length} completed, ${failed.length} failed.`);
}

function ingestedSourceId(db: WorkMemoryDatabase, absolutePath: string): string | undefined {
  const row = db.db.prepare("SELECT id FROM sources WHERE logical_key = ? AND status = 'indexed' ORDER BY revision DESC LIMIT 1")
    .get(absolutePath) as { id: string } | undefined;
  return row?.id;
}

function wikiPublicationEntityRefs(
  subject: EntityRef,
  home: EntityRef,
  contextScope?: ResolvedContextScope
): EntityRef[] {
  const refs = [...new Map(
    [subject, home].map((ref) => [`${ref.kind}:${ref.id}`, ref])
  ).values()];
  if (contextScope?.scope.mode !== "strict") return refs;
  const allowed = new Set(contextScope.entities.map((entity) => `${entity.kind}:${entity.id}`));
  return refs.filter((ref) => allowed.has(`${ref.kind}:${ref.id}`));
}

function constrainPublishedWikiSourceEntities(
  db: WorkMemoryDatabase,
  sourceId: string,
  entityRefs: EntityRef[]
): void {
  const allowed = new Set(entityRefs.map((ref) => `${ref.kind}:${ref.id}`));
  for (const ref of db.listEntityRefsForSource(sourceId)) {
    if (!allowed.has(`${ref.kind}:${ref.id}`)) {
      db.db.prepare(`
        DELETE FROM source_entities
        WHERE source_id = ? AND entity_kind = ? AND entity_id = ?
      `).run(sourceId, ref.kind, ref.id);
    }
  }
}

function inboxRejectCommand(argv: string[]): void {
  const id = positionalValues(argv)[1];
  if (!id) {
    throw new Error("Missing inbox item id.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const item = requireInboxItem(runtime.db.getInboxItem(id), id);
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && !contextScope.inboxItemIds.includes(id)) {
      throw new Error(`Inbox item is outside the active strict context scope: ${id}`);
    }
    if (item.status !== "pending") {
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({
          itemId: id,
          type: item.type,
          status: item.status,
          alreadyFinal: true
        }, null, 2));
      } else {
        console.log(`Inbox item ${id} is already ${item.status}.`);
      }
      return;
    }
    const feedback = optionValue(argv, "--feedback");
    assertStrictSourceAccess(contextScope, "metadata", "Rejecting an Inbox proposal");
    if (item.type === "graph_change_proposal") {
      const preview = rejectGraphChangeProposal(
        runtime.db,
        id,
        feedback ?? optionValue(argv, "--reason") ?? "",
        graphChangeBoundaryOptions(contextScope, argv)
      );
      const output = graphChangePreviewForSourceAccess(runtime.db, id, preview, strictSourceAccessForOutput(contextScope));
      if (hasFlag(argv, "--json")) console.log(JSON.stringify(output, null, 2));
      else console.log(`Rejected graph change proposal ${id}.`);
      return;
    }
    if (feedback && feedback.trim()) {
      runtime.db.updateInboxPayload(id, {
        ...item.payload,
        rejectionFeedback: {
          message: feedback.trim(),
          recordedAt: nowIso()
        }
      });
    }
    runtime.db.updateInboxStatus(id, "rejected");
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({
        itemId: id,
        type: item.type,
        status: "rejected",
        feedbackRecorded: Boolean(feedback?.trim())
      }, null, 2));
    } else {
      console.log(`Rejected: ${id}`);
      if (feedback && feedback.trim()) {
        console.log("Feedback recorded.");
      }
    }
  } finally {
    runtime.close();
  }
}

function bmadCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);
  if (subcommand !== "readiness") {
    throw new Error("Unknown BMAD command. Use: pnpm wm bmad readiness [--product <id>].");
  }

  const runtime = createCliRuntime(argv);
  try {
    const requestedScope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    const contextScope = activeResolvedContextScope(runtime, argv);
    const strictProductIds = contextScope?.scope.mode === "strict"
      ? new Set(contextScope.entities.filter((entity) => entity.kind === "product").map((entity) => entity.id))
      : undefined;
    const scope = strictProductIds
      ? { ...requestedScope, includedProductIds: requestedScope.includedProductIds.filter((id) => strictProductIds.has(id)) }
      : requestedScope;
    if (scope.includedProductIds.length === 0) {
      const emptyReport = {
        productIds: [],
        score: 0,
        status: "blocked",
        counts: {
          pendingInbox: 0,
          openQuestions: 0,
          decisionCandidates: 0,
          risks: 0,
          openTasks: 0,
          unvalidatedConcepts: 0,
          unreviewedSources: 0,
          candidateWikiPages: 0
        },
        signals: [],
        message: "No products configured for this scope."
      };
      console.log(hasFlag(argv, "--json") ? JSON.stringify(emptyReport, null, 2) : emptyReport.message);
      return;
    }

    if (contextScope?.scope.mode === "strict" && (contextScope.scope.sourceAccess ?? "full") === "none") {
      const unavailableReport = {
        productIds: scope.includedProductIds,
        score: 0,
        status: "unavailable",
        counts: {
          pendingInbox: 0,
          openQuestions: 0,
          decisionCandidates: 0,
          risks: 0,
          openTasks: 0,
          unvalidatedConcepts: 0,
          unreviewedSources: 0,
          candidateWikiPages: 0
        },
        signals: [],
        unavailable: true,
        message: "BMAD readiness is unavailable because the active strict context has sourceAccess=none."
      };
      console.log(hasFlag(argv, "--json") ? JSON.stringify(unavailableReport, null, 2) : unavailableReport.message);
      return;
    }

    const report = buildBmadReadinessReport(runtime.db, scope.includedProductIds);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`BMAD readiness: ${report.score}/100 (${report.status})`);
    console.log(`Products: ${report.productIds.join(", ")}`);
    for (const signal of report.signals) {
      console.log(`- ${signal.label}: ${signal.detail} [${signal.status}]`);
    }
  } finally {
    runtime.close();
  }
}

function okrCommand(argv: string[]): void {
  const subcommand = firstPositional(argv) ?? "list";
  const rawId = positionalValues(argv)[1];
  const id = rawId === undefined ? undefined : normalizeEntityId(rawId);
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (subcommand === "list") {
      const snapshot = buildOutcomeSnapshot(runtime.db, { contextScope });
      const okrs = [...snapshot.missions.flatMap((mission) => mission.okrs), ...snapshot.standaloneOkrs];
      printJsonOrSummary(argv, okrs, (value) => value.map((okr) => `${okr.id}\t[${okr.definition.status}] ${okr.label} · ${formatPercent(okr.progress)} · ${okr.kpis.length} KPI`).join("\n") || "No OKRs.");
      return;
    }
    if (!id) throw new Error(`Missing OKR id for ${subcommand}.`);
    if (subcommand === "show") {
      assertEntityInStrictScope(contextScope, { kind: "okr", id });
      const snapshot = buildOutcomeSnapshot(runtime.db, { contextScope, entity: { kind: "okr", id } });
      const okr = [...snapshot.missions.flatMap((mission) => mission.okrs), ...snapshot.standaloneOkrs][0];
      if (!okr) throw new Error(`OKR not found: ${id}`);
      printJsonOrSummary(argv, okr, (value) => `${value.label} [${value.definition.status}] · ${formatPercent(value.progress)} · ${value.keyResults.length} key result(s) · ${value.kpis.length} KPI(s)`);
      return;
    }
    if (subcommand !== "upsert") throw new Error("Unknown OKR command. Use: okr list|show|upsert.");
    const existing = runtime.db.getEntity("okr", id);
    const allowBoundaryChange = hasFlag(argv, "--allow-boundary-change");
    const missionOption = optionValue(argv, "--mission");
    const clearMission = hasFlag(argv, "--clear-mission") || missionOption === "none";
    if (hasFlag(argv, "--clear-mission") && missionOption !== undefined) {
      throw new Error("Use either --mission <id> or --clear-mission, not both.");
    }
    const missionId: string | null | undefined = clearMission ? null : missionOption;
    const kpiIds = parseList(optionValue(argv, "--kpi"));
    const rawKeyResults = optionValue(argv, "--key-results");
    const keyResults = rawKeyResults === undefined ? undefined : parseJsonArrayOption<OkrKeyResult>(rawKeyResults, "--key-results");
    const referencedKpiIds = [...new Set([
      ...(kpiIds ?? []),
      ...(keyResults ?? []).map((keyResult) => keyResult.kpiId).filter((value): value is string => Boolean(value))
    ])];
    const existingOkrRelations = existing ? runtime.db.listEntityRelations({ kind: "okr", id }) : [];
    if (!allowBoundaryChange) {
      if (!existing && contextScope?.scope.mode === "strict") {
        throw new Error(`Creating OKR okr:${id} would broaden the active strict context; explicit boundary-change confirmation is required.`);
      }
      assertWritableEntityInStrictScope(contextScope, { kind: "okr", id });
      if (typeof missionId === "string") {
        assertWritableEntityInStrictScope(contextScope, { kind: "mission", id: missionId });
        assertRelationInStrictScope(contextScope, "has_okr");
      }
      for (const kpiId of referencedKpiIds) {
        assertWritableEntityInStrictScope(contextScope, { kind: "kpi", id: kpiId });
        assertRelationInStrictScope(contextScope, "measured_by");
      }
      if (missionId !== undefined) {
        for (const relation of existingOkrRelations.filter((candidate) =>
          candidate.relationType === "has_okr"
          && candidate.targetKind === "okr"
          && candidate.targetId === id
          && (candidate.sourceKind !== "mission" || candidate.sourceId !== missionId)
        )) {
          assertWritableEntityInStrictScope(contextScope, { kind: relation.sourceKind, id: relation.sourceId });
          assertRelationInStrictScope(contextScope, relation.relationType);
        }
      }
      if (kpiIds !== undefined || keyResults !== undefined) {
        const retainedKpis = new Set(referencedKpiIds);
        for (const relation of existingOkrRelations.filter((candidate) =>
          candidate.relationType === "measured_by"
          && candidate.sourceKind === "okr"
          && candidate.sourceId === id
          && candidate.targetKind === "kpi"
          && !retainedKpis.has(candidate.targetId)
        )) {
          assertWritableEntityInStrictScope(contextScope, { kind: "kpi", id: relation.targetId });
          assertRelationInStrictScope(contextScope, relation.relationType);
        }
      }
    }
    const current = readOkrDefinition(existing);
    const status = optionValue(argv, "--status") as OkrStatus | undefined;
    const execute = () => upsertOkr(runtime.db, {
        id,
        label: optionValue(argv, "--label") ?? existing?.label ?? id,
        objective: optionValue(argv, "--objective") ?? optionValue(argv, "--description"),
        missionId,
        status: status ?? current.status,
        periodStart: optionValue(argv, "--period-start"),
        periodEnd: optionValue(argv, "--period-end"),
        keyResults,
        kpiIds
      });
    const result = hasFlag(argv, "--fail-if-exists")
      ? runtime.db.runInImmediateTransaction(() => {
          if (runtime.db.getEntity("okr", id)) throw new Error("This OKR id is unavailable. Choose another id.");
          return execute();
        })
      : execute();
    printJsonOrSummary(argv, result, (value) => `Upserted OKR ${value.id}: ${value.label} · ${value.keyResults.length} key result(s) · ${value.kpis.length} KPI(s).`);
  } finally {
    runtime.close();
  }
}

function kpiCommand(argv: string[]): void {
  const subcommand = firstPositional(argv) ?? "list";
  const rawId = positionalValues(argv)[1];
  const id = rawId === undefined ? undefined : normalizeEntityId(rawId);
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (subcommand === "list") {
      const snapshot = buildOutcomeSnapshot(runtime.db, { contextScope });
      printJsonOrSummary(argv, snapshot.kpis, (value) => value.map((kpi) => `${kpi.id}\t${kpi.label} · ${formatKpiValue(kpi.latest?.value, kpi.definition.unit)} · ${kpi.trend}${kpi.stale ? " · stale" : ""}`).join("\n") || "No KPIs.");
      return;
    }
    if (!id) throw new Error(`Missing KPI id for ${subcommand}.`);
    if (subcommand === "show") {
      assertEntityInStrictScope(contextScope, { kind: "kpi", id });
      const snapshot = buildOutcomeSnapshot(runtime.db, { contextScope, entity: { kind: "kpi", id } });
      const kpi = snapshot.kpis.find((item) => item.id === id);
      if (!kpi) throw new Error(`KPI not found: ${id}`);
      printJsonOrSummary(argv, kpi, (value) => `${value.label}: ${formatKpiValue(value.latest?.value, value.definition.unit)} · ${value.trend}${value.stale ? " · stale" : ""}`);
      return;
    }
    if (subcommand === "archive" || subcommand === "restore") {
      const existing = runtime.db.getEntity("kpi", id);
      if (!existing) throw new Error(`KPI not found: ${id}`);
      if (!hasFlag(argv, "--allow-boundary-change")) {
        assertWritableEntityInStrictScope(contextScope, { kind: "kpi", id });
      }
      const lifecycleStatus = subcommand === "archive" ? "archived" : "active";
      const updated = runtime.db.upsertEntity({ id, kind: "kpi", status: lifecycleStatus });
      printJsonOrSummary(
        argv,
        { id: updated.id, label: updated.label, lifecycleStatus: updated.status },
        (value) => `${subcommand === "archive" ? "Archived" : "Restored"} KPI ${value.id}: ${value.label}. Measurement history is unchanged.`
      );
      return;
    }
    if (subcommand === "measure") {
      const value = requiredFiniteOption(argv, "--value");
      const sourceId = optionValue(argv, "--source");
      const observationId = optionValue(argv, "--observation");
      assertWritableEntityInStrictScope(contextScope, { kind: "kpi", id });
      if (sourceId && contextScope?.scope.mode === "strict" && !contextScope.sourceIds.includes(sourceId)) {
        throw new Error(`KPI measurement source is outside the active strict context scope: ${sourceId}`);
      }
      if (observationId && contextScope?.scope.mode === "strict" && !contextScope.observationIds.includes(observationId)) {
        throw new Error(`KPI measurement observation is outside the active strict context scope: ${observationId}`);
      }
      if (sourceId || observationId) assertStrictSourceAccess(contextScope, "metadata", "Recording a sourced KPI measurement");
      const measuredAt = optionValue(argv, "--measured-at") ?? optionValue(argv, "--at") ?? new Date().toISOString();
      assertDateInsideStrictScope(contextScope, measuredAt, "KPI measurement");
      const result = recordKpiMeasurement(runtime.db, {
        kpiId: id,
        value,
        measuredAt,
        sourceId,
        observationId,
        note: optionValue(argv, "--note")
      });
      printJsonOrSummary(argv, sanitizeKpiMeasurement(result, contextScope), (entry) => `Recorded ${formatKpiValue(entry.value, runtime.db.getEntity("kpi", id)?.metadata?.outcome && typeof runtime.db.getEntity("kpi", id)?.metadata?.outcome === "object" ? String((runtime.db.getEntity("kpi", id)?.metadata?.outcome as Record<string, unknown>).unit ?? "value") : "value")} for KPI ${id} at ${entry.measuredAt}.`);
      return;
    }
    if (subcommand === "compare") {
      assertEntityInStrictScope(contextScope, { kind: "kpi", id });
      const deliveryDate = optionValue(argv, "--delivery-date") ?? optionValue(argv, "--at");
      if (!deliveryDate) throw new Error("KPI comparison requires --delivery-date <ISO date>.");
      const result = compareKpiBeforeAfter(runtime.db, id, deliveryDate, { contextScope });
      printJsonOrSummary(argv, result, (value) => `${value.kpi.label}: ${value.before?.value ?? "?"} before, ${value.after?.value ?? "?"} after, delta ${value.delta ?? "?"}; ${value.assessment}; causality ${value.causality}.`);
      return;
    }
    if (subcommand !== "upsert") throw new Error("Unknown KPI command. Use: kpi list|show|upsert|measure|compare|archive|restore.");
    const existing = runtime.db.getEntity("kpi", id);
    const allowBoundaryChange = hasFlag(argv, "--allow-boundary-change");
    const okrIds = parseList(optionValue(argv, "--okr"));
    const existingKpiRelations = existing ? runtime.db.listEntityRelations({ kind: "kpi", id }) : [];
    if (!allowBoundaryChange) {
      if (!existing && contextScope?.scope.mode === "strict") {
        throw new Error(`Creating KPI kpi:${id} would broaden the active strict context; explicit boundary-change confirmation is required.`);
      }
      assertWritableEntityInStrictScope(contextScope, { kind: "kpi", id });
      for (const okrId of okrIds ?? []) {
        assertWritableEntityInStrictScope(contextScope, { kind: "okr", id: okrId });
        assertRelationInStrictScope(contextScope, "measured_by");
      }
      if (okrIds !== undefined) {
        const retainedOkrs = new Set(okrIds);
        for (const relation of existingKpiRelations.filter((candidate) =>
          candidate.relationType === "measured_by"
          && candidate.sourceKind === "okr"
          && candidate.targetKind === "kpi"
          && candidate.targetId === id
          && !retainedOkrs.has(candidate.sourceId)
        )) {
          assertWritableEntityInStrictScope(contextScope, { kind: "okr", id: relation.sourceId });
          assertRelationInStrictScope(contextScope, relation.relationType);
        }
      }
    }
    const current = existing ? (existing.metadata?.outcome as Record<string, unknown> | undefined) : undefined;
    const direction = (optionValue(argv, "--direction") ?? current?.direction ?? "increase") as KpiDirection;
    const execute = () => upsertKpi(runtime.db, {
        id,
        label: optionValue(argv, "--label") ?? existing?.label ?? id,
        description: optionValue(argv, "--description"),
        unit: optionValue(argv, "--unit") ?? String(current?.unit ?? "value"),
        direction,
        targetValue: optionalFiniteOption(argv, "--target") ?? finiteRecordValue(current?.targetValue),
        targetMin: optionalFiniteOption(argv, "--target-min") ?? finiteRecordValue(current?.targetMin),
        targetMax: optionalFiniteOption(argv, "--target-max") ?? finiteRecordValue(current?.targetMax),
        staleAfterDays: optionalFiniteOption(argv, "--stale-after") ?? finiteRecordValue(current?.staleAfterDays),
        okrIds
      });
    const result = hasFlag(argv, "--fail-if-exists")
      ? runtime.db.runInImmediateTransaction(() => {
          if (runtime.db.getEntity("kpi", id)) throw new Error("This KPI id is unavailable. Choose another id.");
          return execute();
        })
      : execute();
    printJsonOrSummary(argv, result, (value) => `Upserted KPI ${value.id}: ${value.label} [${value.definition.direction}] ${value.definition.unit}.`);
  } finally {
    runtime.close();
  }
}

function outcomeCommand(argv: string[]): void {
  const subcommand = firstPositional(argv) ?? "dashboard";
  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (subcommand === "dashboard" || subcommand === "list") {
      const entityOption = optionValue(argv, "--entity");
      const entity = entityOption ? parseEntityRef(entityOption) : undefined;
      if (entity) assertEntityInStrictScope(contextScope, entity);
      const snapshot = buildOutcomeSnapshot(runtime.db, { contextScope, entity });
      printJsonOrSummary(argv, snapshot, (value) => `Outcomes — ${value.summary.missions} mission(s), ${value.summary.okrs} OKR(s), ${value.summary.atRiskOkrs} at risk, ${value.summary.kpis} KPI(s), ${value.alerts.length} alert(s).`);
      return;
    }
    if (subcommand === "gaps") {
      const snapshot = buildOutcomeSnapshot(runtime.db, { contextScope });
      printJsonOrSummary(argv, snapshot.alerts, (value) => value.map((alert) => `${alert.severity}\t${alert.entity.kind}:${alert.entity.id}\t${alert.message}`).join("\n") || "No outcome gaps.");
      return;
    }
    if (subcommand !== "link") throw new Error("Unknown outcome command. Use: outcome dashboard|gaps|link.");
    const work = parseOutcomeWorkRef(optionValue(argv, "--work"));
    const okrId = optionValue(argv, "--okr");
    if (!okrId) throw new Error("Outcome link requires --okr <id>.");
    const allowBoundaryChange = hasFlag(argv, "--allow-boundary-change");
    if (!allowBoundaryChange) {
      if (work.kind === "task") {
        if (contextScope?.scope.mode === "strict" && !contextScope.taskIds.includes(work.id)) {
          throw new Error(`Task is outside the active strict context scope: ${work.id}`);
        }
      } else {
        assertWritableEntityInStrictScope(contextScope, work);
      }
      assertWritableEntityInStrictScope(contextScope, { kind: "okr", id: okrId });
      assertRelationInStrictScope(contextScope, "contributes_to");
    }
    const result = linkContribution(runtime.db, {
      work,
      okrId,
      expectedImpact: optionValue(argv, "--expected-impact") ?? "",
      causalHypothesis: optionValue(argv, "--hypothesis"),
      keyResultIds: parseList(optionValue(argv, "--key-results")),
      confidence: optionalFiniteOption(argv, "--confidence")
    });
    printJsonOrSummary(argv, result, (value) => `${value.work.kind}:${value.work.id} contributes_to okr:${value.okrId} — expected: ${value.expectedImpact}; causality remains a hypothesis.`);
  } finally {
    runtime.close();
  }
}

function parseOutcomeWorkRef(value: string | undefined): EntityRef {
  if (!value || !value.includes(":")) throw new Error("Outcome link requires --work project:id, feature:id or task:id.");
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!["project", "feature", "task"].includes(kind) || !id) throw new Error("Outcome work must be project:id, feature:id or task:id.");
  return { kind, id };
}

function parseJsonArrayOption<T>(value: string, label: string): T[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed as T[];
}

function optionalFiniteOption(argv: string[], name: string): number | undefined {
  const raw = optionValue(argv, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function requiredFiniteOption(argv: string[], name: string): number {
  const value = optionalFiniteOption(argv, name);
  if (value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}

function finiteRecordValue(value: unknown): number | undefined {
  const number = Number(value);
  return value === undefined || value === null || !Number.isFinite(number) ? undefined : number;
}

function assertDateInsideStrictScope(scope: ResolvedContextScope | undefined, value: string, label: string): void {
  if (scope?.scope.mode !== "strict" || !scope.scope.timeRange) return;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new Error(`${label} date must be valid ISO.`);
  const from = scope.scope.timeRange.from ? Date.parse(scope.scope.timeRange.from) : undefined;
  const toValue = scope.scope.timeRange.to;
  const to = toValue
    ? Date.parse(toValue) + (/^\d{4}-\d{2}-\d{2}$/.test(toValue) ? 86_400_000 - 1 : 0)
    : undefined;
  if ((from !== undefined && at < from) || (to !== undefined && at > to)) {
    throw new Error(`${label} date is outside the active strict time range: ${value}`);
  }
}

function sanitizeKpiMeasurement<T extends { note?: string; sourceId?: string; observationId?: string }>(
  measurement: T,
  scope: ResolvedContextScope | undefined
): T {
  if (scope?.scope.mode !== "strict") return measurement;
  const access = scope.scope.sourceAccess ?? "full";
  if (access === "full") return measurement;
  const sanitized = { ...measurement };
  sanitized.note = access === "snippets" ? measurement.note?.slice(0, 500) : undefined;
  if (access === "none") {
    sanitized.sourceId = undefined;
    sanitized.observationId = undefined;
  }
  return sanitized;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "unknown progress" : `${Math.round(value)}%`;
}

function formatKpiValue(value: number | undefined, unit: string): string {
  return value === undefined ? "no measurement" : `${Number(value.toFixed(4))} ${unit}`;
}

function todayCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const entityRef = optionValue(argv, "--entity");
    const entity = entityRef ? parseEntityRef(entityRef) : undefined;
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && entity && !contextScope.entities.some((candidate) => candidate.kind === entity.kind && candidate.id === entity.id)) {
      throw new Error(`Entity is outside the active strict context scope: ${entity.kind}:${entity.id}`);
    }
    const dueWindow = optionValue(argv, "--due-window");
    const model = buildTodayModel({
      config: runtime.config,
      context: runtime.context,
      db: runtime.db,
      entity: entity ? { kind: entity.kind, id: entity.id } : undefined,
      assignee: optionValue(argv, "--assignee"),
      dueWindowDays: dueWindow ? Number(dueWindow.replace(/d$/i, "")) : undefined,
      includeAgent: !hasFlag(argv, "--no-agent"),
      section: optionValue(argv, "--section"),
      contextScope: contextScope?.scope.mode === "strict" ? contextScope : undefined
    });

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(model, null, 2));
      return;
    }

    const s = model.summary;
    console.log(`Today — due soon ${s.dueSoon} (overdue ${s.overdue}) · blocked ${s.blocked} · inbox ${s.inboxPending} · agent ${s.agentTasks} · OKR ${s.okrs} (${s.atRiskOkrs} at risk) · KPI ${s.kpis} (${s.kpisChanged} changed, ${s.staleKpis} stale) · readiness ${s.readinessScore}/100`);
    for (const mission of model.outcomes.missions) {
      printTodaySection(`Mission · ${mission.label}`, mission.okrs.map((okr) =>
        `${okr.label} [${okr.definition.status}] · ${formatPercent(okr.progress)} · ${okr.contributions.length} contribution(s) · ${okr.kpis.length} KPI(s)${okr.atRisk ? ` · risk: ${okr.riskReasons.join(" ")}` : ""}`
      ));
    }
    printTodaySection("Outcome attention", model.outcomes.alerts.map((alert) => `${alert.severity}: ${alert.entity.label} — ${alert.message}`));
    printTodaySection("Due soon", model.dueSoon.map(formatTodayItem));
    for (const group of model.activeWork) {
      printTodaySection(`Active · ${group.entity.label}`, group.items.map(formatTodayItem));
    }
    printTodaySection("Blocked", model.blocked.map(formatTodayItem));
    printTodaySection("Agent queue", model.agentQueue.map(formatTodayItem));
    printTodaySection("Objectives", model.objectives.map((capture) => `${capture.title} [${capture.contentType}] → ${capture.primaryEntity.kind}:${capture.primaryEntity.id}`));
    printTodaySection("Upcoming reviews", model.upcomingReviews.map((capture) => `${capture.title} [${capture.contentType}]`));
    printTodaySection("Inbox to review", model.inbox.map((item) => `${item.title} [${item.type}]`));
    for (const note of model.notes) {
      console.log(`note: ${note}`);
    }
  } finally {
    runtime.close();
  }
}

function formatTodayItem(item: { title: string; status?: string; priority?: string; deadline?: string; reasons: string[] }): string {
  const meta = [item.status, item.priority, item.deadline ? `due ${item.deadline}` : undefined, item.reasons.join("/")]
    .filter(Boolean)
    .join(" · ");
  return `${item.title}${meta ? ` (${meta})` : ""}`;
}

function printTodaySection(title: string, lines: string[]): void {
  if (lines.length === 0) {
    return;
  }
  console.log(`\n${title}:`);
  for (const line of lines) {
    console.log(`  - ${line}`);
  }
}

async function uiStateCommand(argv: string[]): Promise<void> {
  const action = firstPositional(argv) || "get";
  const key = positionalValues(argv)[1] || optionValue(argv, "--key");
  if (!key) {
    throw new Error("Missing ui-state key.");
  }

  const runtime = createCliRuntime(argv);
  try {
    if (action === "get") {
      const value = runtime.db.getUiState(key) ?? null;
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    if (action === "set") {
      const raw = hasFlag(argv, "--stdin") ? await readStdin() : optionValue(argv, "--value");
      if (raw === undefined) {
        throw new Error("Missing ui-state value. Use --value or --stdin.");
      }
      runtime.db.setUiState(key, JSON.parse(raw));
      if (hasFlag(argv, "--json")) {
        console.log(JSON.stringify({ ok: true, key }, null, 2));
      } else {
        console.log(`Saved ui state: ${key}`);
      }
      return;
    }
    throw new Error("Unknown ui-state action. Use get or set.");
  } finally {
    runtime.close();
  }
}

function tasksCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);
  if (subcommand === "create") {
    tasksCreateCommand(argv);
    return;
  }
  if (subcommand === "update") {
    tasksUpdateCommand(argv);
    return;
  }
  if (subcommand === "archive" || subcommand === "delete" || subcommand === "remove") {
    tasksArchiveCommand(argv);
    return;
  }

  const runtime = createCliRuntime(argv);
  try {
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    // A portfolio also contains personal tasks without a configured product.
    if (scope.includedProductIds.length === 0 && scope.scope !== "portfolio") {
      if (hasFlag(argv, "--json")) {
        console.log("[]");
      } else {
        console.log("No products configured for this scope.");
      }
      return;
    }

    let tasks = listTaskReadModel(runtime.db, scope.includedProductIds);
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict") {
      const allowed = new Set(contextScope.taskIds);
      tasks = tasks
        .filter((task) => allowed.has(task.id))
        .map((task) => sanitizeTaskForStrictScope(task, contextScope));
    }
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }
    if (tasks.length === 0) {
      console.log("No tasks.");
      return;
    }
    for (const task of tasks) {
      console.log(`- ${task.title} [${task.status}]`);
      if (task.body) {
        console.log(`  ${task.body}`);
      }
    }
  } finally {
    runtime.close();
  }
}

function tasksCreateCommand(argv: string[]): void {
  const values = positionalValues(argv);
  const title = optionValue(argv, "--title") ?? values.slice(1).join(" ").trim();
  if (!title) {
    throw new Error("Missing task title.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const requestedProduct = optionValue(argv, "--product");
    const scopedProducts = contextScope?.scope.mode === "strict"
      ? contextScope.entities.filter((ref) => ref.kind === "product").map((ref) => ref.id)
      : [];
    const productId = requestedProduct && !isClearValue(requestedProduct)
      ? findProduct(runtime.config.products, requestedProduct).id
      : contextScope?.scope.mode === "strict"
        ? (scopedProducts.length === 1 ? scopedProducts[0] : undefined)
        : runtime.context.activeProduct?.id ?? (runtime.config.products.length === 1 ? runtime.config.products[0].id : undefined);
    const sourceOption = optionValue(argv, "--source");
    const input = {
      title,
      body: optionValue(argv, "--body") ?? optionValue(argv, "--description") ?? "",
      productId,
      sourceId: sourceOption && !isClearValue(sourceOption) ? sourceOption : undefined,
      status: optionValue(argv, "--status") ?? "open",
      priority: optionValue(argv, "--priority") ?? "medium",
      assignee: optionValue(argv, "--assignee") ?? "me",
      deadline: optionValue(argv, "--deadline"),
      notes: optionValue(argv, "--notes"),
      origin: optionValue(argv, "--origin") ?? "manual",
      links: parseTaskLinks(collectOptionValues(argv, "--link"))
    };
    validateTaskUpdate(input);
    if (contextScope?.scope.mode === "strict") {
      assertTaskInsideStrictScope(contextScope, input);
    }
    // validateTaskUpdate guarantees the string fields hold the narrowed union values.
    const task = createTask(runtime.db, input as TaskDraft);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    console.log(`Created task: ${task.id}`);
    console.log(`Title: ${task.title}`);
    console.log(`Product: ${task.productId ?? "none"}`);
    console.log(`Status: ${task.status}`);
    console.log(`Priority: ${task.priority}`);
    console.log(`Assignee: ${task.assignee}`);
    if (task.deadline) {
      console.log(`Deadline: ${task.deadline}`);
    }
  } finally {
    runtime.close();
  }
}

function tasksUpdateCommand(argv: string[]): void {
  const taskId = positionalValues(argv)[1];
  if (!taskId) {
    throw new Error("Missing task id.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    if (contextScope?.scope.mode === "strict" && !contextScope.taskIds.includes(taskId)) {
      throw new Error(`Task is outside the active strict context scope: ${taskId}`);
    }
    const existingTask = listTaskReadModel(runtime.db, contextScope?.scope.mode === "strict" ? [] : scope.includedProductIds)
      .find((candidate) => candidate.id === taskId);
    if (!existingTask) {
      throw new Error(`Task not found in current scope: ${taskId}`);
    }
    const input = {
      taskId,
      title: optionValue(argv, "--title"),
      body: optionValue(argv, "--body") ?? optionValue(argv, "--description"),
      status: optionValue(argv, "--status"),
      priority: optionValue(argv, "--priority"),
      assignee: optionValue(argv, "--assignee"),
      deadline: optionValue(argv, "--deadline"),
      notes: optionValue(argv, "--notes"),
      productId: optionValue(argv, "--product"),
      sourceId: optionValue(argv, "--source"),
      links: collectOptionValues(argv, "--link").length ? parseTaskLinks(collectOptionValues(argv, "--link")) : undefined
    };
    validateTaskUpdate(input);
    if (contextScope?.scope.mode === "strict") {
      const nextTask = {
        productId: input.productId === undefined
          ? existingTask.productId
          : isClearValue(input.productId) ? undefined : input.productId,
        sourceId: input.sourceId === undefined
          ? existingTask.sourceId
          : isClearValue(input.sourceId) ? undefined : input.sourceId,
        links: input.links ?? existingTask.links
      };
      assertTaskInsideStrictScope(contextScope, nextTask);
    }
    const task = updateTask(runtime.db, input);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    console.log(`Updated task: ${task.id}`);
    if (task.title) {
      console.log(`Title: ${task.title}`);
    }
    if (task.body) {
      console.log(`Description: ${task.body}`);
    }
    if (task.status) {
      console.log(`Status: ${task.status}`);
    }
    if (task.priority) {
      console.log(`Priority: ${task.priority}`);
    }
    if (task.assignee) {
      console.log(`Assignee: ${task.assignee}`);
    }
    if (task.deadline) {
      console.log(`Deadline: ${task.deadline}`);
    }
  } finally {
    runtime.close();
  }
}

function tasksArchiveCommand(argv: string[]): void {
  const taskId = positionalValues(argv)[1];
  if (!taskId) {
    throw new Error("Missing task id.");
  }

  const runtime = createCliRuntime(argv);
  try {
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && !contextScope.taskIds.includes(taskId)) {
      throw new Error(`Task is outside the active strict context scope: ${taskId}`);
    }
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    const task = listTaskReadModel(runtime.db, contextScope?.scope.mode === "strict" ? [] : scope.includedProductIds)
      .find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`Task not found in current scope: ${taskId}`);
    }
    archiveTask(runtime.db, taskId);
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify({ archived: true, taskId }, null, 2));
      return;
    }
    console.log(`Archived task: ${taskId}`);
  } finally {
    runtime.close();
  }
}

function conceptsCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const limit = Number(optionValue(argv, "--limit") ?? 25);
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    if (scope.includedProductIds.length === 0) {
      console.log("No products configured for this scope.");
      return;
    }
    const concepts = runtime.db.listConcepts(scope.includedProductIds, limit);
    if (concepts.length === 0) {
      console.log("No concepts.");
      return;
    }

    for (const concept of concepts) {
      console.log(`- ${concept.canonicalName} [${concept.conceptType}] status=${concept.status} mentions=${concept.mentionCount ?? 0}`);
      if (concept.description) {
        console.log(`  ${concept.description}`);
      }
    }
  } finally {
    runtime.close();
  }
}

function clampMaxChars(value: number): number {
  if (!Number.isFinite(value)) {
    return 8000;
  }
  return Math.max(500, Math.min(20000, Math.round(value)));
}

function sourceShowCommand(argv: string[]): void {
  const sourceId = positionalValues(argv)[1];
  if (!sourceId) {
    throw new Error("Missing source id. Use: pnpm wm sources show <source-id> [--max-chars 8000] [--json].");
  }
  const runtime = createCliRuntime(argv);
  try {
    const source = runtime.db.getSource(sourceId);
    if (!source) {
      console.log(hasFlag(argv, "--json") ? "null" : `No source ${sourceId}.`);
      return;
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && !contextScope.sourceIds.includes(sourceId)) {
      throw new Error(`Source is outside the active strict context scope: ${sourceId}`);
    }
    if (contextScope && contextScope.scope.sourceAccess !== "full") {
      throw new Error(`Full source access is disabled by the active context policy (${contextScope.scope.sourceAccess}).`);
    }
    const maxChars = clampMaxChars(Number(optionValue(argv, "--max-chars") ?? 8000));
    const chunks = runtime.db.listChunksForSource(sourceId);
    const full = chunks.map((chunk) => String(chunk.content ?? "")).join("\n\n");
    const truncated = full.length > maxChars;
    const content = truncated ? full.slice(0, maxChars) : full;
    const payload = {
      ...source,
      chunkCount: chunks.length,
      truncated,
      content,
      chunks: chunks.map((chunk) => ({ id: chunk.id, chunkIndex: chunk.chunkIndex, tokenCount: chunk.tokenCount }))
    };
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`# ${source.title} (${source.sourceType})`);
    console.log(`source=${source.id} status=${source.status} chunks=${chunks.length}${truncated ? " (truncated)" : ""}`);
    console.log("");
    console.log(content);
  } finally {
    runtime.close();
  }
}

function sourceShowChunkCommand(argv: string[]): void {
  const chunkId = positionalValues(argv)[1];
  if (!chunkId) {
    throw new Error("Missing chunk id. Use: pnpm wm sources show-chunk <chunk-id> [--json].");
  }
  const runtime = createCliRuntime(argv);
  try {
    const chunk = runtime.db.getChunk(chunkId);
    if (!chunk) {
      console.log(hasFlag(argv, "--json") ? "null" : `No chunk ${chunkId}.`);
      return;
    }
    const contextScope = activeResolvedContextScope(runtime, argv);
    if (contextScope?.scope.mode === "strict" && !contextScope.sourceIds.includes(String(chunk.sourceId))) {
      throw new Error(`Chunk is outside the active strict context scope: ${chunkId}`);
    }
    if (contextScope && contextScope.scope.sourceAccess !== "full") {
      throw new Error(`Full source access is disabled by the active context policy (${contextScope.scope.sourceAccess}).`);
    }
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(chunk, null, 2));
      return;
    }
    console.log(`# ${chunk.sourceTitle} (chunk ${chunk.chunkIndex})`);
    console.log(`chunk=${chunk.id} source=${chunk.sourceId}`);
    console.log("");
    console.log(String(chunk.content ?? ""));
  } finally {
    runtime.close();
  }
}

function sourcesCommand(argv: string[]): void {
  const subcommand = firstPositional(argv);
  if (subcommand === "show") {
    sourceShowCommand(argv);
    return;
  }
  if (subcommand === "show-chunk") {
    sourceShowChunkCommand(argv);
    return;
  }

  const runtime = createCliRuntime(argv);
  try {
    const limit = Number(optionValue(argv, "--limit") ?? 80);
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    const contextScope = activeResolvedContextScope(runtime, argv);
    const access = strictSourceAccessForOutput(contextScope);
    if (contextScope?.scope.mode === "strict" && access === "none") {
      console.log(hasFlag(argv, "--json") ? "[]" : "No sources: sourceAccess=none is active.");
      return;
    }
    const strictProductIds = contextScope?.scope.mode === "strict"
      ? new Set(contextScope.entities.filter((entity) => entity.kind === "product").map((entity) => entity.id))
      : undefined;
    const productIds = strictProductIds
      ? scope.includedProductIds.filter((productId) => strictProductIds.has(productId))
      : scope.includedProductIds;
    const strictSourceIds = contextScope?.scope.mode === "strict" ? contextScope.sourceIds : undefined;
    if (strictSourceIds && strictSourceIds.length === 0) {
      console.log(hasFlag(argv, "--json") ? "[]" : "No sources in the active strict context.");
      return;
    }
    const sourceBoundarySql = strictSourceIds ? `AND s.id IN (${strictSourceIds.map(() => "?").join(", ")})` : "";
    const legacyProductSql = !strictSourceIds && productIds.length > 0
      ? `AND EXISTS (
          SELECT 1 FROM source_entities scoped
          WHERE scoped.source_id = s.id
            AND scoped.entity_kind = 'product'
            AND scoped.entity_id IN (${productIds.map(() => "?").join(", ")})
        )`
      : "";
    const rows = runtime.db.db
      .prepare(`
        SELECT
          s.id,
          s.title,
          s.source_type AS sourceType,
          s.origin,
          s.origin_uri AS originUri,
          s.raw_path AS rawPath,
          s.content_hash AS contentHash,
          s.captured_at AS capturedAt,
          s.language,
          s.status,
          s.updated_at AS updatedAt,
          COUNT(DISTINCT sc.id) AS chunkCount
        FROM sources s
        LEFT JOIN source_chunks sc ON sc.source_id = s.id
        WHERE s.status = 'indexed'
          ${legacyProductSql}
          ${sourceBoundarySql}
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        LIMIT ?
      `)
      .all(
        ...(!strictSourceIds ? productIds : []),
        ...(strictSourceIds ?? []),
        limit
      ) as Array<Record<string, unknown>>;

    const genericRows = rows.map((row) => {
      const entityRefs = runtime.db.listEntityRefsForSource(String(row.id));
      const legacyProduct = entityRefs.find((ref) => ref.kind === "product");
      return {
        ...row,
        entity: entityRefs[0],
        entityRefs,
        ...(legacyProduct ? { productId: legacyProduct.id } : {})
      };
    });
    const safeRows = sanitizeSourceListRowsForOutput(genericRows, access);

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(safeRows, null, 2));
      return;
    }
    if (safeRows.length === 0) {
      console.log("No sources.");
      return;
    }
    for (const source of safeRows as Array<{ title: string; sourceType: string; entityRefs?: EntityRef[]; chunkCount: number; rawPath?: string }>) {
      const refs = source.entityRefs?.map((ref) => `${ref.kind}:${ref.id}`).join(",") || "none";
      console.log(`- ${source.title} [${source.sourceType}] entities=${refs} chunks=${source.chunkCount}`);
      if (source.rawPath) {
        console.log(`  ${source.rawPath}`);
      }
    }
  } finally {
    runtime.close();
  }
}

function graphCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const limit = Number(optionValue(argv, "--limit") ?? 25);
    const scope = resolveScope(runtime.config, runtime.context, parseScopeOptions(argv));
    if (scope.includedProductIds.length === 0) {
      console.log("No products configured for this scope.");
      return;
    }
    const relations = runtime.db.listGraphRelations(scope.includedProductIds, limit);
    if (relations.length === 0) {
      console.log("No graph relations.");
      return;
    }

    for (const relation of relations) {
      console.log(`- ${relation.subject} --${relation.predicate}--> ${relation.object}`);
      console.log(`  status=${relation.status} confidence=${relation.confidence.toFixed(2)} source=${relation.sourceId ?? "unknown"}`);
    }
  } finally {
    runtime.close();
  }
}

function graphViewCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const requestedScope = parseScopeOptions(argv);
    const contextScope = optionValue(argv, "--context-scope") === "active"
      ? readActiveContextScope(runtime)
      : undefined;
    const resolvedContext = contextScope && contextScope.mode !== "disabled"
      ? resolveContextScope({ db: runtime.db, scope: contextScope })
      : undefined;
    const strictContext = resolvedContext?.scope.mode === "strict" ? resolvedContext : undefined;
    const configuredProductIds = new Set(runtime.config.products.map((product) => product.id));
    const requestedProductIds = new Set(
      resolveScope(runtime.config, runtime.context, requestedScope).includedProductIds
    );
    const strictProductIds = strictContext
      ? strictContext.entities
          .filter((entity) =>
            entity.kind === "product" && configuredProductIds.has(entity.id) && requestedProductIds.has(entity.id)
          )
          .map((entity) => entity.id)
      : undefined;
    const buildScope = strictProductIds
      ? { scope: "manual-selection" as const, include: strictProductIds }
      : requestedScope;
    let model = buildGraphViewModel({
      config: runtime.config,
      context: runtime.context,
      db: runtime.db,
      ...buildScope,
      maxNodes: Number(optionValue(argv, "--max-nodes") ?? 150),
      maxEdges: Number(optionValue(argv, "--max-edges") ?? 300),
      // Graphify operates on repository paths and code nodes that are not part
      // of an entity-defined strict boundary. Do not read or refresh it before
      // the strict projection has been established.
      includeGraphify: !strictContext && !hasFlag(argv, "--no-graphify"),
      refreshGraphify: !strictContext && hasFlag(argv, "--refresh-graphify"),
      graphifyCommand: optionValue(argv, "--graphify-command") ? path.resolve(optionValue(argv, "--graphify-command") as string) : undefined,
      filters: {
        entityKinds: parseList(optionValue(argv, "--entity-kind")),
        contentTypes: parseList(optionValue(argv, "--content-type")),
        ingestionStatuses: parseList(optionValue(argv, "--ingestion-status")),
        relationTypes: parseList(optionValue(argv, "--relation-type"))
      },
      focus: parseGraphFocus(optionValue(argv, "--focus")),
      contextScope: resolvedContext
    });

    if (resolvedContext && contextScope) {
      model = applyContextScopeToGraphView(model, resolvedContext);
      const metadataOnlyCount = resolvedContext.metadataOnlyEntityRefs?.length ?? 0;
      const contentPlaneAllowed = contextScope.mode !== "strict" || contextScope.sourceAccess !== "none";
      model.contextScope = {
        mode: contextScope.mode,
        selectedEntities: contextScope.selectedEntities.map((ref) => `${ref.kind}:${ref.id}`),
        counts: {
          entities: resolvedContext.counts.entities,
          captures: contentPlaneAllowed ? resolvedContext.counts.captures : 0,
          sources: contentPlaneAllowed ? resolvedContext.counts.sources : 0,
          metadataOnly: metadataOnlyCount
        },
        instruction: contextScopeInstruction(contextScope)
      };
    }

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(model, null, 2));
      return;
    }

    console.log(`Graph view: ${model.nodes.length} nodes, ${model.edges.length} edges`);
    console.log(`Scope: ${model.scope} (${model.includedProductIds.join(", ") || "none"})`);
    for (const diagnostic of model.diagnostics ?? []) {
      console.log(`- ${diagnostic.provider} [${diagnostic.status}]: ${diagnostic.message}`);
    }
  } finally {
    runtime.close();
  }
}

function parseGraphFocus(value: string | undefined): { kind: EntityKind; id: string } | undefined {
  if (!value) {
    return undefined;
  }
  return parseEntityRef(value);
}

async function diagnoseCommand(argv: string[]): Promise<void> {
  const runtime = createCliRuntime(argv);
  try {
    const sourceCount = runtime.db.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    const chunkCount = runtime.db.db.prepare("SELECT COUNT(*) AS count FROM source_chunks").get() as { count: number };
    const inboxCount = runtime.db.db.prepare("SELECT COUNT(*) AS count FROM memory_inbox WHERE status = 'pending'").get() as { count: number };
    const result = {
      configPath: runtime.config.configPath,
      workspaceRoot: runtime.config.workspaceRoot,
      databasePath: runtime.config.storage.databasePath,
      products: runtime.config.products.map((product) => product.id),
      activeProductId: runtime.context.activeProduct?.id,
      search: { mode: "full-text", index: "SQLite FTS5" },
      counts: { sources: sourceCount.count, chunks: chunkCount.count, pendingInbox: inboxCount.count }
    };
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Config: ${result.configPath}`);
    console.log(`Workspace: ${result.workspaceRoot}`);
    console.log(`Database: ${result.databasePath}`);
    console.log(`Products: ${result.products.join(", ") || "none"}`);
    console.log(`Search: ${result.search.index}`);
    console.log(`Sources: ${result.counts.sources}, chunks: ${result.counts.chunks}, pending inbox: ${result.counts.pendingInbox}`);
  } finally {
    runtime.close();
  }
}

async function smokeIngestCommand(argv: string[]): Promise<void> {
  const runtime = createCliRuntime(argv);
  try {
    if (optionValue(argv, "--product")) {
      throw new Error("--product is no longer supported for smoke ingestion; use --entity kind:id.");
    }
    const entityValue = optionValue(argv, "--entity");
    if (!entityValue) throw new Error("Smoke ingestion requires --entity kind:id.");
    const entity = parseEntityRef(entityValue);
    if (!runtime.db.getEntity(entity.kind, entity.id)) {
      throw new Error(`Smoke ingestion entity does not exist: ${entity.kind}:${entity.id}`);
    }
    const memoryRoot = path.resolve(runtime.config.workspaceRoot, runtime.config.workspace.memoryRoot);
    const smokeDir = path.join(memoryRoot, "smoke-tests");
    fs.mkdirSync(smokeDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(smokeDir, `oneagent-ingest-smoke-${stamp}.md`);
    const content = [
      "# OneAgent ingestion smoke test",
      "",
      `Entity: ${entity.kind}:${entity.id}`,
      `Created: ${new Date().toISOString()}`,
      "",
      "## Decision",
      "",
      "Decision: keep OneAgent ingestion observable with source counts, chunks and inbox proposal diagnostics.",
      "",
      "## Task",
      "",
      "Task: verify that this smoke source appears in the Sources view after ingestion.",
      ""
    ].join("\n");
    fs.writeFileSync(filePath, content, "utf8");

    const result = await ingestSource(runtime, {
      filePath,
      entityRefs: [entity],
      sourceType: "raw_user_input"
    });
    const output = {
      ok: true,
      entity,
      filePath,
      source: {
        id: result.source.id,
        title: result.source.title,
        sourceType: result.source.sourceType,
        status: result.source.status
      },
      chunks: result.chunks.length,
      insights: result.insights.length,
      inboxProposals: result.inboxItemIds.length
    };

    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log("OneAgent ingestion smoke test: ok");
    console.log(`Entity: ${output.entity.kind}:${output.entity.id}`);
    console.log(`File: ${output.filePath}`);
    console.log(`Source: ${output.source.id}`);
    console.log(`Chunks: ${output.chunks}`);
    console.log(`Inbox proposals: ${output.inboxProposals}`);
  } finally {
    runtime.close();
  }
}

async function rebuildCommand(argv: string[]): Promise<void> {
  const runtime = createCliRuntime(argv);
  try {
    const result = await rebuildFromCaptures(runtime, { reingest: !hasFlag(argv, "--no-reingest") });
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Rebuilt from captures: ${result.capturesDir}`);
    console.log(`Scanned: ${result.scanned}, rebuilt: ${result.rebuilt}, reingested: ${result.reingested}, skipped: ${result.skipped}, failed: ${result.failed}`);
    for (const file of result.files.filter((entry) => entry.status === "failed")) {
      console.log(`- failed: ${file.path}${file.error ? ` (${file.error})` : ""}`);
    }
  } finally {
    runtime.close();
  }
}

async function memoryCommand(argv: string[]): Promise<void> {
  if (hasFlag(argv, "--context-scope")) {
    throw new Error("Memory commands are workspace administration commands; they cannot be used as scoped agent reads.");
  }
  const action = firstPositional(argv);
  if (action === "preview-private" || action === "publish-private") {
    const source = optionValue(argv, "--from");
    const branch = optionValue(argv, "--branch");
    const reviewed = optionValue(argv, "--review");
    if (!source || !branch || (action === "publish-private" && !reviewed)) {
      throw new Error(`memory ${action} requires --from <private-export-directory> --branch <branch>${action === "publish-private" ? " --review <digest>" : ""}.`);
    }
    if (action === "preview-private") {
      const report = await previewPrivatePublication(requireConfigPath(argv), source, branch);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(report, null, 2) : [
        `Private publication preview: ${report.repository.name} (${report.branch})`,
        `Base revision: ${report.baseRevision}`,
        `Archive to review: ${report.archivePath}`,
        ...report.changes.map((change) => `${change.action}: ${change.path}`),
        `Review digest: ${report.review}`,
        "Review the archive contents and these changes before explicitly invoking publish-private with this digest."
      ].join("\n"));
    } else {
      const report = await publishPrivateMemory(requireConfigPath(argv), source, branch, reviewed!);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(report, null, 2) : `${report.status}: ${report.repository} (${report.branch}) at ${report.revision}. Local checkout needs update: ${report.localCheckoutNeedsUpdate}.`);
    }
    return;
  }
  if (action === "export-private") {
    const destination = optionValue(argv, "--out");
    const externalEvidence = optionValue(argv, "--external-evidence");
    const contextPacks = optionValue(argv, "--context-packs");
    if (!destination || externalEvidence !== "retain-cited" || (contextPacks !== "retain" && contextPacks !== "omit")) {
      throw new Error("Use: pnpm wm memory export-private --out <new-directory> --external-evidence retain-cited --context-packs retain|omit [--json].");
    }
    const manifest = exportPrivateMemory(requireConfigPath(argv), destination, { externalEvidence, contextPacks });
    console.log(hasFlag(argv, "--json") ? JSON.stringify(manifest, null, 2) : `Private export prepared and verified: ${path.resolve(destination)}. External index chunks omitted: ${manifest.coverage.omittedExternalChunks}. Review required before publication.`);
    return;
  }
  if (action === "verify-private" || action === "restore-private") {
    const source = optionValue(argv, "--from");
    if (!source) throw new Error(`memory ${action} requires --from <private-export-directory>.`);
    if (action === "verify-private") {
      const manifest = verifyPrivateMemoryExport(source);
      console.log(hasFlag(argv, "--json") ? JSON.stringify({ valid: true, ...manifest }, null, 2) : "Private export verified; publication still requires review.");
    } else {
      const destination = optionValue(argv, "--to");
      if (!destination) throw new Error("memory restore-private requires --to <new-directory>.");
      const restored = restorePrivateMemoryExport(source, destination);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(restored, null, 2) : `Private memory restored: ${restored.root}\nConfiguration: ${restored.configPath}\nExternal index needs rebuilding: ${restored.externalIndexNeedsRebuild}`);
    }
    return;
  }
  if (action === "backup") {
    const destination = optionValue(argv, "--out");
    if (!destination) throw new Error("Use: pnpm wm memory backup --out <new-directory> [--config <path>] [--json].");
    const manifest = backupMemory(requireConfigPath(argv), destination);
    console.log(hasFlag(argv, "--json") ? JSON.stringify(manifest, null, 2) : `Local recovery backup verified: ${path.resolve(destination)} (${manifest.files.length} files; indexed content retained; not for Git publication).`);
    return;
  }
  if (action === "verify" || action === "restore") {
    const source = optionValue(argv, "--from");
    if (!source) throw new Error(`Use: pnpm wm memory ${action} --from <backup-directory>${action === "restore" ? " --to <new-directory>" : ""} [--json].`);
    if (action === "verify") {
      const manifest = verifyMemoryBackup(source);
      console.log(hasFlag(argv, "--json") ? JSON.stringify({ valid: true, ...manifest }, null, 2) : `Backup verified: ${manifest.files.length} files.`);
    } else {
      const destination = optionValue(argv, "--to");
      if (!destination) throw new Error("Memory restore requires --to <new-directory>; existing directories are never overwritten.");
      const result = restoreMemoryBackup(source, destination);
      console.log(hasFlag(argv, "--json") ? JSON.stringify(result, null, 2) : `Memory restored: ${result.root}\nConfiguration: ${result.configPath}`);
    }
    return;
  }
  if (action !== "inventory" && action !== "destinations") {
    throw new Error("Use: pnpm wm memory inventory|destinations|backup|verify|restore|export-private|verify-private|restore-private|preview-private|publish-private [options].");
  }
  const report = inventoryMemory(loadConfig(requireConfigPath(argv)));
  if (action === "destinations") {
    console.log(hasFlag(argv, "--json") ? JSON.stringify(report.synchronization, null, 2) : [
      "OneAgent memory destinations (read-only)",
      "Product references: private wiki synchronization disabled.",
      `Private destination: ${report.synchronization.privateBackup?.path ?? "not configured"}`,
      ...report.synchronization.blockers.map((blocker) => `- [${blocker.code}] ${blocker.detail}`)
    ].join("\n"));
    return;
  }
  if (hasFlag(argv, "--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("OneAgent memory inventory (read-only; not a backup)");
  console.log(`Memory: ${report.workspace.memoryRoot}`);
  console.log(`Database: ${report.database.status}`);
  for (const table of report.database.tables) console.log(`  ${table.name}: ${table.rows} (export v3: ${table.exportV3})`);
  console.log(`Markdown: ${report.files.captures.files.length} captures, ${report.files.wiki.files.length} wiki pages`);
  console.log(`Repositories: ${report.repositories.length}; legacy wiki destinations: ${report.legacyWikiTargets.length}`);
  for (const issue of report.issues) console.log(`- [${issue.code}] ${issue.subject}: ${issue.detail}`);
}

function exportCommand(argv: string[]): void {
  const runtime = createCliRuntime(argv);
  try {
    const tasks = runtime.db.listTasks([], { includeArchived: true });
    const observations = runtime.db.listObservations({});
    const observationIds = observations.map((observation) => observation.id);
    const data = {
      version: 3,
      exportedAt: new Date().toISOString(),
      entities: runtime.db.listEntities(),
      relations: runtime.db.listEntityRelations({}),
      captures: runtime.db.listCaptures({}),
      captureFiles: runtime.db.listCaptures({}).flatMap((capture) =>
        capture.path && fs.existsSync(capture.path)
          ? [{ id: capture.id, content: fs.readFileSync(capture.path, "utf8") }]
          : []
      ),
      wikiFiles: listWikiPages(runtime.config).map((page) => ({
        path: page.relativePath,
        content: fs.readFileSync(page.absolutePath, "utf8")
      })),
      sources: runtime.db.listSourceProvenance(),
      sourceChunks: runtime.db.listAllSourceChunks(),
      curationPackages: runtime.db.listCurationPackages({}),
      observations,
      observationEvidence: runtime.db.listObservationEvidenceForObservations(observationIds),
      observationRelations: runtime.db.listObservationRelationsForObservations(observationIds),
      observationEvents: runtime.db.listObservationEventsForObservations(observationIds),
      tasks,
      taskLinks: runtime.db.listTaskLinks(tasks.map((task) => task.id)),
      kpiMeasurements: runtime.db.listAllKpiMeasurements()
    };
    const json = JSON.stringify(data, null, 2);
    const out = optionValue(argv, "--out");
    if (out) {
      const target = path.resolve(out);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, json, "utf8");
      console.log(
        `Exported ${data.entities.length} entities, ${data.relations.length} relations, ${data.captures.length} captures, `
        + `${data.sources.length} sources, ${data.observations.length} observations, ${data.tasks.length} tasks and `
        + `${data.kpiMeasurements.length} KPI measurements to ${path.relative(process.cwd(), target) || target}`
      );
      return;
    }
    console.log(json);
  } finally {
    runtime.close();
  }
}

function importCommand(argv: string[]): void {
  const file = firstPositional(argv) ?? optionValue(argv, "--file");
  if (!file) {
    throw new Error("Missing import file. Use: pnpm wm import <file.json>.");
  }
  const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as {
    version?: number;
    entities?: Array<Record<string, unknown>>;
    relations?: Array<Record<string, unknown>>;
    captures?: Array<Record<string, unknown>>;
    captureFiles?: Array<{ id: string; content: string }>;
    wikiFiles?: Array<{ path: string; content: string }>;
    sources?: SourceProvenanceRecord[];
    sourceChunks?: SourceChunk[];
    curationPackages?: CurationPackageRecord[];
    observations?: ObservationRecord[];
    observationEvidence?: ObservationEvidenceRecord[];
    observationRelations?: ObservationRelationRecord[];
    observationEvents?: ObservationEventRecord[];
    tasks?: Array<Record<string, unknown>>;
    taskLinks?: Array<Record<string, unknown>>;
    kpiMeasurements?: Array<Record<string, unknown>>;
  };
  if (data.version !== undefined && data.version !== 1 && data.version !== 2 && data.version !== 3) {
    throw new Error(`Unsupported export version: ${data.version}.`);
  }

  const runtime = createCliRuntime(argv);
  try {
    let entities = 0;
    let relations = 0;
    let captures = 0;
    let sources = 0;
    let sourceChunks = 0;
    let curationPackages = 0;
    let observations = 0;
    let observationEvidence = 0;
    let observationRelations = 0;
    let observationEvents = 0;
    let tasks = 0;
    let taskLinks = 0;
    let kpiMeasurements = 0;
    // A v2 backup carries the complete source/observation closure. Keep old v2
    // exports importable, but never silently detach measurement provenance.
    const backupSourceIds = new Set((data.sources ?? []).map((record) => record.id));
    const backupObservationIds = new Set((data.observations ?? []).map((observation) => observation.id));
    for (const measurement of data.kpiMeasurements ?? []) {
      const sourceId = typeof measurement.sourceId === "string" ? measurement.sourceId : undefined;
      const observationId = typeof measurement.observationId === "string" ? measurement.observationId : undefined;
      if (sourceId && !backupSourceIds.has(sourceId) && !runtime.db.getSource(sourceId)) {
        throw new Error(`Cannot import KPI measurement ${String(measurement.id ?? "unknown")}: source ${sourceId} is missing from the backup and target database.`);
      }
      if (observationId && !backupObservationIds.has(observationId) && !runtime.db.getObservation(observationId)) {
        throw new Error(`Cannot import KPI measurement ${String(measurement.id ?? "unknown")}: observation ${observationId} is missing from the backup and target database.`);
      }
    }
    runtime.db.runInTransaction(() => {
      for (const entity of data.entities ?? []) {
        runtime.db.upsertEntity(entity as never);
        entities += 1;
      }
      for (const relation of data.relations ?? []) {
        runtime.db.upsertEntityRelation(relation as never);
        relations += 1;
      }
      for (const source of data.sources ?? []) {
        runtime.db.restoreSourceProvenance(source);
        sources += 1;
      }
      const chunksBySource = new Map<string, SourceChunk[]>();
      for (const chunk of data.sourceChunks ?? []) {
        const current = chunksBySource.get(chunk.sourceId) ?? [];
        current.push(chunk);
        chunksBySource.set(chunk.sourceId, current);
      }
      for (const [sourceId, chunks] of chunksBySource) {
        const source = (data.sources ?? []).find((record) => record.id === sourceId);
        if (!source) {
          throw new Error(`Cannot import source chunks for ${sourceId}: the complete source record is missing from the backup.`);
        }
        runtime.db.insertChunks(source, chunks);
        sourceChunks += chunks.length;
      }
      for (const capture of data.captures ?? []) {
        const id = String((capture as { id?: string }).id ?? "");
        if (id && !runtime.db.getCapture(id)) {
          const restoredFile = data.captureFiles?.some((file) => file.id === id);
          const targetPath = restoredFile
            ? path.join(runtime.config.workspaceRoot, runtime.config.workspace.memoryRoot, "captures", `${id}.md`)
            : capture.path;
          runtime.db.createCapture({ ...capture, path: targetPath } as never);
          const restored = capture as unknown as CaptureRecord;
          if (restored.status) runtime.db.setCaptureStatus(id, restored.status);
          if (restored.ingestionStatus) {
            runtime.db.updateCaptureIngestion(id, {
              ingestionStatus: restored.ingestionStatus,
              lastIngestedAt: restored.lastIngestedAt,
              contentHash: restored.contentHash,
              sourceId: restored.sourceId,
              error: restored.error
            });
          }
          if (restored.curationStatus) {
            runtime.db.updateCaptureCuration(id, {
              curationStatus: restored.curationStatus,
              curatedAt: restored.curatedAt,
              curationSummary: restored.curationSummary
            });
          }
          captures += 1;
        }
      }
      for (const curationPackage of data.curationPackages ?? []) {
        const existing = runtime.db.getCurationPackage(curationPackage.id);
        if (existing && existing.sourceId !== curationPackage.sourceId) {
          throw new Error(`Cannot import curation package ${curationPackage.id}: its source conflicts with the target database.`);
        }
        const restored = existing
          ? runtime.db.updateCurationPackage(curationPackage.id, curationPackage)
          : runtime.db.createCurationPackage(curationPackage);
        if (restored.id !== curationPackage.id) {
          throw new Error(`Cannot import curation package ${curationPackage.id}: source ${curationPackage.sourceId} is already owned by ${restored.id}.`);
        }
        curationPackages += 1;
      }
      for (const observation of data.observations ?? []) {
        const existing = runtime.db.getObservation(observation.id);
        if (existing) {
          if (existing.packageId !== observation.packageId || existing.sourceId !== observation.sourceId) {
            throw new Error(`Cannot import observation ${observation.id}: its provenance conflicts with the target database.`);
          }
        } else {
          const restored = runtime.db.insertObservation(observation);
          if (restored.id !== observation.id) {
            throw new Error(`Cannot import observation ${observation.id}: its proposal identity conflicts with ${restored.id}.`);
          }
        }
        observations += 1;
      }
      const observationIds = (data.observations ?? []).map((observation) => observation.id);
      const existingEvidenceIds = new Set(runtime.db.listObservationEvidenceForObservations(observationIds).map((item) => item.id));
      for (const evidence of data.observationEvidence ?? []) {
        if (!existingEvidenceIds.has(evidence.id)) {
          const restored = runtime.db.insertObservationEvidence(evidence);
          if (restored.id !== evidence.id) {
            throw new Error(`Cannot import observation evidence ${evidence.id}: its identity conflicts with ${restored.id}.`);
          }
        }
        observationEvidence += 1;
      }
      const existingRelationIds = new Set(runtime.db.listObservationRelationsForObservations(observationIds).map((item) => item.id));
      for (const relation of data.observationRelations ?? []) {
        if (!existingRelationIds.has(relation.id)) {
          const restored = runtime.db.insertObservationRelation(relation);
          if (restored.id !== relation.id) {
            throw new Error(`Cannot import observation relation ${relation.id}: its identity conflicts with ${restored.id}.`);
          }
        }
        observationRelations += 1;
      }
      const existingEventIds = new Set(runtime.db.listObservationEventsForObservations(observationIds).map((item) => item.id));
      for (const event of data.observationEvents ?? []) {
        if (!existingEventIds.has(event.id)) runtime.db.insertObservationEvent(event);
        observationEvents += 1;
      }
      for (const task of data.tasks ?? []) {
        const id = String(task.id ?? "").trim();
        const title = String(task.title ?? "").trim();
        if (!id || !title) throw new Error("Every imported task requires id and title.");
        const input = {
          title,
          body: typeof task.body === "string" ? task.body : null,
          status: typeof task.status === "string" ? task.status : null,
          priority: typeof task.priority === "string" ? task.priority : null,
          assignee: typeof task.assignee === "string" ? task.assignee : null,
          deadline: typeof task.deadline === "string" ? task.deadline : null,
          notes: typeof task.notes === "string" ? task.notes : null,
          productId: typeof task.productId === "string" ? task.productId : null,
          sourceId: typeof task.sourceId === "string" ? task.sourceId : null,
          tracking: task.tracking && typeof task.tracking === "object" && !Array.isArray(task.tracking) ? task.tracking : null,
          origin: typeof task.origin === "string" ? task.origin : "import"
        };
        if (runtime.db.getTask(id)) runtime.db.updateTask({ taskId: id, ...input });
        else runtime.db.createTask({ id, ...input });
        if (typeof task.archivedAt === "string") runtime.db.archiveTask(id);
        tasks += 1;
      }
      for (const taskLink of data.taskLinks ?? []) {
        runtime.db.upsertTaskLink(taskLink as never);
        taskLinks += 1;
      }
      for (const measurement of data.kpiMeasurements ?? []) {
        runtime.db.upsertKpiMeasurement(measurement as never);
        kpiMeasurements += 1;
      }
      for (const file of data.wikiFiles ?? []) {
        if (typeof file.path !== "string" || typeof file.content !== "string") throw new Error("Invalid wiki file in backup.");
        const target = path.resolve(globalWikiRoot(runtime.config), file.path);
        if (!isPathInside(target, globalWikiRoot(runtime.config)) || !/\.md$/i.test(target)) {
          throw new Error(`Invalid wiki path in backup: ${file.path}`);
        }
        const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
        atomicWriteFile(target, file.content);
        runtime.db.onRollback(() => previous === undefined ? fs.rmSync(target, { force: true }) : atomicWriteFile(target, previous));
      }
      for (const file of data.captureFiles ?? []) {
        if (typeof file.id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(file.id) || typeof file.content !== "string") {
          throw new Error("Invalid capture file in backup.");
        }
        const target = path.join(runtime.config.workspaceRoot, runtime.config.workspace.memoryRoot, "captures", `${file.id}.md`);
        const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
        atomicWriteFile(target, file.content);
        runtime.db.onRollback(() => previous === undefined ? fs.rmSync(target, { force: true }) : atomicWriteFile(target, previous));
      }
    });
    console.log(
      `Imported ${entities} entities, ${relations} relations, ${captures} captures, `
      + `${sources} sources, ${sourceChunks} chunks, ${curationPackages} curation packages, ${observations} observations, `
      + `${observationEvidence} evidence, ${observationRelations} observation relations, ${observationEvents} observation events, `
      + `${tasks} tasks, ${taskLinks} task links and ${kpiMeasurements} KPI measurements.`
    );
  } finally {
    runtime.close();
  }
}

function printContext(mode: string, product: ProductConfig | undefined, scope: ScopeMode, includedProductIds: string[]): void {
  console.log(`Mode: ${mode}`);
  console.log(`Product: ${product ? `${product.id} (${product.label})` : "portfolio"}`);
  console.log(`Scope mode: ${scope}`);
  console.log(`Scope: ${includedProductIds.join(", ")}`);
}

function createCliRuntime(argv: string[], cwd = process.cwd()) {
  const runtime = createRuntime({
    cwd,
    configPath: requireConfigPath(argv, cwd)
  });
  const close = runtime.close;
  runtime.close = () => {
    if (!openCliRuntimes.delete(runtime)) return;
    close();
  };
  openCliRuntimes.add(runtime);
  return runtime;
}

function requireConfigPath(argv: string[], cwd = process.cwd()): string {
  const explicit = optionValue(argv, "--config");
  return resolveConfigPath(cwd, explicit ? path.resolve(explicit) : undefined);
}

function inferProductId(products: ProductConfig[], activeProduct?: ProductConfig): string {
  if (activeProduct) {
    return activeProduct.id;
  }
  if (products.length === 1) {
    return products[0].id;
  }
  throw new Error("No active product detected. Pass --product <id>.");
}

function findProduct(products: ProductConfig[], productId?: string): ProductConfig {
  if (!productId) {
    if (products.length === 1) {
      return products[0];
    }
    throw new Error("No active product detected. Pass --product <id>.");
  }

  const product = products.find((candidate) => candidate.id === productId);
  if (!product) {
    throw new Error(`Unknown product id: ${productId}`);
  }
  return product;
}

function parseScopeOptions(argv: string[]): { productId?: string; scope?: ScopeMode; include?: string[] } {
  return {
    productId: optionValue(argv, "--product"),
    scope: parseScopeMode(optionValue(argv, "--scope")),
    include: optionValue(argv, "--include")?.split(",").map((value) => value.trim()).filter(Boolean)
  };
}

function parseScopeMode(value: string | undefined): ScopeMode | undefined {
  if (!value) {
    return undefined;
  }

  const aliases: Record<string, ScopeMode> = {
    product: "current-product",
    current: "current-product",
    dependencies: "current-product-plus-direct-dependencies",
    deps: "current-product-plus-direct-dependencies",
    manual: "manual-selection",
    portfolio: "portfolio"
  };
  const scope = aliases[value] ?? value;
  if (
    scope === "current-product" ||
    scope === "current-product-plus-direct-dependencies" ||
    scope === "manual-selection" ||
    scope === "portfolio"
  ) {
    return scope;
  }
  throw new Error(`Unknown scope: ${value}`);
}

function validateTaskUpdate(input: {
  title?: string;
  body?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  deadline?: string;
}): void {
  if (input.title !== undefined && input.title.trim().length > 180) {
    throw new Error("Task title must be 180 characters or less.");
  }
  if (input.body !== undefined && input.body.trim().length > 2000) {
    throw new Error("Task description must be 2000 characters or less.");
  }
  if (input.status && !["pending", "candidate", "open", "blocked", "ready", "done", "archived", "none", "clear"].includes(input.status)) {
    throw new Error(`Unknown task status: ${input.status}`);
  }
  if (input.priority && !["low", "medium", "high", "critical", "none", "clear"].includes(input.priority)) {
    throw new Error(`Unknown task priority: ${input.priority}`);
  }
  if (input.assignee && !["me", "agent", "none", "clear"].includes(input.assignee)) {
    throw new Error(`Unknown task assignee: ${input.assignee}`);
  }
  if (input.deadline && !["none", "clear"].includes(input.deadline) && !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
    throw new Error("Task deadline must use YYYY-MM-DD, none or clear.");
  }
}

function parseTaskLinks(values: string[]): Array<{ relationType: string; targetKind: string; targetId: string; label?: string }> {
  return values.map((value) => {
    const parts = value.split(":").map((part) => part.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error(`Invalid task link: ${value}. Expected relation:kind:id[:label].`);
    }
    return {
      relationType: parts[0],
      targetKind: parts[1],
      targetId: parts[2],
      label: parts.slice(3).join(":") || undefined
    };
  });
}

function parseInclude(value: string | undefined): Array<"wiki" | "bmad"> | undefined {
  if (!value) {
    return undefined;
  }

  return value.split(",").map((entry) => {
    const normalized = entry.trim();
    if (normalized === "wiki" || normalized === "bmad") {
      return normalized;
    }
    throw new Error(`Unknown reindex include value: ${normalized}`);
  });
}

function parseSourceType(value: string | undefined): SourceType | undefined {
  if (!value) {
    return undefined;
  }
  const sourceTypes = new Set([
    "meeting_transcript",
    "meeting_summary",
    "raw_user_input",
    "product_spec",
    "api_contract",
    "architecture_doc",
    "flow_doc",
    "external_doc",
    "bmad_artifact",
    "code_reference",
    "wiki_page",
    "decision_note",
    "markdown",
    "plain_text"
  ]);
  if (!sourceTypes.has(value)) {
    throw new Error(`Unknown source type: ${value}`);
  }
  return value as SourceType;
}

function requireInboxItem(item: InboxItem | undefined, id: string): InboxItem {
  if (!item) {
    throw new Error(`Inbox item not found: ${id}`);
  }
  return item;
}

function printInboxAction(
  item: InboxItem,
  action: string,
  targetPath?: string,
  content?: string,
  reason?: string
): void {
  console.log(`Item: ${item.id}`);
  console.log(`Type: ${item.type}`);
  console.log(`Action: ${action}`);
  if (targetPath) {
    console.log(`Target: ${targetPath}`);
  }
  if (reason) {
    console.log(`Reason: ${reason}`);
  }
  if (content) {
    console.log("");
    console.log(content);
  }
}

function firstPositional(argv: string[]): string | undefined {
  return positionalValues(argv)[0];
}

function positionalValues(argv: string[]): string[] {
  const values: string[] = [];
  const valueFlags = new Set([
    "--action",
    "--config",
    "--dependencies",
    "--description",
    "--assignee",
    "--aliases",
    "--body",
    "--accept",
    "--capture",
    "--chunk",
    "--confidence",
    "--content-type",
    "--deadline",
    "--payload",
    "--due-window",
    "--entity",
    "--entity-kind",
    "--evidence",
    "--evidence-status",
    "--expected-updated-at",
    "--excerpt",
    "--file",
    "--focus",
    "--focus-level",
    "--from",
    "--git-remote",
    "--include",
    "--id",
    "--ids",
    "--ingestion-status",
    "--into",
    "--kind",
    "--key",
    "--label",
    "--max-chars",
    "--context-scope",
    "--contributors",
    "--depth",
    "--mode",
    "--types",
    "--limit",
    "--link",
    "--members",
    "--metadata",
    "--names",
    "--notes",
    "--plane",
    "--origin",
    "--out",
    "--owners",
    "--parent",
    "--package",
    "--primary",
    "--priority",
    "--repo",
    "--graphify-command",
    "--home",
    "--max-edges",
    "--max-nodes",
    "--name",
    "--path",
    "--page",
    "--product",
    "--related",
    "--reason",
    "--reject",
    "--relation",
    "--relation-type",
    "--role",
    "--scope",
    "--section",
    "--source",
    "--source-kind",
    "--source-origin",
    "--source-type",
    "--specs-root",
    "--status",
    "--summary",
    "--curation-status",
    "--tags",
    "--changes",
    "--evidence",
    "--target",
    "--decision",
    "--title",
    "--token-budget",
    "--topic",
    "--to",
    "--type",
    "--value",
    "--view",
    "--session",
    "--left",
    "--right",
    "--wiki-root"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      if (valueFlags.has(value)) {
        index += 1;
      }
      continue;
    }
    values.push(value);
  }
  return values;
}

function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

function collectOptionValues(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) {
      values.push(argv[index + 1]);
    }
  }
  return values;
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseJsonOption(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--metadata must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

async function readStdin(): Promise<string> {
  if (stdinOverride !== undefined) {
    return stdinOverride;
  }
  if (daemonMode) {
    throw new Error("--stdin requires an 'input' payload when running through the daemon.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Long-lived server mode: one JSON request per stdin line
 * ({ id, args: string[], input?: string }), one JSON response per stdout line
 * ({ id, ok, stdout } | { id, ok: false, error }). Commands run exactly as in
 * one-shot mode (config re-read per request) but without paying process startup,
 * module loading and TypeScript parsing on every call.
 */
async function daemonCommand(): Promise<void> {
  daemonMode = true;
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, terminal: false });
  const respond = (payload: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };
  respond({ ready: true, pid: process.pid });

  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    queue = queue.then(() => handleDaemonRequest(line, respond)).catch(() => undefined);
  });
  await new Promise<void>((resolve) => rl.once("close", resolve));
  await queue;
}

async function handleDaemonRequest(line: string, respond: (payload: Record<string, unknown>) => void): Promise<void> {
  let id: unknown = null;
  const originalLog = console.log;
  try {
    const request = JSON.parse(line) as { id?: unknown; args?: unknown; input?: unknown };
    id = request.id ?? null;
    if (!Array.isArray(request.args)) {
      throw new Error("Malformed daemon request: expected an 'args' array.");
    }
    const argv = request.args.map(String);
    if (argv[0] === "daemon") {
      throw new Error("Cannot nest daemon commands.");
    }
    stdinOverride = typeof request.input === "string" ? request.input : undefined;
    const captured: string[] = [];
    console.log = (...parts: unknown[]) => {
      captured.push(parts.map(String).join(" "));
    };
    await main(argv);
    console.log = originalLog;
    respond({ id, ok: true, stdout: captured.join("\n") });
  } catch (error) {
    console.log = originalLog;
    respond({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    console.log = originalLog;
    stdinOverride = undefined;
  }
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function defaultConfig(): string {
  return `workspace:
  name: Work Memory
  memoryRoot: .work-memory

storage:
  databasePath: .work-memory/work-memory.db

products: []
`;
}

function printHelp(): void {
  console.log(`Work Memory Agent

Global:
  Add --config <path> to use a config other than .work-memory/config.yaml

Commands:
  pnpm wm init
  pnpm wm reset [--all] [--captures]
  pnpm wm rebuild [--no-reingest] [--json]
  pnpm wm migrate-knowledge [--ensure|--apply] [--json]
  pnpm wm export [--out <file.json>]
  pnpm wm memory export-private --out <new-directory> --external-evidence retain-cited --context-packs retain|omit [--json]
  pnpm wm memory verify-private --from <private-export-directory> [--json]
  pnpm wm memory restore-private --from <private-export-directory> --to <new-directory> [--json]
  pnpm wm memory preview-private --from <private-export-directory> --branch <branch> [--json]
  pnpm wm memory publish-private --from <private-export-directory> --branch <branch> --review <digest> [--json]
  pnpm wm memory destinations [--config <path>] [--json]
  pnpm wm memory inventory [--config <path>] [--json]
  pnpm wm memory backup --out <new-directory> [--config <path>] [--json]
  pnpm wm memory verify --from <backup-directory> [--json]
  pnpm wm memory restore --from <backup-directory> --to <new-directory> [--json]
  pnpm wm import <file.json>
  pnpm wm products
  pnpm wm bmad readiness [--product <id>] [--scope product|dependencies|manual|portfolio] [--json]
  pnpm wm today [--entity <kind:id>] [--assignee me|agent] [--due-window 7d] [--section due-soon|active-work|blocked|outcomes|objectives|inbox|agent-queue|upcoming-reviews|contradictions|context-views] [--no-agent] [--json]
  pnpm wm okr list|show [<id>] [--context-scope active] [--json]
  pnpm wm okr upsert <id> --label <label> [--objective <text>] [--mission <id>|--clear-mission] [--status draft|active|at_risk|off_track|achieved|closed] [--period-start <ISO>] [--period-end <ISO>] [--key-results '<json>'] [--kpi <ids>] [--json]
  pnpm wm kpi list|show [<id>] [--context-scope active] [--json]
  pnpm wm kpi upsert <id> --label <label> --unit <unit> --direction increase|decrease|target|range [--target <number>] [--target-min <number>] [--target-max <number>] [--okr <ids>] [--json]
  pnpm wm kpi measure <id> --value <number> [--measured-at <ISO>] [--source <id>] [--observation <accepted-id>] [--note <text>] [--json]
  pnpm wm kpi compare <id> --delivery-date <ISO> [--json]
  pnpm wm kpi archive|restore <id> [--context-scope active] [--json]
  pnpm wm outcome dashboard|gaps [--entity <kind:id>] [--json]
  pnpm wm outcome link --work project|feature|task:<id> --okr <id> --expected-impact <text> [--hypothesis <text>] [--key-results <ids>] [--confidence <0..1>] [--json]
  pnpm wm product add <id> [--label <label>] [--description <text>] [--parent <entity-id>] [--dependencies a,b]
  pnpm wm product delete <id>
  pnpm wm tasks [--product <id>] [--scope product|dependencies|manual|portfolio] [--json]
  pnpm wm tasks create <title> [--product <id>] [--body <text>] [--status pending|open|blocked|ready|done] [--priority low|medium|high|critical] [--assignee me|agent] [--deadline YYYY-MM-DD] [--notes <text>] [--json]
  pnpm wm tasks update <task-id> [--title <text>] [--body <text>] [--status pending|open|blocked|ready|done] [--priority low|medium|high|critical] [--assignee me|agent] [--deadline YYYY-MM-DD|none] [--notes <text>] [--json]
  pnpm wm entities [--json]
  pnpm wm entity upsert <id> --kind <kind> [--label <label>] [--description <text>] [--body <Markdown> | --stdin] [--fail-if-exists | --require-existing] [--aliases a,b] [--status active|inactive|candidate|archived] [--parent <id>] [--owners a,b] [--contributors a,b] [--tags a,b]
  pnpm wm entity list [--kind <kind>] [--json]
  pnpm wm entity resolve <name> [<name>...] [--names a,b] [--json]
  pnpm wm entity merge <from-kind:id> --into <target-kind:id> [--context-scope active] [--allow-boundary-change] [--json]
  pnpm wm entity context <kind:id> [--include observations,curationPackages,captures,relations,tasks,sources,inbox,graph] [--relation <type>] [--json]
  pnpm wm entity delete <id> [--kind <kind>] [--reassign-oneagent] [--context-scope active] [--allow-boundary-change]
  pnpm wm relation upsert --source <kind:id> --target <kind:id> --type <relation> [--description <text>] [--capture <capture-id>] [--metadata '<json>']
  pnpm wm relation list [--entity <kind:id>] [--json]
  pnpm wm relation delete <relation-id>
  pnpm wm capture create --content-type <type> --title <title> [--primary <kind:id>] [--related <kind:id:relation> ...] [--source-kind paste|file|clipboard|copilot|manual|import] [--source-origin cockpit|cli|copilot_tool|vscode_command|external_import] [--body <text> | --stdin] [--json]
  pnpm wm capture update <capture-id> [--title <title>] [--content-type <type>] [--primary <kind:id>] [--tags <comma-separated>] [--body <text> | --stdin] [--expected-updated-at <iso>] [--json]
  pnpm wm capture archive|restore <capture-id> [--context-scope active] [--json]
  pnpm wm capture resolve <question-capture-id> [--context-scope active] [--json]
  pnpm wm capture classify <capture-id> --primary <kind:id> [--json]
  pnpm wm capture relate <capture-id> --entity <kind:id> --relation <relation> [--json]
  pnpm wm capture unrelate <capture-id> --entity <kind:id> [--json]
  pnpm wm capture reingest <capture-id> [--force] [--json]
  pnpm wm capture delete <capture-id> [--json]
  pnpm wm capture reingest (--all | --failed | --entity <kind:id>) [--force] [--json]
  pnpm wm capture reclassify --from <kind:id> --to <kind:id>
  pnpm wm capture review <capture-id> [--status reviewed|archived|superseded|captured] [--json]
  pnpm wm capture curate <capture-id> [--status pending|curating|curated|failed] [--summary <text>] [--json]
  pnpm wm capture show <capture-id> [--json]
  pnpm wm capture open <capture-id>
  pnpm wm capture list [--ids <comma-separated, max 100>] [--include-content] [--primary <kind:id> | --entity <kind:id>] [--content-type <type>] [--status <status>] [--ingestion-status <status>] [--curation-status <status>] [--json]
  pnpm wm curation queue [--pending-only] [--json]
  pnpm wm curation check (<capture-id> | --all) [--repair] [--json]
  pnpm wm curation backfill [--json]
  pnpm wm curation migrate-observations [--apply] [--json]
  pnpm wm curation-package list [--entities <kind:id,...>] [--status pending|partially_accepted|accepted|rejected|superseded|all] [--limit <count>] [--context-scope active] [--json]
  pnpm wm curation-package show <package-id> [--json]
  pnpm wm curation-package review <package-id> [--accept <observation-ids>] [--reject <observation-ids> [--reason <text>]] [--json]
  pnpm wm curation-package wiki-assess <package-id> [--json]
  pnpm wm curation-package wiki-decision <package-id> --decision not_needed|suggested [--reason multi_source_synthesis|specification|durable_reference|publication_required] [--evidence <accepted-observation-ids>] [--target <kind:id> --home <kind:id> --page <relative.md>] [--json]
  pnpm wm observation list [--package <id>] [--source <id>] [--capture <id>] [--status <states>] [--evidence-status <states>] [--json]
  pnpm wm observation show <observation-id> [--json]
  pnpm wm observation propose (--package <id> | --capture <id> | --source <id>) --kind <kind> --title <text> --body <interpretation> --excerpt <exact-source-passage> [--entity <kind:id>] [--confidence <0..1>] [--json]
  pnpm wm observation edit|reclassify <observation-id> --reason <text> [--title <text>] [--body <text>] [--kind <kind>] [--entity <kind:id>|--clear-entity] [--confidence <0..1>] [--json]
  pnpm wm observation accept <observation-id> [--json]
  pnpm wm observation reject <observation-id> [--reason <text>] [--json]
  pnpm wm observation merge <observation-id> <observation-id> [...] --reason <text> [--json]
  pnpm wm observation review-link --from <observation-id> --to <observation-id> --type supports|contradicts --decision accepted|rejected [--reason <text>] [--json]
  pnpm wm observation measure <observation-id> --reason <measurement-note> [--json]
  pnpm wm me [show|set <person-id> [--label <name>]|clear] [--json]
  pnpm wm daemon  (JSON per line on stdin: { id, args, input? } -> { id, ok, stdout|error })
  pnpm wm wiki path
  pnpm wm wiki list [--json]
  pnpm wm wiki read <relative/path.md>
  pnpm wm wiki write --entity <kind:id> [--home <kind:id>] [--page index.md] (--body <markdown> | --stdin) [--json]
  pnpm wm wiki resolve-path --entity <kind:id> [--home <kind:id>] [--page index.md] [--json]
  pnpm wm wiki repo-pages [--entities <kind:id,...>] [--json]
  pnpm wm wiki migrate-layout [--apply] [--json]
  pnpm wm wiki log <message> [--action ingest|curate|lint|note]
  pnpm wm wiki lint [--inbox] [--json]
  pnpm wm wiki sync <kind:id> [--json]
  pnpm wm links [--json]
  pnpm wm link upsert --source <id> --target <id> --type <type> [--id <id>] [--description <text>]
  pnpm wm link delete <id>
  pnpm wm product add <id> [--label <label>] [--description <text>] [--parent <entity-id>] [--dependencies a,b]
  pnpm wm repo add <product-id> <repo-id> --path <path> [--role specs] [--wiki-root docs/wiki] [--specs-root _specs/planning-artifacts]
  pnpm wm concepts [--scope product|dependencies|manual|portfolio] [--limit 25]
  pnpm wm sources [--scope product|dependencies|manual|portfolio] [--limit 80] [--json]
  pnpm wm sources show <source-id> [--max-chars 8000] [--json]
  pnpm wm sources show-chunk <chunk-id> [--json]
  pnpm wm context-scope get [--json]
  pnpm wm context-scope set (--entity kind:id[,kind:id] [--depth 1] [--mode strict|guided|disabled] [--types kind,kind] | --stdin) [--allow-boundary-change] [--json]
  pnpm wm context-scope preview (--entity kind:id[,kind:id] [...] | --stdin) --json
  pnpm wm context-scope clear [--allow-boundary-change]
  pnpm wm context-view list|get [<id>] [--json]
  pnpm wm context-view create (--name <name> --entity kind:id[,kind:id] | --stdin) [--json]
  pnpm wm context-view update <id> --stdin [--json]
  pnpm wm context-view rename|duplicate|delete|activate <id> [--name <name>] [--json]
  pnpm wm context-view compare <left-id> <right-id> [--json]
  pnpm wm context-view preview <id> [--json]
  pnpm wm context-view suggest (--topic <topic> [--view <id>] | --stdin) [--json]
  pnpm wm context-view refresh <id> [--topic <topic>] [--json]
  pnpm wm context-pack compile (--topic <request> [--view <id>] | --stdin) [--session <id>] [--token-budget <tokens>] [--json]
  pnpm wm context-pack list [--view <id>] [--session <id>] [--summary] [--json]
  pnpm wm context-pack get <id> [--json]
  pnpm wm context-pack prune [--view <id>] [--max-per-view 100] [--max-per-session 20] [--max-age-days 90] [--preserve-latest 3] [--dry-run] [--json]
  pnpm wm graph-change propose (--stdin | --reason <why> --evidence <observation-ids> --changes '<json>') [--title <title>] [--json]
  pnpm wm graph-change list|get|preview|accept|reject [<id>] [--status pending] [--limit <count>] [--reason <why>] [--json]
  pnpm wm graph [--scope product|dependencies|manual|portfolio] [--limit 25]
  pnpm wm graph-view [--scope product|dependencies|manual|portfolio] [--include product-a,product-b] [--max-nodes 150] [--max-edges 300] [--entity-kind practice,mission] [--content-type insight,okr] [--ingestion-status indexed] [--relation-type requested_by] [--focus <kind:id>] [--context-scope active] [--refresh-graphify] [--json]
  pnpm wm context [path] [--scope product|dependencies|manual|portfolio] [--include product-a,product-b]
  pnpm wm ingest <file> --entity <kind:id> [--entities <kind:id,...>] [--source-type meeting_transcript|meeting_summary|raw_user_input|decision_note|markdown|plain_text] [--json]
  pnpm wm smoke-ingest --entity <kind:id> [--json]
  pnpm wm reindex --entity repository:<id> [--include wiki,bmad] [--branch <reference-branch>] [--json]
  pnpm wm search <query> [--plane sources|accepted|signals|history|all] [--product <id>] [--scope product|dependencies|manual|portfolio] [--include product-a,product-b] [--limit 10] [--context-scope active] [--json]
  pnpm wm inbox [--status pending] [--entities <kind:id,...>] [--json]
  pnpm wm inbox add [--id <id>] --type wiki_proposal|decision_candidate|open_question|task|risk --title <title> [--body <text>] [--capture <capture-id>] [--source <source-id>] [--entity <kind:id>] [--payload '<json>'] [--json]
  pnpm wm inbox preview <id>
  pnpm wm inbox accept <id>
  pnpm wm inbox reject <id> [--feedback <correction instructions>]
  pnpm wm inbox recover-publications [--json]
  pnpm wm diagnose [--json]
`);
}
