import type { WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";

export interface CurationCheckServices {
  config: WorkMemoryConfig;
  db: WorkMemoryDatabase;
}

export interface CurationViolation {
  rule: "unclassified_capture" | "missing_entity" | "isolated_entity" | "misfiled_decision";
  entity?: string;
  message: string;
  repairable: boolean;
}

export interface CurationCheckResult {
  captureId: string;
  ok: boolean;
  violations: CurationViolation[];
  repairs: string[];
}

export interface CurationCheckOptions {
  repair?: boolean;
}

const FALLBACK_REF = "oneagent:oneagent";

/**
 * Deterministic invariants for a curated capture. The most important one is
 * "no isolated entity": the graph viewer hides entities without relations, so a
 * curation pass that creates entities without linking them produces invisible
 * knowledge. `repair` links isolated entities to the capture's primary entity
 * (or to the oneagent root when the primary itself is isolated).
 */
export function checkCaptureCuration(
  services: CurationCheckServices,
  captureId: string,
  options: CurationCheckOptions = {}
): CurationCheckResult {
  const capture = services.db.getCapture(captureId);
  if (!capture) {
    throw new Error(`Capture not found: ${captureId}`);
  }

  const violations: CurationViolation[] = [];
  const repairs: string[] = [];
  const primaryRef = `${capture.primaryEntityKind}:${capture.primaryEntityId}`;

  if (primaryRef === FALLBACK_REF) {
    violations.push({
      rule: "unclassified_capture",
      entity: primaryRef,
      message: `Capture ${captureId} is still classified on the oneagent fallback; curation should pick a real primary entity.`,
      repairable: false
    });
  }

  const touched = new Map<string, { kind: string; id: string }>();
  touched.set(primaryRef, { kind: capture.primaryEntityKind, id: capture.primaryEntityId });
  for (const related of capture.relatedEntities) {
    touched.set(`${related.entityKind}:${related.entityId}`, { kind: related.entityKind, id: related.entityId });
  }

  for (const [ref, { kind, id }] of touched) {
    if (ref === FALLBACK_REF) {
      continue;
    }
    const entity = services.db.getEntity(kind, id);
    if (!entity) {
      violations.push({
        rule: "missing_entity",
        entity: ref,
        message: `Capture ${captureId} references ${ref} but the entity does not exist.`,
        repairable: false
      });
      continue;
    }
    if (looksLikeMisfiledDecision(entity.label, id)) {
      violations.push({
        rule: "misfiled_decision",
        entity: ref,
        message: `${ref} ("${entity.label}") looks like a decision/risk/question filed as an entity. Those are never entities: record them as the capture's content type, a Decisions/Risks/Open questions section on the wiki page of the entity they concern, and an inbox proposal (decision_candidate/risk/open_question). Reclassify or delete this entity.`,
        repairable: false
      });
    }
    if (services.db.listEntityRelations({ kind, id }).length > 0) {
      continue;
    }
    const violation: CurationViolation = {
      rule: "isolated_entity",
      entity: ref,
      message: `${ref} has no typed relation; it is invisible in the graph.`,
      repairable: true
    };
    if (!options.repair) {
      violations.push(violation);
      continue;
    }
    const target = ref === primaryRef ? FALLBACK_REF : primaryRef;
    const [targetKind, targetId] = target.split(":");
    services.db.upsertEntityRelation({
      sourceKind: kind as never,
      sourceId: id,
      targetKind: targetKind as never,
      targetId,
      relationType: "related_to",
      description: `Auto-repaired: introduced by capture ${captureId} without an explicit relation.`,
      metadata: { capturedFrom: [captureId], autoRepaired: true }
    });
    repairs.push(`Linked isolated ${ref} to ${target} (related_to).`);
  }

  return {
    captureId,
    ok: violations.length === 0,
    violations,
    repairs
  };
}

// A "Decision: ..." label is the strong signal; underscore-prefixed ids
// (dec_/risk_/question_) catch the agent's ad-hoc pattern — legitimate ids
// are kebab-case, so an underscore prefix never hits them.
function looksLikeMisfiledDecision(label: string, id: string): boolean {
  return /^(decision|risk|question)\s*:/i.test(label) || /^(dec|decision|risk|question)_/.test(id);
}
