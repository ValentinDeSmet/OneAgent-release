import type { InboxItem, ProductConfig, RepositoryConfig, ResolvedContextScope } from "../../shared/src/index.ts";

export type SourceAccessOutputPolicy = "none" | "metadata" | "snippets" | "full";

export type StrictRepositoryConfigOutput = Pick<RepositoryConfig, "id" | "productId" | "role">;
export type StrictProductConfigOutput = Omit<ProductConfig, "repositories"> & {
  repositories: StrictRepositoryConfigOutput[];
};

export function strictSourceAccessForOutput(scope: ResolvedContextScope | undefined): SourceAccessOutputPolicy {
  return scope?.scope.mode === "strict" ? scope.scope.sourceAccess ?? "full" : "full";
}

/** Keep the entity/task boundary useful without publishing content-plane identifiers. */
export function sanitizeResolvedContextForOutput(resolved: ResolvedContextScope): ResolvedContextScope {
  if (resolved.scope.mode !== "strict" || (resolved.scope.sourceAccess ?? "full") !== "none") return resolved;
  return {
    ...resolved,
    sourceIds: [],
    captureIds: [],
    inboxItemIds: [],
    observationIds: [],
    curationPackageIds: [],
    counts: {
      ...resolved.counts,
      captures: 0,
      sources: 0,
      inbox: 0,
      observations: 0,
      curationPackages: 0
    }
  };
}

/**
 * Product configuration is contextual metadata, but repository paths are local
 * capabilities. In strict mode only graph-authorized repository references are
 * returned, without filesystem roots; dependencies are intersected as well.
 */
export function sanitizeProductConfigForOutput(
  product: ProductConfig,
  resolved: ResolvedContextScope | undefined
): ProductConfig | StrictProductConfigOutput {
  if (resolved?.scope.mode !== "strict") return product;
  const allowedProducts = new Set(
    resolved.entities.filter((ref) => ref.kind === "product").map((ref) => ref.id)
  );
  const metadataOnly = new Set(resolved.metadataOnlyEntityRefs ?? []);
  const allowedEntityIds = new Set(
    resolved.entities.filter((ref) => !metadataOnly.has(`${ref.kind}:${ref.id}`)).map((ref) => ref.id)
  );
  const allowedRepositories = new Set(
    resolved.entities
      .filter((ref) => ref.kind === "repository" && !metadataOnly.has(`${ref.kind}:${ref.id}`))
      .map((ref) => ref.id)
  );
  return {
    ...product,
    parentEntityId: product.parentEntityId && allowedEntityIds.has(product.parentEntityId) ? product.parentEntityId : undefined,
    dependencies: product.dependencies?.filter((id) => allowedProducts.has(id)),
    repositories: product.repositories
      .filter((repository) => allowedRepositories.has(repository.id))
      .map(sanitizeStrictRepository)
  };
}

export function sanitizeRepositoryConfigForOutput(
  repository: RepositoryConfig | undefined,
  resolved: ResolvedContextScope | undefined
): RepositoryConfig | StrictRepositoryConfigOutput | null {
  if (!repository) return null;
  if (resolved?.scope.mode !== "strict") return repository;
  const metadataOnly = new Set(resolved.metadataOnlyEntityRefs ?? []);
  const allowed = resolved.entities.some((ref) =>
    ref.kind === "repository"
    && ref.id === repository.id
    && !metadataOnly.has(`${ref.kind}:${ref.id}`)
  );
  return allowed ? sanitizeStrictRepository(repository) : null;
}

function sanitizeStrictRepository(repository: RepositoryConfig): StrictRepositoryConfigOutput {
  return {
    id: repository.id,
    productId: repository.productId,
    role: repository.role
  };
}

export function sanitizeInboxItemForOutput(item: InboxItem, access: SourceAccessOutputPolicy): InboxItem {
  if (access === "full") return item;
  const sanitized: Record<string, unknown> = { ...item };
  if (access === "none") {
    delete sanitized.body;
    delete sanitized.sourceId;
    sanitized.payload = {};
    return sanitized as unknown as InboxItem;
  }
  if (access === "metadata") {
    delete sanitized.body;
    sanitized.payload = inboxPayloadMetadata(item.payload);
    return sanitized as unknown as InboxItem;
  }
  sanitized.body = item.body.slice(0, 2_000);
  sanitized.payload = boundedObject(item.payload, 1_000);
  return sanitized as unknown as InboxItem;
}

export function sanitizeInboxPreviewForOutput<T>(value: T, access: SourceAccessOutputPolicy): T {
  if (access === "full") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  if (record.item && typeof record.item === "object" && !Array.isArray(record.item)) {
    output.item = sanitizeInboxItemForOutput(record.item as InboxItem, access);
  }
  if (access === "snippets" && record.preview !== undefined) {
    output.preview = boundedValue(record.preview, 1_000);
  } else if (access === "metadata" && record.preview && typeof record.preview === "object") {
    const preview = record.preview as Record<string, unknown>;
    const metadata = Object.fromEntries(
      ["proposalId", "status", "proposalKey", "canAccept", "action", "boundaryChangeRequired", "boundaryChangeReasons"]
        .filter((key) => preview[key] !== undefined)
        .map((key) => [key, preview[key]])
    );
    const itemType = (record.item as Record<string, unknown> | undefined)?.type;
    output.preview = itemType === "graph_change_proposal"
      ? {
          ...metadata,
          evidenceObservationIds: Array.isArray(preview.evidenceObservationIds) ? preview.evidenceObservationIds.slice(0, 50) : [],
          boundaryChangeRequired: preview.boundaryChangeRequired === true,
          boundaryChangeReasons: Array.isArray(preview.boundaryChangeReasons)
            ? preview.boundaryChangeReasons.slice(0, 50).map((reason) => String(reason).slice(0, 1_000))
            : [],
          changes: Array.isArray(preview.changes)
            ? preview.changes.slice(0, 100).map((change) => {
                const candidate = change && typeof change === "object" ? change as Record<string, unknown> : {};
                return Object.fromEntries(
                  ["index", "op", "target", "action"]
                    .filter((key) => candidate[key] !== undefined)
                    .map((key) => [key, candidate[key]])
                );
              })
            : []
        }
      : metadata;
  }
  return output as T;
}

export function sanitizeSourceListRowsForOutput(
  rows: Array<Record<string, unknown>>,
  access: SourceAccessOutputPolicy
): Array<Record<string, unknown>> {
  if (access === "none") return [];
  if (access === "full") return rows;
  const allowed = [
    "id", "title", "sourceType", "origin", "capturedAt", "language", "status", "updatedAt", "entity", "entityRefs", "productId", "chunkCount"
  ];
  return rows.map((row) => Object.fromEntries(
    allowed.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])
  ));
}

export function sanitizeWikiPagesForOutput<T extends Record<string, unknown>>(
  pages: T[],
  access: SourceAccessOutputPolicy
): Array<Record<string, unknown>> {
  if (access === "none") return [];
  if (access === "full") return pages;
  let remainingContent = 6_000;
  return pages.slice(0, 50).flatMap((page) => {
    const metadata = Object.fromEntries(
      ["relativePath", "updatedAt", "bytes", "truncated"]
        .filter((key) => page[key] !== undefined)
        .map((key) => [key, page[key]])
    );
    if (access === "metadata") return [metadata];
    if (remainingContent <= 0) return [];
    const rawContent = typeof page.content === "string" ? page.content : undefined;
    const content = rawContent?.slice(0, Math.min(2_000, remainingContent));
    remainingContent -= content?.length ?? 0;
    return [{ ...metadata, ...(content === undefined ? {} : { content, truncated: page.truncated === true || rawContent!.length > content.length }) }];
  });
}

function inboxPayloadMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "proposalKind", "schemaVersion", "proposalKey", "curationPackageId", "observationIds",
    "captureId", "sourceId", "entityRef", "wikiSubject", "wikiHome", "wikiPage", "wikiSynthesisKey"
  ];
  return Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
}

function boundedObject(
  value: Record<string, unknown>,
  stringLimit: number,
  budget: { remaining: number } = { remaining: 4_000 }
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).slice(0, 50).flatMap(([key, item]) => {
      if (budget.remaining <= 0) return [];
      return [[key, boundedValue(item, stringLimit, budget)]];
    })
  );
}

function boundedValue(value: unknown, stringLimit: number, budget: { remaining: number } = { remaining: 4_000 }): unknown {
  if (typeof value === "string") {
    const bounded = value.slice(0, Math.min(stringLimit, budget.remaining));
    budget.remaining -= bounded.length;
    return bounded;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => boundedValue(item, stringLimit, budget));
  if (value && typeof value === "object") return boundedObject(value as Record<string, unknown>, stringLimit, budget);
  return value;
}
