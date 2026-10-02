import path from "node:path";
import { isPathInside, resolvePhysicalPath, type WorkMemoryConfig } from "../../shared/src/index.ts";

export interface LegacyWikiTarget {
  origin: string;
  repositoryPath: string;
  wikiPath: string;
}

export interface MemoryDestinations {
  readOnly: true;
  privateWikiProjection: "disabled";
  synchronizationEnabled: false;
  references: Array<LegacyWikiTarget & { purpose: "product-reference"; privateSyncAllowed: false }>;
  privateBackup?: { id: string; purpose: "private-backup"; path: string; visibility: "unknown" };
  blockers: Array<{ code: string; detail: string }>;
}

/** Inspection only: reserving a destination never grants permission to export or push. */
export function describeMemoryDestinations(
  config: WorkMemoryConfig,
  legacyTargets: LegacyWikiTarget[],
  referenceInventoryComplete: boolean
): MemoryDestinations {
  const blockers: MemoryDestinations["blockers"] = [{
    code: "private-publication-explicit",
    detail: "Private publication requires preview-private, live GitHub privacy verification and an explicit publish-private invocation bound to the reviewed digest. Automatic synchronization remains disabled."
  }];
  const candidate = config.privateBackup;
  if (!candidate) {
    blockers.push({ code: "private-destination-not-configured", detail: "No private backup repository has been selected. Product and entity bindings are never used as a fallback." });
  } else {
    blockers.push({ code: "visibility-unverified", detail: "A private-backup purpose is not proof of remote privacy. Run preview-private to verify Git identity and remote visibility; this offline inventory does not authorize publication." });
    if (config.products.some((product) => product.repositories.some((repository) => repository.id === candidate.id))) {
      blockers.push({ code: "repository-id-conflict", detail: "The reserved private destination uses an existing product repository id." });
    }
    try {
      const destination = resolvePhysicalPath(candidate.path);
      const memoryPaths = [config.workspaceRoot, config.storage.databasePath, path.resolve(config.workspaceRoot, config.workspace.memoryRoot)];
      if (memoryPaths.some((root) => overlaps(destination, resolvePhysicalPath(root)))) {
        blockers.push({ code: "memory-path-conflict", detail: "The reserved destination overlaps the live memory. Choose a separate repository." });
      }
      for (const target of legacyTargets) {
        if (overlaps(destination, resolvePhysicalPath(target.repositoryPath)) || overlaps(destination, resolvePhysicalPath(target.wikiPath))) {
          blockers.push({ code: "reference-path-conflict", detail: `The reserved destination overlaps reference binding ${target.origin}.` });
        }
      }
    } catch {
      blockers.push({ code: "destination-path-unverifiable", detail: "A destination or reference path could not be resolved safely. No synchronization is authorized." });
    }
  }
  if (!referenceInventoryComplete) {
    blockers.push({ code: "reference-inventory-incomplete", detail: "Persisted repository bindings could not be completely inventoried. Keep all existing bindings until they can be reviewed." });
  }
  return {
    readOnly: true,
    privateWikiProjection: "disabled",
    synchronizationEnabled: false,
    references: legacyTargets.map((target) => ({ ...target, purpose: "product-reference", privateSyncAllowed: false })),
    privateBackup: candidate ? { ...candidate, visibility: "unknown" } : undefined,
    blockers
  };
}

function overlaps(left: string, right: string): boolean {
  return isPathInside(left, right) || isPathInside(right, left);
}
