import type { EntityRecord } from "../../shared/src/index.ts";
import { normalizeEntityId } from "../../shared/src/index.ts";

export interface EntityResolutionCandidate {
  ref: string;
  kind: string;
  id: string;
  label: string;
  status: string;
  description?: string;
  score: number;
  matchedOn: "self" | "id" | "label" | "alias" | "partial" | "tokens";
}

export interface EntityResolution {
  name: string;
  /** reuse: confident match — do not create. review: plausible match — inspect before creating. create: no match. */
  recommendation: "reuse" | "review" | "create";
  candidates: EntityResolutionCandidate[];
}

export interface ResolveEntityOptions {
  limit?: number;
  /** Workspace owner as 'person:<id>' — first-person names resolve straight to it. */
  selfRef?: string;
}

const SELF_NAMES = new Set(["me", "moi", "myself", "i", "je", "self", "workspace-owner"]);

/**
 * Deterministic entity resolution for the curation pass: given candidate names extracted
 * from a document, rank existing entities so the agent reuses ids instead of creating
 * near-duplicates. Matching is accent- and case-insensitive on id, label and aliases.
 */
export function resolveEntityCandidates(
  entities: EntityRecord[],
  names: string[],
  options: ResolveEntityOptions = {}
): EntityResolution[] {
  const limit = options.limit ?? 5;
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => {
      const normalized = normalizeEntityId(name);
      const self = selfCandidate(entities, normalized, options.selfRef);
      if (self) {
        return { name, recommendation: "reuse" as const, candidates: [self] };
      }
      const nameTokens = tokenize(normalized);
      const candidates = entities
        .map((entity) => scoreEntity(entity, normalized, nameTokens))
        .filter((candidate): candidate is EntityResolutionCandidate => candidate !== undefined)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
      return {
        name,
        recommendation: recommend(candidates[0]?.score),
        candidates
      };
    });
}

function selfCandidate(
  entities: EntityRecord[],
  normalized: string,
  selfRef: string | undefined
): EntityResolutionCandidate | undefined {
  if (!selfRef || !SELF_NAMES.has(normalized)) {
    return undefined;
  }
  const [kind, id] = selfRef.split(":");
  const entity = entities.find((candidate) => candidate.kind === kind && candidate.id === id);
  if (!entity) {
    return undefined;
  }
  return {
    ref: selfRef,
    kind: entity.kind,
    id: entity.id,
    label: entity.label,
    status: entity.status,
    description: entity.description,
    score: 1,
    matchedOn: "self"
  };
}

function scoreEntity(
  entity: EntityRecord,
  normalized: string,
  nameTokens: Set<string>
): EntityResolutionCandidate | undefined {
  let score = 0;
  let matchedOn: EntityResolutionCandidate["matchedOn"] = "tokens";

  const id = entity.id.toLowerCase();
  const label = normalizeEntityId(entity.label);
  const aliases = (entity.aliases ?? []).map((alias) => normalizeEntityId(alias));

  if (id === normalized) {
    score = 1;
    matchedOn = "id";
  } else if (label === normalized) {
    score = 1;
    matchedOn = "label";
  } else if (aliases.includes(normalized)) {
    score = 0.95;
    matchedOn = "alias";
  } else if (normalized.length >= 4 && (label.includes(normalized) || id.includes(normalized) || normalized.includes(label))) {
    score = 0.7;
    matchedOn = "partial";
  } else {
    const overlap = jaccard(nameTokens, new Set([...tokenize(label), ...tokenize(id), ...aliases.flatMap((alias) => [...tokenize(alias)])]));
    if (overlap >= 0.34) {
      score = overlap * 0.7;
      matchedOn = "tokens";
    }
  }

  if (score <= 0) {
    return undefined;
  }
  return {
    ref: `${entity.kind}:${entity.id}`,
    kind: entity.kind,
    id: entity.id,
    label: entity.label,
    status: entity.status,
    description: entity.description,
    score: Number(score.toFixed(3)),
    matchedOn
  };
}

function recommend(bestScore: number | undefined): EntityResolution["recommendation"] {
  if (bestScore === undefined) {
    return "create";
  }
  if (bestScore >= 0.9) {
    return "reuse";
  }
  if (bestScore >= 0.45) {
    return "review";
  }
  return "create";
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split("-").filter((token) => token.length > 1));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}
