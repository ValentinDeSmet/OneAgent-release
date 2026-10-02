import { isEntityKind, parseEntityRef } from "../../shared/src/index.ts";

export type InboxContextReferenceKind =
  | "product"
  | "source"
  | "capture"
  | "entity"
  | "observation"
  | "relation";

export interface InboxContextReferences {
  productIds: string[];
  sourceIds: string[];
  captureIds: string[];
  entityRefs: string[];
  observationIds: string[];
  relationTypes: string[];
}

/**
 * Extract the durable context dimensions carried by an Inbox payload.
 *
 * This is shared by the storage index and the strict-scope resolver so the
 * candidate query and its final boundary check cannot drift apart.
 */
export function inspectInboxPayloadReferences(payload: Record<string, unknown>): InboxContextReferences {
  const productIds = new Set<string>();
  const sourceIds = new Set<string>();
  const captureIds = new Set<string>();
  const entityRefs = new Set<string>();
  const observationIds = new Set<string>();
  const relationTypes = new Set<string>();
  const graphChangeProposal = payload.proposalKind === "graph_change";

  if (graphChangeProposal) {
    addStringValues(payload.evidenceObservationIds, observationIds);
    const changes = Array.isArray(payload.changes)
      ? payload.changes.filter((change): change is Record<string, unknown> =>
          Boolean(change) && typeof change === "object" && !Array.isArray(change)
        )
      : [];
    const created = new Set<string>();
    for (const change of changes) {
      if (change.op !== "create_entity") continue;
      const ref = structuredEntityReference(change.entity);
      if (ref) created.add(ref);
    }
    // A proposed entity does not exist in the current graph and therefore is
    // not a current context dimension. Existing update targets and relation
    // endpoints remain strict dimensions of the proposal.
    for (const change of changes) {
      if (change.op === "upsert_relation" && typeof change.relationType === "string" && change.relationType) {
        relationTypes.add(change.relationType);
      }
      const refs = change.op === "update_entity"
        ? [structuredEntityReference(change.entity)]
        : change.op === "upsert_relation"
          ? [structuredEntityReference(change.source), structuredEntityReference(change.target)]
          : [];
      for (const ref of refs) {
        if (ref && !created.has(ref)) entityRefs.add(ref);
      }
    }
    return referenceResult(productIds, sourceIds, captureIds, entityRefs, observationIds, relationTypes);
  }

  const visit = (value: unknown, key = "", parentKey = ""): void => {
    if (typeof value === "string") {
      if ((key === "productId" || key === "productIds") && value) productIds.add(value);
      if ((key === "sourceId" || key === "sourceIds") && parentKey !== "link" && value) sourceIds.add(value);
      if ((key === "captureId" || key === "captureIds") && value) captureIds.add(value);
      if (isObservationReferenceKey(key) && value) observationIds.add(value);
      if ((key === "relationType" || key === "relationTypes") && value) relationTypes.add(value);
      for (const ref of entityReferencesInText(value)) entityRefs.add(ref);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, parentKey);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.kind === "string" && typeof record.id === "string") {
      const ref = canonicalEntityReference(record.kind, record.id);
      if (ref) entityRefs.add(ref);
    }
    for (const [childKey, child] of Object.entries(record)) visit(child, childKey, key);
  };
  visit(payload);
  return referenceResult(productIds, sourceIds, captureIds, entityRefs, observationIds, relationTypes);
}

export function inboxContextReferenceRows(payload: Record<string, unknown>): Array<{
  kind: InboxContextReferenceKind;
  value: string;
}> {
  const refs = inspectInboxPayloadReferences(payload);
  return [
    ...refs.productIds.map((value) => ({ kind: "product" as const, value })),
    ...refs.sourceIds.map((value) => ({ kind: "source" as const, value })),
    ...refs.captureIds.map((value) => ({ kind: "capture" as const, value })),
    ...refs.entityRefs.map((value) => ({ kind: "entity" as const, value })),
    ...refs.observationIds.map((value) => ({ kind: "observation" as const, value })),
    ...refs.relationTypes.map((value) => ({ kind: "relation" as const, value }))
  ];
}

function addStringValues(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) if (typeof item === "string" && item) target.add(item);
}

function isObservationReferenceKey(key: string): boolean {
  return key === "observationId"
    || key === "observationIds"
    || key === "evidenceObservationIds"
    || key === "wikiEvidenceObservationIds";
}

function referenceResult(
  productIds: Set<string>,
  sourceIds: Set<string>,
  captureIds: Set<string>,
  entityRefs: Set<string>,
  observationIds: Set<string>,
  relationTypes: Set<string>
): InboxContextReferences {
  return {
    productIds: [...productIds].sort(),
    sourceIds: [...sourceIds].sort(),
    captureIds: [...captureIds].sort(),
    entityRefs: [...entityRefs].sort(),
    observationIds: [...observationIds].sort(),
    relationTypes: [...relationTypes].sort()
  };
}

function structuredEntityReference(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string" && typeof record.id === "string"
    ? canonicalEntityReference(record.kind, record.id)
    : undefined;
}

function entityReferencesInText(value: string): string[] {
  const refs: string[] = [];
  for (const match of value.matchAll(/\b([a-z][a-z0-9_-]*):([a-zA-Z0-9][a-zA-Z0-9._:/-]*)/g)) {
    const kind = match[1];
    const id = match[2].replace(/[.:;,]+$/, "");
    const ref = canonicalEntityReference(kind, id);
    if (ref) refs.push(ref);
  }
  return refs;
}

function canonicalEntityReference(kind: string, id: string): string | undefined {
  if (!isEntityKind(kind) || !id || id.startsWith("//")) return undefined;
  const ref = parseEntityRef(`${kind}:${id}`);
  return `${ref.kind}:${ref.id}`;
}
