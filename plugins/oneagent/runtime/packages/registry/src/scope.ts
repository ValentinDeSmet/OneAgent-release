import type { ActiveContext, ScopeMode, WorkMemoryConfig } from "../../shared/src/index.ts";

export interface ResolveScopeInput {
  productId?: string;
  scope?: ScopeMode;
  include?: string[];
}

export interface ResolvedScope {
  scope: ScopeMode;
  activeProductId?: string;
  includedProductIds: string[];
}

export function resolveScope(config: WorkMemoryConfig, context: ActiveContext, input: ResolveScopeInput = {}): ResolvedScope {
  const activeProductId = input.productId ?? context.activeProduct?.id;
  const scope = input.scope ?? context.scope;

  if (scope === "portfolio") {
    return {
      scope,
      activeProductId,
      includedProductIds: config.products.map((product) => product.id)
    };
  }

  if (scope === "manual-selection") {
    const includedProductIds = normalizeProductIds(config, input.include ?? (activeProductId ? [activeProductId] : []));
    return {
      scope,
      activeProductId,
      includedProductIds
    };
  }

  if (!activeProductId) {
    return {
      scope: "portfolio",
      includedProductIds: config.products.map((product) => product.id)
    };
  }

  assertKnownProduct(config, activeProductId);

  if (scope === "current-product-plus-direct-dependencies") {
    const product = config.products.find((candidate) => candidate.id === activeProductId);
    return {
      scope,
      activeProductId,
      includedProductIds: normalizeProductIds(config, [activeProductId, ...(product?.dependencies ?? [])])
    };
  }

  return {
    scope: "current-product",
    activeProductId,
    includedProductIds: [activeProductId]
  };
}

function normalizeProductIds(config: WorkMemoryConfig, productIds: string[]): string[] {
  const knownProductIds = new Set(config.products.map((product) => product.id));
  const normalized = Array.from(new Set(productIds));
  const unknown = normalized.filter((productId) => !knownProductIds.has(productId));
  if (unknown.length > 0) {
    throw new Error(`Unknown product id(s): ${unknown.join(", ")}`);
  }
  return normalized;
}

function assertKnownProduct(config: WorkMemoryConfig, productId: string): void {
  if (!config.products.some((product) => product.id === productId)) {
    throw new Error(`Unknown product id: ${productId}`);
  }
}
