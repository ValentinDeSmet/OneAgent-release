import path from "node:path";
import { createStableId, isEntityKind, nowIso } from "../../shared/src/index.ts";
import { resolveScope } from "../../registry/src/index.ts";
import { buildOutcomeSnapshot } from "../../impact/src/index.ts";
import type {
  ActiveContext,
  GraphNodeStatus,
  GraphNodeType,
  GraphRelationRecord,
  GraphViewDiagnostic,
  GraphViewEdge,
  GraphViewModel,
  GraphViewNode,
  InboxItemType,
  ProductConfig,
  ResolvedContextScope,
  RepositoryConfig,
  ScopeMode,
  WorkMemoryConfig
} from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { importGraphifyGraph, refreshGraphifyRepository } from "./graphify.ts";

export interface GraphFilters {
  entityKinds?: string[];
  contentTypes?: string[];
  ingestionStatuses?: string[];
  relationTypes?: string[];
}

export interface GraphFocus {
  kind: string;
  id: string;
}

export interface BuildGraphViewModelInput {
  config: WorkMemoryConfig;
  context: ActiveContext;
  db: WorkMemoryDatabase;
  productId?: string;
  scope?: ScopeMode;
  include?: string[];
  maxNodes?: number;
  maxEdges?: number;
  includeGraphify?: boolean;
  refreshGraphify?: boolean;
  graphifyCommand?: string;
  filters?: GraphFilters;
  focus?: GraphFocus;
  /** Resolved retrieval boundary used before outcome annotations are computed. */
  contextScope?: ResolvedContextScope;
}

interface SourceGraphRow {
  id: string;
  title: string;
  sourceType: string;
  rawPath?: string;
  originUri?: string;
  status: string;
  productId: string;
}

interface ConceptProductEdgeRow {
  conceptId: string;
  productId: string;
  confidence: number;
  sourceId: string;
}

export function buildGraphViewModel(input: BuildGraphViewModelInput): GraphViewModel {
  const maxNodes = input.maxNodes === 0 ? Number.MAX_SAFE_INTEGER : input.maxNodes ?? 150;
  const maxEdges = input.maxEdges === 0 ? Number.MAX_SAFE_INTEGER : input.maxEdges ?? 300;
  const scope = resolveScope(input.config, input.context, {
    productId: input.productId,
    scope: input.scope,
    include: input.include
  });
  const products = input.config.products.filter((product) => scope.includedProductIds.includes(product.id));
  const filters = input.filters ?? {};
  const graph = new GraphViewBuilder(scope.scope, scope.activeProductId, scope.includedProductIds, maxNodes, maxEdges);
  const scopedEntityKeys = scope.includedProductIds.length > 0
    ? resolveGraphEntityScope(input.db, scope.includedProductIds)
    : undefined;
  const scopedSourceIds = scope.includedProductIds.length > 0
    ? new Set(input.db.listSourceIdsForProducts(scope.includedProductIds))
    : undefined;
  const scopedCaptureIds = scopedEntityKeys
    ? new Set(input.db.listCaptures({})
        .filter((capture) => scopedEntityKeys.has(`${capture.primaryEntityKind}:${capture.primaryEntityId}`))
        .map((capture) => capture.id))
    : undefined;
  addOrganization(input.config, graph, new Set(products.map((product) => product.id)));
  if (scope.includedProductIds.length === 0 && (input.config.entities ?? []).length === 0) {
    graph.addDiagnostic({
      provider: "work-memory",
      status: "missing",
      message: "No products configured for this scope."
    });
  }

  for (const product of products) {
    graph.addNode(productNode(product));
    if (product.parentEntityId) {
      graph.addEdge({
        id: createStableId("graph-edge", ["entity-product", product.parentEntityId, product.id]),
        source: orgEntityNodeId(product.parentEntityId),
        target: productNodeId(product.id),
        label: "owns",
        predicate: "owns",
        status: "active",
        confidence: 1,
        provider: "work-memory"
      });
    }
    for (const dependency of product.dependencies ?? []) {
      if (scope.includedProductIds.includes(dependency)) {
        graph.addEdge({
          id: createStableId("graph-edge", ["product", product.id, "depends_on", dependency]),
          source: productNodeId(product.id),
          target: productNodeId(dependency),
          label: "depends_on",
          predicate: "depends_on",
          status: "active",
          confidence: 1,
          provider: "work-memory"
        });
      }
    }
    for (const repository of product.repositories) {
      graph.addNode(repositoryNode(repository));
      graph.addEdge({
        id: createStableId("graph-edge", ["product", product.id, "has_repository", repository.id]),
        source: productNodeId(product.id),
        target: repositoryNodeId(repository.id),
        label: "has_repository",
        predicate: "has_repository",
        status: "active",
        confidence: 1,
        provider: "work-memory"
      });
    }
  }

  // Add the generic DB entities AFTER products/repositories so that, when the node budget is hit,
  // the long tail (people, etc.) is dropped rather than products — keeping selectors/graph usable.
  addDbEntities(input.db, graph, filters, scopedEntityKeys);

  if (scope.includedProductIds.length > 0) {
    addConcepts(input.db, scope.includedProductIds, graph, maxNodes);
    addSources(input.db, scope.includedProductIds, graph, maxNodes);
    addTasks(input.db, scope.includedProductIds, graph, maxNodes, scopedEntityKeys, scopedSourceIds);
    addInbox(input.db, scope.includedProductIds, graph, maxNodes, scopedSourceIds, scopedCaptureIds);
    addGraphRelations(input.db, scope.includedProductIds, graph, maxEdges);
  }

  addCaptures(input.db, graph, filters, scopedEntityKeys, scopedSourceIds);
  addEntityRelations(input.db, graph, filters, scopedEntityKeys);

  if (input.includeGraphify ?? true) {
    addGraphify(input, products, graph);
  }

  const model = graph.toModel();
  annotateOutcomeNodes(input.db, model, input.contextScope);
  markSelfNode(model, input.config.workspace.self);
  if (input.focus) {
    return focusModel(model, entityNodeId(input.focus.kind, input.focus.id));
  }
  return model;
}

function annotateOutcomeNodes(
  db: WorkMemoryDatabase,
  model: GraphViewModel,
  contextScope?: ResolvedContextScope
): void {
  const outcomeNodes = model.nodes.filter((node) => node.type === "mission" || node.type === "okr" || node.type === "kpi");
  if (outcomeNodes.length === 0) return;
  const snapshot = buildOutcomeSnapshot(db, { measurementLimit: 24, contextScope });
  const okrs = [...snapshot.missions.flatMap((mission) => mission.okrs), ...snapshot.standaloneOkrs];
  const okrById = new Map(okrs.map((okr) => [okr.id, okr]));
  const kpiById = new Map(snapshot.kpis.map((kpi) => [kpi.id, kpi]));
  for (const node of outcomeNodes) {
    const entityId = String(node.meta?.entityId ?? node.id.split(":").at(-1) ?? "");
    if (node.type === "okr") {
      const okr = okrById.get(entityId);
      if (!okr) continue;
      node.meta = {
        ...node.meta,
        outcome: {
          kind: "okr",
          status: okr.definition.status,
          progress: okr.progress,
          atRisk: okr.atRisk,
          keyResultCount: okr.keyResults.length,
          kpiCount: okr.kpis.length
        }
      };
    } else if (node.type === "kpi") {
      const kpi = kpiById.get(entityId);
      if (!kpi) continue;
      node.meta = {
        ...node.meta,
        outcome: {
          kind: "kpi",
          unit: kpi.definition.unit,
          direction: kpi.definition.direction,
          latestValue: kpi.latest?.value,
          latestAt: kpi.latest?.measuredAt,
          trend: kpi.trend,
          targetMet: kpi.targetMet,
          stale: kpi.stale,
          series: kpi.measurements.slice(-12).map((measurement) => ({ at: measurement.measuredAt, value: measurement.value }))
        }
      };
    } else {
      const visibleOkrIds = new Set(model.edges.filter((edge) =>
        edge.predicate === "has_okr" && edge.source === node.id
      ).map((edge) => String(model.nodes.find((candidate) => candidate.id === edge.target)?.meta?.entityId ?? edge.target.split(":").at(-1) ?? "")));
      const visible = [...visibleOkrIds].map((id) => okrById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      node.meta = {
        ...node.meta,
        outcome: {
          kind: "mission",
          okrCount: visible.length,
          atRiskOkrs: visible.filter((okr) => okr.atRisk).length
        }
      };
    }
  }
}

/** Flag the workspace owner's node so viewers can style it and de-emphasize its edges. */
function markSelfNode(model: GraphViewModel, selfRef: string | undefined): void {
  if (!selfRef || !selfRef.includes(":")) {
    return;
  }
  const [kind, id] = selfRef.split(":");
  const nodeId = entityNodeId(kind, id);
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  if (node) {
    node.meta = { ...node.meta, self: true };
  }
}

function addOrganization(config: WorkMemoryConfig, graph: GraphViewBuilder, productIds: Set<string>): void {
  const includedIds = organizationIdsForProducts(config, productIds);
  for (const entity of config.entities ?? []) {
    if (!includedIds.has(entity.id)) continue;
    graph.addNode({
      id: orgEntityNodeId(entity.id),
      label: entity.label || entity.id,
      type: entity.kind,
      status: "active",
      confidence: 1,
      provider: "work-memory",
      meta: {
        description: entity.description,
        parentId: entity.parentId,
        members: entity.members ?? []
      }
    });
    if (entity.parentId) {
      graph.addEdge({
        id: createStableId("graph-edge", ["entity-parent", entity.parentId, entity.id]),
        source: orgEntityNodeId(entity.parentId),
        target: orgEntityNodeId(entity.id),
        label: "contains",
        predicate: "contains",
        status: "active",
        confidence: 1,
        provider: "work-memory"
      });
    }
  }

  for (const link of config.entityLinks ?? []) {
    if (!includedIds.has(link.sourceId) || !includedIds.has(link.targetId)) continue;
    graph.addEdge({
      id: createStableId("graph-edge", ["entity-link", link.id]),
      source: graphNodeIdForConfigRef(config, link.sourceId),
      target: graphNodeIdForConfigRef(config, link.targetId),
      label: link.type,
      predicate: link.type,
      status: "active",
      confidence: 1,
      provider: "work-memory",
      meta: {
        linkId: link.id,
        description: link.description
      }
    });
  }
}

function graphNodeIdForConfigRef(config: WorkMemoryConfig, id: string): string {
  return config.products.some((product) => product.id === id) ? productNodeId(id) : orgEntityNodeId(id);
}

function addConcepts(db: WorkMemoryDatabase, productIds: string[], graph: GraphViewBuilder, limit: number): void {
  const concepts = db.listConcepts(productIds, limit);
  for (const concept of concepts) {
    graph.addNode({
      id: conceptNodeId(concept.id),
      label: concept.canonicalName,
      type: conceptTypeToGraphType(concept.conceptType),
      status: mapStatus(concept.status),
      confidence: undefined,
      provider: "work-memory",
      meta: {
        conceptType: concept.conceptType,
        mentionCount: concept.mentionCount ?? 0,
        description: concept.description
      }
    });
  }

  const rows = db.db
    .prepare(`
      SELECT
        c.id AS conceptId,
        se.entity_id AS productId,
        MAX(cm.confidence) AS confidence,
        cm.source_id AS sourceId
      FROM concepts c
      JOIN concept_mentions cm ON cm.concept_id = c.id
      JOIN sources s ON s.id = cm.source_id AND s.status = 'indexed'
      JOIN source_entities se ON se.source_id = cm.source_id AND se.entity_kind = 'product'
      WHERE se.entity_id IN (${placeholders(productIds)})
      GROUP BY c.id, se.entity_id
      LIMIT ?
    `)
    .all(...productIds, Math.min(Number.MAX_SAFE_INTEGER, limit * 4)) as unknown as ConceptProductEdgeRow[];

  for (const row of rows) {
    graph.addEdge({
      id: createStableId("graph-edge", ["product-concept", row.productId, row.conceptId]),
      source: productNodeId(row.productId),
      target: conceptNodeId(row.conceptId),
      label: "mentions",
      predicate: "mentions",
      status: "candidate",
      confidence: row.confidence,
      sourceId: row.sourceId,
      provider: "work-memory",
      meta: {
        origin: "concept_mention",
        sourceId: row.sourceId
      }
    });
  }
}

function addSources(db: WorkMemoryDatabase, productIds: string[], graph: GraphViewBuilder, limit: number): void {
  const rows = db.db
    .prepare(`
      SELECT DISTINCT
        s.id,
        s.title,
        s.source_type AS sourceType,
        s.raw_path AS rawPath,
        s.origin_uri AS originUri,
        s.status,
        se.entity_id AS productId
      FROM sources s
      JOIN source_entities se ON se.source_id = s.id AND se.entity_kind = 'product'
      WHERE se.entity_id IN (${placeholders(productIds)})
        AND s.source_type <> 'wiki_page'
        AND s.status = 'indexed'
      ORDER BY s.updated_at DESC
      LIMIT ?
    `)
    .all(...productIds, limit) as unknown as SourceGraphRow[];

  for (const source of rows) {
    graph.addNode(sourceNode(source));
    graph.addEdge({
      id: createStableId("graph-edge", ["product-source", source.productId, source.id]),
      source: productNodeId(source.productId),
      target: sourceNodeId(source.id),
      label: "has_source",
      predicate: "has_source",
      status: mapStatus(source.status),
      confidence: 1,
      sourceId: source.id,
      provider: "work-memory",
      meta: {
        origin: "source_product",
        sourceId: source.id
      }
    });
  }
}

function addInbox(
  db: WorkMemoryDatabase,
  productIds: string[],
  graph: GraphViewBuilder,
  limit: number,
  allowedSources?: Set<string>,
  allowedCaptures?: Set<string>
): void {
  const selectedProducts = new Set(productIds);
  const items = db.listInbox("pending", productIds)
    .filter(shouldIncludeInboxItemInGraph)
    .filter((item) => {
      if (!allowedSources && !allowedCaptures) return true;
      const captureId = typeof item.payload.captureId === "string" ? item.payload.captureId : undefined;
      return Boolean(
        (item.productId && selectedProducts.has(item.productId)) ||
        (item.sourceId && allowedSources?.has(item.sourceId)) ||
        (captureId && allowedCaptures?.has(captureId))
      );
    })
    .slice(0, limit);
  for (const item of items) {
    const nodeId = inboxNodeId(item.id);
    graph.addNode({
      id: nodeId,
      label: item.title,
      type: inboxTypeToGraphType(item.type),
      status: mapStatus(item.status),
      productIds: item.productId ? [item.productId] : productIds,
      sourceId: item.sourceId,
      path: typeof item.payload.targetPath === "string" ? item.payload.targetPath : undefined,
      confidence: typeof item.payload.confidence === "number" ? item.payload.confidence : undefined,
      provider: "work-memory",
      meta: {
        body: item.body,
        inboxType: item.type
      }
    });

    if (item.productId) {
      graph.addEdge({
        id: createStableId("graph-edge", ["product-inbox", item.productId, item.id]),
        source: productNodeId(item.productId),
        target: nodeId,
        label: "has_pending",
        predicate: "has_pending",
        status: "pending",
        confidence: 1,
        sourceId: item.sourceId,
        provider: "work-memory"
      });
    }
    if (item.sourceId) {
      graph.addEdge({
        id: createStableId("graph-edge", ["source-inbox", item.sourceId, item.id]),
        source: sourceNodeId(item.sourceId),
        target: nodeId,
        label: "proposes",
        predicate: "proposes",
        status: "pending",
        confidence: 1,
        sourceId: item.sourceId,
        provider: "work-memory"
      });
    }
  }
}

function shouldIncludeInboxItemInGraph(item: { type: InboxItemType; payload: Record<string, unknown> }): boolean {
  // Wiki pages and pending graph mutations are review content, not accepted
  // graph nodes. A graph-change proposal appears only after acceptance applies
  // its entities/relations transactionally.
  return item.type !== "wiki_proposal" && item.type !== "graph_change_proposal";
}

function addTasks(
  db: WorkMemoryDatabase,
  productIds: string[],
  graph: GraphViewBuilder,
  limit: number,
  allowed?: Set<string>,
  allowedSources?: Set<string>
): void {
  const candidates = db.listTasks(productIds);
  const candidateLinks = db.listTaskLinks(candidates.map((task) => task.id));
  const linksByTask = new Map<string, ReturnType<WorkMemoryDatabase["listTaskLinks"]>>();
  for (const link of candidateLinks) {
    const links = linksByTask.get(link.taskId) ?? [];
    links.push(link);
    linksByTask.set(link.taskId, links);
  }
  const selectedProducts = new Set(productIds);
  const selectedSources = new Set(db.listSourceIdsForProducts(productIds));
  const tasks = candidates.filter((task) =>
    !allowed ||
    Boolean(task.productId && selectedProducts.has(task.productId)) ||
    Boolean(task.sourceId && selectedSources.has(task.sourceId)) ||
    (linksByTask.get(task.id) ?? []).some((link) => allowed.has(`${link.targetKind}:${link.targetId}`))
  ).slice(0, limit);

  for (const task of tasks) {
    const exposedProductId = task.productId && selectedProducts.has(task.productId) ? task.productId : undefined;
    const exposedSourceId = task.sourceId && allowedSources?.has(task.sourceId) ? task.sourceId : undefined;
    const nodeId = taskNodeId(task.id);
    graph.addNode({
      id: nodeId,
      label: task.title,
      type: "task",
      status: taskStatusToGraphStatus(task.status),
      productIds: exposedProductId ? [exposedProductId] : productIds,
      sourceId: exposedSourceId,
      confidence: 1,
      provider: "work-memory",
      meta: {
        body: task.body,
        priority: task.priority,
        assignee: task.assignee,
        deadline: task.deadline,
        notes: task.notes,
        origin: task.origin
      }
    });

    if (exposedProductId) {
      graph.addEdge({
        id: createStableId("graph-edge", ["product-task", exposedProductId, task.id]),
        source: productNodeId(exposedProductId),
        target: nodeId,
        label: "has_task",
        predicate: "has_task",
        status: "active",
        confidence: 1,
        provider: "work-memory"
      });
    }
    if (exposedSourceId) {
      graph.addEdge({
        id: createStableId("graph-edge", ["source-task", exposedSourceId, task.id]),
        source: sourceNodeId(exposedSourceId),
        target: nodeId,
        label: "produces_task",
        predicate: "produces_task",
        status: "active",
        confidence: 1,
        sourceId: exposedSourceId,
        provider: "work-memory"
      });
    }
    for (const link of linksByTask.get(task.id) ?? []) {
      if (allowed && !allowed.has(`${link.targetKind}:${link.targetId}`)) continue;
      const targetId = entityNodeId(link.targetKind, link.targetId);
      ensureEntityNode(db, graph, link.targetKind, link.targetId);
      graph.addEdge({
        id: createStableId("graph-edge", ["task-link", task.id, link.relationType, link.targetKind, link.targetId]),
        source: nodeId,
        target: targetId,
        label: link.relationType,
        predicate: link.relationType,
        status: "active",
        confidence: 1,
        provider: "work-memory",
        meta: {
          label: link.label
        }
      });
    }
  }
}

function addGraphRelations(db: WorkMemoryDatabase, productIds: string[], graph: GraphViewBuilder, limit: number): void {
  const relations = db.listGraphRelations(productIds, limit);
  for (const relation of relations) {
    const sourceId = relationEntityNodeId(relation.subject);
    const targetId = relationEntityNodeId(relation.object);
    graph.addNode(relationEntityNode(relation.subject));
    graph.addNode(relationEntityNode(relation.object));
    graph.addEdge({
      id: relation.id,
      source: sourceId,
      target: targetId,
      label: relation.predicate,
      predicate: relation.predicate,
      status: mapStatus(relation.status),
      confidence: relation.confidence,
      sourceId: relation.sourceId,
      provider: "fallback"
    });
  }
}

function addDbEntities(db: WorkMemoryDatabase, graph: GraphViewBuilder, filters: GraphFilters, allowed?: Set<string>): void {
  for (const entity of db.listEntities()) {
    if (allowed && !allowed.has(`${entity.kind}:${entity.id}`)) continue;
    if (filters.entityKinds && !filters.entityKinds.includes(entity.kind)) {
      continue;
    }
    // The default oneagent fallback is only worth showing once content hangs off it.
    if (entity.kind === "oneagent" && entity.id === "oneagent" && !entityHasAttachments(db, entity.kind, entity.id)) {
      continue;
    }
    graph.addNode(dbEntityNode(entity));
  }
}

function addCaptures(
  db: WorkMemoryDatabase,
  graph: GraphViewBuilder,
  filters: GraphFilters,
  allowed?: Set<string>,
  allowedSources?: Set<string>
): void {
  for (const capture of db.listCaptures({})) {
    if (allowed && !allowed.has(`${capture.primaryEntityKind}:${capture.primaryEntityId}`)) continue;
    if (filters.contentTypes && !filters.contentTypes.includes(capture.contentType)) {
      continue;
    }
    if (filters.ingestionStatuses && !filters.ingestionStatuses.includes(capture.ingestionStatus)) {
      continue;
    }

    const nodeId = captureNodeId(capture.id);
    graph.addNode({
      id: nodeId,
      label: capture.title,
      type: "capture",
      status: mapStatus(capture.ingestionStatus === "indexed" ? "indexed" : "candidate"),
      path: capture.path,
      sourceId: capture.sourceId && (!allowedSources || allowedSources.has(capture.sourceId)) ? capture.sourceId : undefined,
      provider: "work-memory",
      meta: {
        contentType: capture.contentType,
        captureStatus: capture.status,
        ingestionStatus: capture.ingestionStatus
      }
    });

    const primaryNodeId = ensureEntityNode(db, graph, capture.primaryEntityKind, capture.primaryEntityId);
    graph.addEdge({
      id: createStableId("graph-edge", ["capture-primary", capture.primaryEntityKind, capture.primaryEntityId, capture.id]),
      source: primaryNodeId,
      target: nodeId,
      label: "captures",
      predicate: "captures",
      status: "active",
      confidence: 1,
      provider: "work-memory",
      meta: {
        origin: "capture_primary_entity",
        captureId: capture.id
      }
    });

    for (const related of capture.relatedEntities) {
      if (allowed && !allowed.has(`${related.entityKind}:${related.entityId}`)) continue;
      if (filters.relationTypes && !filters.relationTypes.includes(related.relationType)) {
        continue;
      }
      const relatedNodeId = ensureEntityNode(db, graph, related.entityKind, related.entityId);
      graph.addEdge({
        id: createStableId("graph-edge", ["capture-related", related.entityKind, related.entityId, related.relationType, capture.id]),
        source: relatedNodeId,
        target: nodeId,
        label: related.relationType,
        predicate: related.relationType,
      status: "active",
      confidence: 1,
      provider: "work-memory",
      meta: {
        origin: "capture_related_entity",
        captureId: capture.id
      }
    });
    }
  }
}

function addEntityRelations(db: WorkMemoryDatabase, graph: GraphViewBuilder, filters: GraphFilters, allowed?: Set<string>): void {
  for (const relation of db.listEntityRelations({})) {
    if (allowed && (
      !allowed.has(`${relation.sourceKind}:${relation.sourceId}`) ||
      !allowed.has(`${relation.targetKind}:${relation.targetId}`)
    )) continue;
    if (filters.relationTypes && !filters.relationTypes.includes(relation.relationType)) {
      continue;
    }
    const sourceNodeId = ensureEntityNode(db, graph, relation.sourceKind, relation.sourceId);
    const targetNodeId = ensureEntityNode(db, graph, relation.targetKind, relation.targetId);
    const capturedFrom = Array.isArray(relation.metadata?.capturedFrom)
      ? relation.metadata.capturedFrom.map(String)
      : undefined;
    graph.addEdge({
      id: relation.id,
      source: sourceNodeId,
      target: targetNodeId,
      label: relation.relationType,
      predicate: relation.relationType,
      status: "active",
      confidence: 1,
      provider: "work-memory",
      meta: relation.description || capturedFrom
        ? { relationId: relation.id, description: relation.description, capturedFrom }
        : { relationId: relation.id }
    });
  }
}

const GRAPH_SCOPE_BOUNDARY_KINDS = new Set([
  "person", "team", "domain", "subdomain", "repository", "oneagent",
  // Outcome entities are cross-cutting. They may be shown as explicitly
  // projected leaves, but must never become bridges into another product's
  // projects/features through a shared mission or OKR.
  "mission", "okr", "kpi"
]);

/**
 * Resolve entities belonging to the selected product slice. Expansion may reach
 * cross-cutting entities (people, teams, domains) but stops there, preventing a
 * shared person or team from pulling a different product's entire subgraph in.
 */
function resolveGraphEntityScope(db: WorkMemoryDatabase, productIds: string[]): Set<string> {
  const selectedProducts = new Set(productIds);
  const allowed = new Set(productIds.map((id) => `product:${id}`));
  const relations = db.listEntityRelations({});
  const canAdd = (kind: string, id: string): boolean => kind !== "product" || selectedProducts.has(id);
  const isTraversalBoundary = (kind: string, id: string): boolean =>
    GRAPH_SCOPE_BOUNDARY_KINDS.has(kind) || (kind === "product" && !selectedProducts.has(id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      const source = `${relation.sourceKind}:${relation.sourceId}`;
      const target = `${relation.targetKind}:${relation.targetId}`;
      if (allowed.has(source) && !isTraversalBoundary(relation.sourceKind, relation.sourceId) && !allowed.has(target)) {
        allowed.add(target);
        changed = true;
      }
      if (allowed.has(target) && !isTraversalBoundary(relation.targetKind, relation.targetId) && !allowed.has(source)) {
        allowed.add(source);
        changed = true;
      }
    }
  }


  // Preserve the useful product → work → OKR → KPI alignment without opening
  // the generic transitive closure through shared outcome nodes. These nodes
  // remain leaves for the scope resolver; only the declared forward projection
  // is added.
  let outcomeChanged = true;
  while (outcomeChanged) {
    outcomeChanged = false;
    for (const relation of relations) {
      const source = `${relation.sourceKind}:${relation.sourceId}`;
      const target = `${relation.targetKind}:${relation.targetId}`;
      const add = (ref: string): void => {
        if (!allowed.has(ref)) {
          allowed.add(ref);
          outcomeChanged = true;
        }
      };
      if (
        relation.relationType === "contributes_to"
        && allowed.has(source)
        && relation.targetKind === "okr"
      ) add(target);
      if (
        relation.relationType === "measured_by"
        && allowed.has(source)
        && relation.sourceKind === "okr"
        && relation.targetKind === "kpi"
      ) add(target);
      if (
        relation.relationType === "has_okr"
        && allowed.has(target)
        && relation.sourceKind === "mission"
        && relation.targetKind === "okr"
      ) add(source);
    }
  }

  const sourceIds = new Set(db.listSourceIdsForProducts(productIds));
  for (const capture of db.listCaptures({})) {
    const directProduct =
      (capture.primaryEntityKind === "product" && selectedProducts.has(capture.primaryEntityId)) ||
      capture.relatedEntities.some((ref) => ref.entityKind === "product" && selectedProducts.has(ref.entityId));
    const evidenced = Boolean(capture.sourceId && sourceIds.has(capture.sourceId));
    if (directProduct || evidenced) {
      if (canAdd(capture.primaryEntityKind, capture.primaryEntityId)) {
        allowed.add(`${capture.primaryEntityKind}:${capture.primaryEntityId}`);
      }
      for (const ref of capture.relatedEntities) {
        if (canAdd(ref.entityKind, ref.entityId)) allowed.add(`${ref.entityKind}:${ref.entityId}`);
      }
      continue;
    }
    const primaryAlreadyLinked = allowed.has(`${capture.primaryEntityKind}:${capture.primaryEntityId}`);
    if (primaryAlreadyLinked) {
      // Include the capture through its primary node, but do not use a shared
      // person/team/domain capture as a bridge into another product subgraph.
      continue;
    }
    const relatedNonBoundary = capture.relatedEntities.some((ref) =>
      allowed.has(`${ref.entityKind}:${ref.entityId}`) && !GRAPH_SCOPE_BOUNDARY_KINDS.has(ref.entityKind)
    );
    if (relatedNonBoundary && canAdd(capture.primaryEntityKind, capture.primaryEntityId)) {
      allowed.add(`${capture.primaryEntityKind}:${capture.primaryEntityId}`);
    }
  }
  return allowed;
}

function organizationIdsForProducts(config: WorkMemoryConfig, productIds: Set<string>): Set<string> {
  if (productIds.size === 0) return new Set((config.entities ?? []).map((entity) => entity.id));
  const byId = new Map((config.entities ?? []).map((entity) => [entity.id, entity]));
  const included = new Set<string>();
  const queue = config.products
    .filter((product) => productIds.has(product.id) && product.parentEntityId)
    .map((product) => product.parentEntityId as string);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (included.has(id)) continue;
    included.add(id);
    const parent = byId.get(id)?.parentId;
    if (parent) queue.push(parent);
  }
  return included;
}

/** Ensure the graph contains a node for an entity reference, adding it from the DB when needed. */
function ensureEntityNode(db: WorkMemoryDatabase, graph: GraphViewBuilder, kind: string, id: string): string {
  const nodeId = entityNodeId(kind, id);
  if (graph.hasNode(nodeId)) {
    return nodeId;
  }
  const entity = db.getEntity(kind, id);
  if (entity) {
    graph.addNode(dbEntityNode(entity));
  } else {
    graph.addNode({
      id: nodeId,
      label: id,
      type: graphTypeForEntityKind(kind),
      status: "candidate",
      provider: "work-memory",
      meta: { kind, entityId: id }
    });
  }
  return nodeId;
}

function entityHasAttachments(db: WorkMemoryDatabase, kind: string, id: string): boolean {
  return db.countCaptureReferences(kind, id) > 0 || db.listEntityRelations({ kind, id }).length > 0;
}

function dbEntityNode(entity: ReturnType<WorkMemoryDatabase["listEntities"]>[number]): GraphViewNode {
  return {
    id: entityNodeId(entity.kind, entity.id),
    label: entity.label || entity.id,
    type: graphTypeForEntityKind(entity.kind),
    status: mapStatus(entity.status),
    productIds: entity.kind === "product" ? [entity.id] : undefined,
    provider: "work-memory",
    meta: {
      kind: entity.kind,
      entityId: entity.id,
      description: entity.description,
      tags: entity.tags ?? [],
      focusLevel: entity.focusLevel,
      ownerIds: entity.ownerIds ?? [],
      contributorIds: entity.contributorIds ?? [],
      parentId: entity.parentId
    }
  };
}

/** Resolve an entity reference to a canonical graph node id, bridging config and DB node schemes. */
export function entityNodeId(kind: string, id: string): string {
  if (kind === "product") {
    return productNodeId(id);
  }
  if (kind === "repository") {
    return repositoryNodeId(id);
  }
  if (kind === "domain" || kind === "subdomain" || kind === "team") {
    return orgEntityNodeId(id);
  }
  return `entity:${kind}:${id}`;
}

function captureNodeId(captureId: string): string {
  return `capture:${captureId}`;
}

function graphTypeForEntityKind(kind: string): GraphNodeType {
  // Built-in and workspace-defined kinds are their own node type (color, filters);
  // anything unknown falls back to a plain concept node.
  return isEntityKind(kind) ? (kind as GraphNodeType) : "concept";
}

/** Prune a graph model to a focused entity node and its immediate neighbours. */
function focusModel(model: GraphViewModel, focusNodeId: string): GraphViewModel {
  const hasFocus = model.nodes.some((node) => node.id === focusNodeId);
  if (!hasFocus) {
    return {
      ...model,
      nodes: [],
      edges: [],
      diagnostics: [
        ...(model.diagnostics ?? []),
        { provider: "work-memory", status: "missing", message: `Focus entity not found: ${focusNodeId}` }
      ]
    };
  }

  const keep = new Set<string>([focusNodeId]);
  const edges = model.edges.filter((edge) => edge.source === focusNodeId || edge.target === focusNodeId);
  for (const edge of edges) {
    keep.add(edge.source);
    keep.add(edge.target);
  }
  return {
    ...model,
    nodes: model.nodes.filter((node) => keep.has(node.id)),
    edges
  };
}

function addGraphify(input: BuildGraphViewModelInput, products: ProductConfig[], graph: GraphViewBuilder): void {
  for (const product of products) {
    for (const repository of product.repositories) {
      if (input.refreshGraphify) {
        const result = refreshGraphifyRepository({
          repository,
          command: input.graphifyCommand,
          update: true
        });
        graph.addDiagnostic({
          provider: "graphify",
          status: result.ok ? "ok" : result.available ? "error" : "missing",
          message: `${repository.id}: ${result.message}`,
          path: result.graphPath
        });
      }

      const imported = importGraphifyGraph({
        repository,
        command: input.graphifyCommand,
        maxNodes: Math.max(0, graph.remainingNodeBudget()),
        maxEdges: Math.max(0, graph.remainingEdgeBudget())
      });
      graph.addDiagnostic(imported.diagnostic);
      for (const node of imported.nodes) {
        if (node.type !== "wiki_page") graph.addNode(node);
      }
      for (const edge of imported.edges) {
        graph.addEdge(edge);
      }
    }
  }
}

class GraphViewBuilder {
  private nodes = new Map<string, GraphViewNode>();
  private edges = new Map<string, GraphViewEdge>();
  private droppedNodeIds = new Set<string>();
  private droppedEdgeIds = new Set<string>();
  private diagnostics: GraphViewDiagnostic[] = [];
  private scope: ScopeMode;
  private activeProductId: string | undefined;
  private includedProductIds: string[];
  private maxNodes: number;
  private maxEdges: number;

  constructor(
    scope: ScopeMode,
    activeProductId: string | undefined,
    includedProductIds: string[],
    maxNodes: number,
    maxEdges: number
  ) {
    this.scope = scope;
    this.activeProductId = activeProductId;
    this.includedProductIds = includedProductIds;
    this.maxNodes = maxNodes;
    this.maxEdges = maxEdges;
  }

  addNode(node: GraphViewNode): void {
    const existing = this.nodes.get(node.id);
    if (existing) {
      this.nodes.set(node.id, {
        ...existing,
        ...node,
        productIds: mergeStringArrays(existing.productIds, node.productIds),
        meta: {
          ...(existing.meta ?? {}),
          ...(node.meta ?? {})
        }
      });
      return;
    }
    if (this.nodes.size >= this.maxNodes) {
      this.droppedNodeIds.add(node.id);
      return;
    }
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphViewEdge): void {
    if (this.edges.has(edge.id)) {
      return;
    }
    if (this.edges.size >= this.maxEdges) {
      this.droppedEdgeIds.add(edge.id);
      return;
    }
    this.edges.set(edge.id, edge);
  }

  addDiagnostic(diagnostic: GraphViewDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  remainingNodeBudget(): number {
    return this.maxNodes - this.nodes.size;
  }

  remainingEdgeBudget(): number {
    return this.maxEdges - this.edges.size;
  }

  toModel(): GraphViewModel {
    const diagnostics = [...this.diagnostics];
    if (this.droppedNodeIds.size > 0 || this.droppedEdgeIds.size > 0) {
      diagnostics.push({
        provider: "work-memory",
        status: "degraded",
        message: `Graph data truncated at ${this.maxNodes} nodes / ${this.maxEdges} edges: ${this.droppedNodeIds.size} additional node(s) and ${this.droppedEdgeIds.size} additional edge(s) omitted. Narrow the graph scope or increase its limits.`
      });
    }
    return {
      activeProductId: this.activeProductId,
      scope: this.scope,
      includedProductIds: this.includedProductIds,
      generatedAt: nowIso(),
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()).filter((edge) => this.nodes.has(edge.source) && this.nodes.has(edge.target)),
      diagnostics: dedupeDiagnostics(diagnostics)
    };
  }
}

function productNode(product: ProductConfig): GraphViewNode {
  return {
    id: productNodeId(product.id),
    label: product.label || product.id,
    type: "product",
    status: "active",
    productIds: [product.id],
    confidence: 1,
    provider: "work-memory",
    meta: {
      description: product.description,
      dependencies: product.dependencies ?? []
    }
  };
}

function repositoryNode(repository: RepositoryConfig): GraphViewNode {
  return {
    id: repositoryNodeId(repository.id),
    label: repository.id,
    type: "repository",
    status: "active",
    productIds: [repository.productId],
    path: repository.path,
    confidence: 1,
    provider: "work-memory",
    meta: {
      role: repository.role,
      wikiRoot: repository.wikiRoot,
      specsRoot: repository.specsRoot
    }
  };
}

function sourceNode(source: SourceGraphRow): GraphViewNode {
  const rawPath = source.rawPath || source.originUri;
  return {
    id: sourceNodeId(source.id),
    label: source.title,
    type: source.sourceType === "wiki_page" || isWikiPath(rawPath) ? "wiki_page" : "source",
    status: mapStatus(source.status),
    productIds: [source.productId],
    path: rawPath,
    sourceId: source.id,
    confidence: 1,
    provider: "work-memory",
    meta: {
      sourceType: source.sourceType
    }
  };
}

function relationEntityNode(label: string): GraphViewNode {
  return {
    id: relationEntityNodeId(label),
    label,
    type: "concept",
    status: "candidate",
    provider: "fallback"
  };
}

function productNodeId(productId: string): string {
  return `product:${productId}`;
}

function orgEntityNodeId(entityId: string): string {
  return `entity:${entityId}`;
}

function repositoryNodeId(repositoryId: string): string {
  return `repository:${repositoryId}`;
}

function conceptNodeId(conceptId: string): string {
  return `concept:${conceptId}`;
}

function sourceNodeId(sourceId: string): string {
  return `source:${sourceId}`;
}

function inboxNodeId(inboxId: string): string {
  return `inbox:${inboxId}`;
}

function taskNodeId(taskId: string): string {
  return `task:${taskId}`;
}

function relationEntityNodeId(label: string): string {
  return `entity:${createStableId("entity", [label.toLowerCase()])}`;
}

function conceptTypeToGraphType(conceptType: string): GraphNodeType {
  if (conceptType === "decision") {
    return "decision";
  }
  if (conceptType === "question") {
    return "question";
  }
  if (conceptType === "risk") {
    return "risk";
  }
  if (conceptType === "task") {
    return "task";
  }
  return "concept";
}

function inboxTypeToGraphType(type: InboxItemType): GraphNodeType {
  if (type === "decision_candidate") {
    return "decision";
  }
  if (type === "open_question") {
    return "question";
  }
  if (type === "risk") {
    return "risk";
  }
  if (type === "task") {
    return "task";
  }
  return "wiki_page";
}

function mapStatus(status: string | undefined): GraphNodeStatus {
  if (
    status === "accepted" ||
    status === "active" ||
    status === "candidate" ||
    status === "conflicted" ||
    status === "deprecated" ||
    status === "indexed" ||
    status === "open" ||
    status === "pending" ||
    status === "rejected" ||
    status === "reviewed" ||
    status === "superseded" ||
    status === "validated"
  ) {
    return status;
  }
  return "unknown";
}

function taskStatusToGraphStatus(status: string | undefined): GraphNodeStatus {
  if (status === "in_progress") return "active";
  if (status === "done") {
    return "accepted";
  }
  if (status === "blocked") {
    return "conflicted";
  }
  if (status === "ready") {
    return "validated";
  }
  return mapStatus(status);
}

function isWikiPath(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.split(path.sep).join("/");
  return normalized.includes("/docs/wiki/") || normalized.endsWith("/docs/wiki") || normalized.includes("docs/wiki/");
}

function placeholders(values: string[]): string {
  if (values.length === 0) {
    return "NULL";
  }
  return values.map(() => "?").join(", ");
}

function mergeStringArrays(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = Array.from(new Set([...(left ?? []), ...(right ?? [])]));
  return merged.length > 0 ? merged : undefined;
}

function dedupeDiagnostics(diagnostics: GraphViewDiagnostic[]): GraphViewDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.provider}|${diagnostic.status}|${diagnostic.path ?? ""}|${diagnostic.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
