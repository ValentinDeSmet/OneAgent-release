import path from "node:path";
import { isPathInside } from "../../shared/src/index.ts";
import type { ActiveContext, WorkMemoryConfig } from "../../shared/src/index.ts";

export function detectActiveContext(config: WorkMemoryConfig, currentPath: string): ActiveContext {
  const resolvedCurrentPath = path.resolve(currentPath);

  for (const product of config.products) {
    for (const repository of product.repositories) {
      if (isPathInside(resolvedCurrentPath, repository.path)) {
        return {
          mode: "product",
          workspaceRoot: config.workspaceRoot,
          currentPath: resolvedCurrentPath,
          activeProduct: product,
          activeRepository: repository,
          scope: "current-product",
          includedProductIds: [product.id]
        };
      }
    }
  }

  return {
    mode: "global",
    workspaceRoot: config.workspaceRoot,
    currentPath: resolvedCurrentPath,
    scope: "portfolio",
    includedProductIds: config.products.map((product) => product.id)
  };
}
