import type {
  AgentContextScope,
  EntityRef,
  EntityRelationRecord,
  GraphViewModel,
  GraphViewNode,
  ResolvedContextScope
} from "../../shared/src/index.ts";
import { contextSelectionRole, normalizeContextScope } from "../../shared/src/index.ts";
import { inspectInboxPayloadReferences, type WorkMemoryDatabase } from "../../storage/src/index.ts";
import { entityNodeId } from "./view-model.ts";

export interface ResolveContextScopeInput {
  db: WorkMemoryDatabase;
  scope: AgentContextScope;
}

/**
 * Resolve a user-defined agent context scope into a concrete retrieval boundary.
 *
 * The scope is entity-centric (a "current entity" can be a product, team,
 * person, feature, …), so it cannot be expressed as a product filter. Instead it
 * resolves through the graph: selected entities are expanded over typed
 * relations up to `depth`, then every in-scope entity contributes its captures'
 * sources (entity-native) plus, for product entities, the product's linked
 * sources. The union is a source-id allowlist the retrieval layer can apply.
 */
export function resolveContextScope(input: ResolveContextScopeInput): ResolvedContextScope {
  const { db } = input;
  const scope = normalizeContextScope(input.scope);
  const includedTypes = scope.includedTypes ? new Set<string>(scope.includedTypes) : undefined;
  const allowedRelations = scope.allowedRelationTypes ? new Set(scope.allowedRelationTypes) : undefined;
  const entityStatuses = scope.entityStatuses ? new Set(scope.entityStatuses) : undefined;
  const refKey = (ref: EntityRef): string => `${ref.kind}:${ref.id}`;
  const relationsByEntity = new Map<string, EntityRelationRecord[]>();
  const hydratedRelationRefs = new Set<string>();
  const hydrateEntityRelations = (refs: EntityRef[]): void => {
    const missing = [...new Map(refs
      .filter((ref) => !hydratedRelationRefs.has(refKey(ref)))
      .map((ref) => [refKey(ref), ref])).values()];
    if (missing.length === 0) return;
    const missingKeys = new Set(missing.map(refKey));
    for (const ref of missing) {
      hydratedRelationRefs.add(refKey(ref));
      relationsByEntity.set(refKey(ref), []);
    }
    for (const relation of db.listEntityRelationsForEntities(missing)) {
      const sourceKey = `${relation.sourceKind}:${relation.sourceId}`;
      const targetKey = `${relation.targetKind}:${relation.targetId}`;
      if (missingKeys.has(sourceKey)) relationsByEntity.get(sourceKey)?.push(relation);
      if (targetKey !== sourceKey && missingKeys.has(targetKey)) relationsByEntity.get(targetKey)?.push(relation);
    }
  };
  const entityRelations = (ref: EntityRef): EntityRelationRecord[] => {
    const key = refKey(ref);
    hydrateEntityRelations([ref]);
    return relationsByEntity.get(key) ?? [];
  };
  const entitiesByRef = new Map<string, ReturnType<WorkMemoryDatabase["getEntity"]>>();
  const hydratedEntityRefs = new Set<string>();
  const hydrateEntities = (refs: EntityRef[]): void => {
    if (!entityStatuses) return;
    const missing = [...new Map(refs
      .filter((ref) => !hydratedEntityRefs.has(refKey(ref)))
      .map((ref) => [refKey(ref), ref])).values()];
    if (missing.length === 0) return;
    for (const ref of missing) hydratedEntityRefs.add(refKey(ref));
    for (const entity of db.listEntitiesByRefs(missing)) entitiesByRef.set(refKey(entity), entity);
  };
  const excluded = new Set((scope.excludedEntities ?? []).map(refKey));
  const explicitRoots = new Set(scope.selectedEntities.map(refKey));
  const allowed = (ref: EntityRef): boolean => {
    if (excluded.has(refKey(ref))) return false;
    // A proposed node is only a suggestion. Reaching it through another
    // confirmed node must never turn it into context implicitly.
    const selectedRole = contextSelectionRole(scope, ref);
    if (selectedRole === "proposed" || selectedRole === "excluded") return false;
    if (includedTypes && !includedTypes.has(ref.kind)) return false;
    if (!entityStatuses) return true;
    hydrateEntities([ref]);
    const entity = entitiesByRef.get(refKey(ref));
    return !entity || entityStatuses.has(entity.status);
  };

  /*
   * A strict product context treats products as data boundaries, not merely as
   * graph nodes. Direct product neighbours of an explicitly selected
   * non-product root establish that root's home product. Crossing from one
   * product to another then requires either another explicit root or a direct
   * product-to-product relation whose type the user explicitly allow-listed.
   *
   * People reached from a product scope remain visible as boundary metadata,
   * but they are leaves and do not contribute captures. This prevents a shared
   * person from becoming an accidental bridge into every product they touch;
   * selecting that person explicitly still opts into their wider context.
   */
  const authorizedProductIds = strictProductBoundary(
    scope,
    allowedRelations,
    allowed,
    entityRelations,
    hydrateEntityRelations,
    hydrateEntities
  );
  const productBoundaryActive = scope.mode === "strict" && authorizedProductIds.size > 0;
  const productAffiliations = new Map<string, Set<string>>();
  const directProductsFor = (ref: EntityRef): Set<string> => {
    const key = refKey(ref);
    const cached = productAffiliations.get(key);
    if (cached) return cached;
    const products = new Set<string>();
    if (ref.kind === "product") products.add(ref.id);
    for (const relation of entityRelations(ref)) {
      const neighbor = relationNeighbor(relation, ref);
      if (neighbor?.kind === "product") products.add(neighbor.id);
    }
    productAffiliations.set(key, products);
    return products;
  };
  const contentBlocked = new Set<string>();

  const seen = new Map<string, EntityRef>();
  const roles: Record<string, ResolvedContextScope["roles"][string]> = {};
  let frontier: EntityRef[] = [];
  for (const ref of scope.selectedEntities) {
    const key = refKey(ref);
    if (!excluded.has(key) && !seen.has(key)) {
      seen.set(key, ref);
      roles[key] = contextSelectionRole(scope, ref) ?? "included";
      frontier.push(ref);
    }
  }

  for (let level = 0; level < scope.depth && frontier.length > 0; level += 1) {
    hydrateEntityRelations(frontier);
    const frontierNeighbors = frontier.flatMap((ref) =>
      entityRelations(ref).flatMap((relation) => {
        const neighbor = relationNeighbor(relation, ref);
        return neighbor ? [neighbor] : [];
      })
    );
    hydrateEntities(frontierNeighbors);
    if (productBoundaryActive) hydrateEntityRelations(frontierNeighbors);
    const next: EntityRef[] = [];
    for (const ref of frontier) {
      for (const relation of entityRelations(ref)) {
        if (allowedRelations && !allowedRelations.has(relation.relationType)) continue;
        const neighbor = relationNeighbor(relation, ref);
        if (!neighbor || !allowed(neighbor) || seen.has(refKey(neighbor))) {
          continue;
        }
        const key = refKey(neighbor);
        if (productBoundaryActive) {
          if (neighbor.kind === "product" && !authorizedProductIds.has(neighbor.id)) {
            continue;
          }
          const affiliations = directProductsFor(neighbor);
          if (affiliations.size > 0 && ![...affiliations].some((productId) => authorizedProductIds.has(productId))) {
            continue;
          }
        }
        seen.set(key, neighbor);
        roles[key] = contextSelectionRole(scope, neighbor) ?? "included";
        if (productBoundaryActive && neighbor.kind === "person" && !explicitRoots.has(key)) {
          contentBlocked.add(key);
          continue;
        }
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  const entities = [...seen.values()];
  const sourceIds = new Set<string>();
  const captureIds = new Set<string>();
  const contentEntityKeys = new Set(entities.filter((ref) => !contentBlocked.has(refKey(ref))).map(refKey));
  const contentEntities = entities.filter((ref) => contentEntityKeys.has(refKey(ref)));
  const productIds = entities.filter((ref) => ref.kind === "product").map((ref) => ref.id);
  const captureCandidates = db.listEntityCaptureContextRecords(contentEntities);
  const entitySourceIds = db.listSourceIdsForEntities(contentEntities, scope.sourceStatuses ?? ["indexed"]);
  const candidateSourceIds = [
    ...captureCandidates.flatMap((capture) => capture.sourceId ? [capture.sourceId] : []),
    ...entitySourceIds
  ];
  const sourcesById = new Map(
    db.listSourcesByIds(candidateSourceIds).map((source) => [String(source.id), source])
  );

  for (const capture of captureCandidates) {
    if (!insideTimeRange(capture.createdAt, scope.timeRange)) continue;
    captureIds.add(capture.captureId);
    if (capture.sourceId && sourceAllowed(sourcesById.get(capture.sourceId), scope)) {
      sourceIds.add(capture.sourceId);
    }
  }

  for (const sourceId of entitySourceIds) {
    if (sourceAllowed(sourcesById.get(sourceId), scope)) sourceIds.add(sourceId);
  }

  const productIdSet = new Set(productIds);
  const taskIds = new Set<string>();
  const candidateTasks = db.listTaskContextCandidates({
    productIds,
    sourceIds: [...sourceIds],
    entityRefs: contentEntities,
    includeArchived: false
  });
  const linksByTask = new Map<string, ReturnType<WorkMemoryDatabase["listTaskLinks"]>>();
  for (const link of db.listTaskLinks(candidateTasks.map((task) => task.id))) {
    const links = linksByTask.get(link.taskId) ?? [];
    links.push(link);
    linksByTask.set(link.taskId, links);
  }
  for (const task of candidateTasks) {
    if (!insideTimeRange(task.updatedAt ?? task.createdAt, scope.timeRange)) continue;
    const taskLinks = linksByTask.get(task.id) ?? [];
    const linkedInside = taskLinks.some((link) => contentEntityKeys.has(`${link.targetKind}:${link.targetId}`));
    const productInside = Boolean(task.productId && productIdSet.has(task.productId));
    const sourceInside = Boolean(task.sourceId && sourceIds.has(task.sourceId));
    const hasAnchor = productInside || sourceInside || linkedInside;
    const allDimensionsInside = (!task.productId || productInside)
      && (!task.sourceId || sourceInside)
      && taskLinks.every((link) =>
        contentEntityKeys.has(`${link.targetKind}:${link.targetId}`)
        && (!allowedRelations || allowedRelations.has(link.relationType))
      );
    if (hasAnchor && (scope.mode !== "strict" || allDimensionsInside)) {
      taskIds.add(task.id);
    }
  }

  const observationIds = new Set<string>();
  const curationPackageIds = new Set<string>();
  const observationValidationStatuses = new Set(scope.observationValidationStatuses ?? scope.validationStatuses ?? ["captured", "proposed", "accepted"]);
  const observationEvidenceStatuses = scope.observationEvidenceStatuses ? new Set(scope.observationEvidenceStatuses) : undefined;
  const observationCandidates = db.listObservationContextCandidates({
    sourceIds: [...sourceIds],
    captureIds: [...captureIds],
    entityRefs: contentEntities,
    validationStatuses: [...observationValidationStatuses],
    evidenceStatuses: observationEvidenceStatuses ? [...observationEvidenceStatuses] : undefined
  }).filter((observation) => {
    if (!insideTimeRange(observation.updatedAt ?? observation.createdAt, scope.timeRange)) return false;
    if (!observationValidationStatuses.has(observation.validationStatus)) return false;
    if (observationEvidenceStatuses && !observationEvidenceStatuses.has(observation.evidenceStatus)) return false;
    if (scope.observationMeasurement === "measured" && !observation.measurement) return false;
    if (scope.observationMeasurement === "unmeasured" && observation.measurement) return false;
    return true;
  });
  const evidenceByObservation = new Map<string, ReturnType<WorkMemoryDatabase["listObservationEvidence"]>>();
  if (scope.mode === "strict") {
    for (const evidence of db.listObservationEvidenceForObservations(observationCandidates.map((observation) => observation.id))) {
      const records = evidenceByObservation.get(evidence.observationId) ?? [];
      records.push(evidence);
      evidenceByObservation.set(evidence.observationId, records);
    }
  }
  for (const observation of observationCandidates) {
    const sourceInside = sourceIds.has(observation.sourceId);
    const captureInside = Boolean(observation.captureId && captureIds.has(observation.captureId));
    const subjectComplete = Boolean(observation.subjectKind && observation.subjectId);
    const subjectInside = Boolean(subjectComplete && contentEntityKeys.has(`${observation.subjectKind}:${observation.subjectId}`));
    const anyPrimaryDimensionInside = sourceInside || captureInside || subjectInside;
    const allPrimaryDimensionsInside = sourceInside
      && (!observation.captureId || captureInside)
      && subjectComplete
      && subjectInside;
    const allEvidenceInside = (evidenceByObservation.get(observation.id) ?? []).every((evidence) =>
      sourceIds.has(evidence.sourceId) && (!evidence.captureId || captureIds.has(evidence.captureId))
    );
    if (anyPrimaryDimensionInside && (scope.mode !== "strict" || (allPrimaryDimensionsInside && allEvidenceInside))) {
      observationIds.add(observation.id);
      curationPackageIds.add(observation.packageId);
    }
  }

  // A KPI measurement can carry its own accepted provenance even when the
  // source is not otherwise attached to the selected graph entities. Resolve
  // that explicit attachment without broadening to every observation from the
  // same source. `sourceAccess=none` remains fail-closed for sourced values.
  if (scope.sourceAccess !== "none") {
    const kpiIds = contentEntities.filter((entity) => entity.kind === "kpi").map((entity) => entity.id);
    const measurements = db.listKpiMeasurementsForKpis(kpiIds, 500).filter((measurement) =>
      insideTimeRange(measurement.measuredAt, scope.timeRange)
    );
    const measurementObservationIds = [...new Set(measurements
      .map((measurement) => measurement.observationId)
      .filter((value): value is string => Boolean(value)))];
    const measurementObservations = new Map(
      db.listObservationsByIds(measurementObservationIds).map((observation) => [observation.id, observation])
    );
    const measurementEvidence = new Map<string, ReturnType<WorkMemoryDatabase["listObservationEvidence"]>>();
    const observationCandidateIds = new Set(observationCandidates.map((observation) => observation.id));
    for (const observationId of measurementObservationIds) {
      if (observationCandidateIds.has(observationId)) {
        measurementEvidence.set(observationId, evidenceByObservation.get(observationId) ?? []);
      }
    }
    const missingMeasurementEvidenceIds = measurementObservationIds.filter((id) => !observationCandidateIds.has(id));
    for (const evidence of missingMeasurementEvidenceIds.length > 0
      ? db.listObservationEvidenceForObservations(missingMeasurementEvidenceIds)
      : []) {
      const records = measurementEvidence.get(evidence.observationId) ?? [];
      records.push(evidence);
      measurementEvidence.set(evidence.observationId, records);
    }
    const measurementSourceIds = [...new Set(measurements.flatMap((measurement) => {
      const observation = measurement.observationId ? measurementObservations.get(measurement.observationId) : undefined;
      return [
        measurement.sourceId,
        observation?.sourceId,
        ...(observation ? (measurementEvidence.get(observation.id) ?? []).map((evidence) => evidence.sourceId) : [])
      ].filter((value): value is string => Boolean(value));
    }))];
    const measurementSources = new Map(
      db.listSourcesByIds(measurementSourceIds).map((source) => [String(source.id), source])
    );
    const sourceIsAllowed = (sourceId: string): boolean => {
      const source = measurementSources.get(sourceId);
      return Boolean(source && sourceAllowed(source, scope));
    };
    for (const measurement of measurements) {
      const observation = measurement.observationId ? measurementObservations.get(measurement.observationId) : undefined;
      const primarySourceId = measurement.sourceId ?? observation?.sourceId;
      if (measurement.observationId && !observation) continue;
      if (observation) {
        if (observation.validationStatus !== "accepted" || !observationValidationStatuses.has(observation.validationStatus)) continue;
        if (observationEvidenceStatuses && !observationEvidenceStatuses.has(observation.evidenceStatus)) continue;
        if (!insideTimeRange(observation.updatedAt ?? observation.createdAt, scope.timeRange)) continue;
        if (scope.observationMeasurement === "measured" && !observation.measurement) continue;
        if (scope.observationMeasurement === "unmeasured" && observation.measurement) continue;
        if (measurement.sourceId && observation.sourceId !== measurement.sourceId) continue;
      }
      if (primarySourceId && !sourceIsAllowed(primarySourceId)) continue;
      const evidence = observation ? measurementEvidence.get(observation.id) ?? [] : [];
      if (!evidence.every((item) => sourceIsAllowed(item.sourceId))) continue;
      if (primarySourceId) sourceIds.add(primarySourceId);
      for (const item of evidence) sourceIds.add(item.sourceId);
      if (observation) {
        observationIds.add(observation.id);
        curationPackageIds.add(observation.packageId);
      }
    }
  }

  for (const packageRecord of db.listCurationPackageContextCandidates({
    sourceIds: [...sourceIds],
    captureIds: [...captureIds]
  })) {
    if (!insideTimeRange(packageRecord.updatedAt ?? packageRecord.createdAt, scope.timeRange)) continue;
    const sourceInside = sourceIds.has(packageRecord.sourceId);
    const captureInside = Boolean(packageRecord.captureId && captureIds.has(packageRecord.captureId));
    const hasAnchor = sourceInside || captureInside;
    const allDimensionsInside = sourceInside
      && (!packageRecord.captureId || captureInside);
    if (hasAnchor && (scope.mode !== "strict" || allDimensionsInside)) {
      curationPackageIds.add(packageRecord.id);
    }
  }

  const inboxItemIds = new Set<string>();
  for (const item of db.listInboxContextCandidates({
    productIds,
    sourceIds: [...sourceIds],
    captureIds: [...captureIds],
    entityRefs: [...contentEntityKeys],
    observationIds: [...observationIds],
    relationTypes: allowedRelations ? [...allowedRelations] : undefined
  })) {
    if (!insideTimeRange(item.updatedAt ?? item.createdAt, scope.timeRange)) continue;
    const payloadRefs = inspectInboxPayloadReferences(item.payload);
    const productInside = Boolean(item.productId && productIdSet.has(item.productId));
    const sourceInside = Boolean(item.sourceId && sourceIds.has(item.sourceId));
    const payloadProductsInside = payloadRefs.productIds.every((id) => productIdSet.has(id));
    const payloadSourcesInside = payloadRefs.sourceIds.every((id) => sourceIds.has(id));
    const payloadCapturesInside = payloadRefs.captureIds.every((id) => captureIds.has(id));
    const payloadEntitiesInside = payloadRefs.entityRefs.every((ref) => contentEntityKeys.has(ref));
    const payloadObservationsInside = payloadRefs.observationIds.every((id) => observationIds.has(id));
    const payloadRelationsInside = !allowedRelations || payloadRefs.relationTypes.every((type) => allowedRelations.has(type));
    const hasAnchor = productInside
      || sourceInside
      || payloadRefs.productIds.some((id) => productIdSet.has(id))
      || payloadRefs.sourceIds.some((id) => sourceIds.has(id))
      || payloadRefs.captureIds.some((id) => captureIds.has(id))
      || payloadRefs.entityRefs.some((ref) => contentEntityKeys.has(ref))
      || payloadRefs.observationIds.some((id) => observationIds.has(id));
    const allDimensionsInside = (!item.productId || productInside)
      && (!item.sourceId || sourceInside)
      && payloadProductsInside
      && payloadSourcesInside
      && payloadCapturesInside
      && payloadEntitiesInside
      && payloadObservationsInside
      && payloadRelationsInside;
    if (hasAnchor && (scope.mode !== "strict" || allDimensionsInside)) inboxItemIds.add(item.id);
  }

  return {
    scope,
    entities,
    roles,
    metadataOnlyEntityRefs: [...contentBlocked],
    sourceIds: [...sourceIds],
    captureIds: [...captureIds],
    taskIds: [...taskIds],
    inboxItemIds: [...inboxItemIds],
    observationIds: [...observationIds],
    curationPackageIds: [...curationPackageIds],
    counts: {
      entities: entities.length,
      captures: captureIds.size,
      sources: sourceIds.size,
      tasks: taskIds.size,
      inbox: inboxItemIds.size,
      observations: observationIds.size,
      curationPackages: curationPackageIds.size
    }
  };
}

function strictProductBoundary(
  scope: AgentContextScope,
  allowedRelations: Set<string> | undefined,
  entityAllowed: (ref: EntityRef) => boolean,
  entityRelations: (ref: EntityRef) => EntityRelationRecord[],
  hydrateEntityRelations: (refs: EntityRef[]) => void,
  hydrateEntities: (refs: EntityRef[]) => void
): Set<string> {
  const authorized = new Set(scope.selectedEntities.filter((ref) => ref.kind === "product").map((ref) => ref.id));
  if (scope.mode !== "strict") return authorized;

  // A selected feature/project/etc. may establish its directly related product
  // without requiring the product to be selected separately.
  const nonProductRoots = scope.selectedEntities.filter((ref) => ref.kind !== "product");
  hydrateEntityRelations(nonProductRoots);
  const rootNeighbors = nonProductRoots.flatMap((root) =>
    entityRelations(root).flatMap((relation) => {
      const neighbor = relationNeighbor(relation, root);
      return neighbor ? [neighbor] : [];
    })
  );
  hydrateEntities(rootNeighbors);
  for (const root of nonProductRoots) {
    for (const relation of entityRelations(root)) {
      if (allowedRelations && !allowedRelations.has(relation.relationType)) continue;
      const neighbor = relationNeighbor(relation, root);
      if (neighbor?.kind === "product" && entityAllowed(neighbor)) authorized.add(neighbor.id);
    }
  }

  // Cross-product expansion is opt-in: unlike ordinary traversal, the edge
  // type must have been explicitly listed by the user.
  if (!allowedRelations || authorized.size === 0) return authorized;
  let frontier = [...authorized];
  for (let level = 0; level < scope.depth && frontier.length > 0; level += 1) {
    const frontierRefs = frontier.map((productId) => ({ kind: "product" as const, id: productId }));
    hydrateEntityRelations(frontierRefs);
    const productNeighbors = frontierRefs.flatMap((product) =>
      entityRelations(product).flatMap((relation) => {
        const neighbor = relationNeighbor(relation, product);
        return neighbor ? [neighbor] : [];
      })
    );
    hydrateEntities(productNeighbors);
    const next: string[] = [];
    for (const productId of frontier) {
      const product = { kind: "product" as const, id: productId };
      for (const relation of entityRelations(product)) {
        if (!allowedRelations.has(relation.relationType)) continue;
        const neighbor = relationNeighbor(relation, product);
        if (neighbor?.kind !== "product" || !entityAllowed(neighbor) || authorized.has(neighbor.id)) continue;
        authorized.add(neighbor.id);
        next.push(neighbor.id);
      }
    }
    frontier = next;
  }
  return authorized;
}

function insideTimeRange(value: string | undefined, range: AgentContextScope["timeRange"]): boolean {
  if (!range || !value) return true;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return true;
  if (range.from && timestamp < rangeBoundary(range.from, false)) return false;
  if (range.to && timestamp > rangeBoundary(range.to, true)) return false;
  return true;
}

function rangeBoundary(value: string, endOfDay: boolean): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return endOfDay ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parsed + 86_400_000 - 1 : parsed;
}

function sourceAllowed(source: Record<string, unknown> | undefined, scope: AgentContextScope): boolean {
  // Keep legacy/dangling capture source ids in the allowlist. They cannot yield
  // content, but dropping them would make an existing strict scope narrower in
  // a surprising way before integrity repair has run.
  if (!source) return true;
  if (!insideTimeRange(String(source.capturedAt ?? source.updatedAt ?? ""), scope.timeRange)) return false;
  if (scope.sourceStatuses && !scope.sourceStatuses.includes(String(source.status ?? ""))) return false;
  return true;
}

/**
 * Apply an active context scope to a graph view model. In strict mode the
 * model is pruned to in-scope nodes (scope entities, their captures and
 * sources) and the edges between them; in guided mode nothing is removed but
 * every node is annotated with `meta.inContextScope` so consumers can flag
 * out-of-scope material instead of silently mixing it in.
 */
export function applyContextScopeToGraphView(model: GraphViewModel, resolved: ResolvedContextScope): GraphViewModel {
  const inScopeNodeIds = new Set<string>();
  const metadataOnlyNodeIds = new Set(
    (resolved.metadataOnlyEntityRefs ?? []).map((ref) => {
      const separator = ref.indexOf(":");
      return separator > 0 ? entityNodeId(ref.slice(0, separator), ref.slice(separator + 1)) : ref;
    })
  );
  for (const ref of resolved.entities) {
    const nodeId = entityNodeId(ref.kind, ref.id);
    inScopeNodeIds.add(nodeId);
  }
  const contentPlaneAllowed = resolved.scope.mode !== "strict" || resolved.scope.sourceAccess !== "none";
  const allowedCaptureIds = new Set(contentPlaneAllowed ? resolved.captureIds : []);
  if (contentPlaneAllowed) {
    for (const captureId of allowedCaptureIds) inScopeNodeIds.add(`capture:${captureId}`);
  }
  const sourceIds = new Set(contentPlaneAllowed ? resolved.sourceIds : []);
  const allowedRelations = resolved.scope.allowedRelationTypes ? new Set(resolved.scope.allowedRelationTypes) : undefined;
  const relationAllowed = (predicate: string): boolean => !allowedRelations || allowedRelations.has(predicate);
  const inScope = (node: GraphViewNode): boolean =>
    inScopeNodeIds.has(node.id) || Boolean(node.id.startsWith("source:") && node.sourceId && sourceIds.has(node.sourceId));

  if (resolved.scope.mode === "strict") {
    const allowedProductIds = new Set(
      resolved.entities
        .filter((ref) => ref.kind === "product")
        .map((ref) => ref.id)
    );
    const nodes = model.nodes.filter(inScope).map((node) => sanitizeStrictGraphNode(node, {
      allowedProductIds,
      sourceIds,
      allowedCaptureIds,
      metadataOnlyNodeIds
    }));
    const kept = new Set(nodes.map((node) => node.id));
    return {
      ...model,
      activeProductId: model.activeProductId && allowedProductIds.has(model.activeProductId)
        ? model.activeProductId
        : undefined,
      includedProductIds: model.includedProductIds.filter((id) => allowedProductIds.has(id)),
      nodes,
      edges: model.edges
        .filter((edge) => kept.has(edge.source) && kept.has(edge.target) && relationAllowed(edge.predicate))
        .map((edge) => metadataOnlyNodeIds.has(edge.source) || metadataOnlyNodeIds.has(edge.target)
          ? sanitizeMetadataOnlyGraphEdge(edge)
          : sanitizeStrictGraphEdge(edge, sourceIds, allowedCaptureIds)),
      // Graphify diagnostics may contain repository ids and absolute paths from
      // products outside the strict boundary. Diagnostics are operational, not
      // part of the selected context, so the strict response omits them.
      diagnostics: []
    };
  }

  const guidedNodeIds = new Set(model.nodes.filter(inScope).map((node) => node.id));
  return {
    ...model,
    nodes: model.nodes.map((node) => ({ ...node, meta: { ...node.meta, inContextScope: inScope(node) } })),
    edges: model.edges.map((edge) => ({
      ...edge,
      meta: {
        ...edge.meta,
        inContextScope: relationAllowed(edge.predicate)
          && guidedNodeIds.has(edge.source)
          && guidedNodeIds.has(edge.target)
      }
    }))
  };
}

function sanitizeStrictGraphNode(
  node: GraphViewNode,
  boundary: {
    allowedProductIds: Set<string>;
    sourceIds: Set<string>;
    allowedCaptureIds: Set<string>;
    metadataOnlyNodeIds: Set<string>;
  }
): GraphViewNode {
  if (boundary.metadataOnlyNodeIds.has(node.id)) {
    // Shared people (and any future boundary metadata entity) remain useful
    // graph leaves, but must not carry content, status, paths or provenance
    // from the products they connect.
    return { id: node.id, label: node.label, type: node.type };
  }
  const productIds = node.productIds?.filter((id) => boundary.allowedProductIds.has(id));
  const sourceId = node.sourceId && boundary.sourceIds.has(node.sourceId) ? node.sourceId : undefined;
  const meta = sanitizeStrictGraphMeta(node.meta, boundary.sourceIds, boundary.allowedCaptureIds, boundary.allowedProductIds);
  return {
    ...node,
    productIds: productIds?.length ? productIds : undefined,
    sourceId,
    // Repository nodes and diagnostics expose local checkout paths. The node
    // identity is sufficient for strict navigation.
    path: node.type === "repository" ? undefined : node.path,
    meta
  };
}

function sanitizeMetadataOnlyGraphEdge(
  edge: GraphViewModel["edges"][number]
): GraphViewModel["edges"][number] {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    predicate: edge.predicate
  };
}

function sanitizeStrictGraphEdge(
  edge: GraphViewModel["edges"][number],
  sourceIds: Set<string>,
  captureIds: Set<string>
): GraphViewModel["edges"][number] {
  return {
    ...edge,
    sourceId: edge.sourceId && sourceIds.has(edge.sourceId) ? edge.sourceId : undefined,
    meta: sanitizeStrictGraphMeta(edge.meta, sourceIds, captureIds, new Set())
  };
}

function sanitizeStrictGraphMeta(
  meta: Record<string, unknown> | undefined,
  sourceIds: Set<string>,
  captureIds: Set<string>,
  productIds: Set<string>
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const sanitized = { ...meta };
  if (typeof sanitized.sourceId === "string" && !sourceIds.has(sanitized.sourceId)) delete sanitized.sourceId;
  if (typeof sanitized.captureId === "string" && !captureIds.has(sanitized.captureId)) delete sanitized.captureId;
  if (Array.isArray(sanitized.capturedFrom)) {
    const capturedFrom = sanitized.capturedFrom.map(String).filter((id) => captureIds.has(id));
    if (capturedFrom.length > 0) sanitized.capturedFrom = capturedFrom;
    else delete sanitized.capturedFrom;
  }
  if (Array.isArray(sanitized.dependencies)) {
    sanitized.dependencies = sanitized.dependencies.map(String).filter((id) => productIds.has(id));
  }
  // Config-only repository topology can point outside the resolved DB graph.
  delete sanitized.wikiRoot;
  delete sanitized.specsRoot;
  delete sanitized.members;
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function relationNeighbor(relation: EntityRelationRecord, ref: EntityRef): EntityRef | undefined {
  if (relation.sourceKind === ref.kind && relation.sourceId === ref.id) {
    return { kind: relation.targetKind, id: relation.targetId };
  }
  if (relation.targetKind === ref.kind && relation.targetId === ref.id) {
    return { kind: relation.sourceKind, id: relation.sourceId };
  }
  return undefined;
}
