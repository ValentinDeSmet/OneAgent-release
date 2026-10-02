import type { StructuredInsight } from "../../shared/src/index.ts";

export interface GraphRelationCandidate {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export function extractFallbackGraph(content: string, insights: StructuredInsight[]): GraphRelationCandidate[] {
  return dedupeRelations([
    ...buildFallbackGraph(insights),
    ...extractSentenceRelations(content)
  ]);
}

export function buildFallbackGraph(insights: StructuredInsight[]): GraphRelationCandidate[] {
  return insights
    .filter((insight) => insight.kind === "concept" || insight.kind === "decision" || insight.kind === "risk")
    .map((insight) => ({
      subject: insight.title,
      predicate: insight.kind === "risk" ? "may_impact" : "mentions",
      object: insight.targetPath ?? "memory",
      confidence: insight.confidence
    }));
}

function extractSentenceRelations(content: string): GraphRelationCandidate[] {
  const relations: GraphRelationCandidate[] = [];
  const sentences = content
    .replace(/`([^`]+)`/g, "$1")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    if (/^question\s*:/i.test(sentence)) {
      continue;
    }

    relations.push(...matchRelation(sentence, /\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\s+(?:should\s+not\s+own|does\s+not\s+own)\s+([^.;]+)/, "does_not_own", 0.74));

    if (!/\b(?:should\s+not\s+own|does\s+not\s+own)\b/i.test(sentence)) {
      relations.push(...matchRelation(sentence, /\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\s+(?:owns|own)\s+([^.;]+)/, "owns", 0.7));
    }

    relations.push(...matchRelation(sentence, /\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\s+(?:provides|provide)\s+([^.;]+)/, "provides", 0.72));
    relations.push(...matchRelation(sentence, /\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\s+(?:exposes|expose)\s+([^.;]+)/, "exposes", 0.7));
    relations.push(...matchRelation(sentence, /\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,4})\s+(?:consumes|consume)\s+([^.;]+)/, "consumes", 0.72));
  }

  return relations;
}

function matchRelation(sentence: string, pattern: RegExp, predicate: string, confidence: number): GraphRelationCandidate[] {
  const match = sentence.match(pattern);
  if (!match) {
    return [];
  }

  const subject = cleanSubject(match[1]);
  const object = cleanObject(match[2]);
  if (!subject || !object) {
    return [];
  }

  return [{ subject, predicate, object, confidence }];
}

function cleanSubject(value: string): string {
  return value
    .replace(/^The\s+/i, "")
    .replace(/^Decision\s+candidate\s+/i, "")
    .trim();
}

function cleanObject(value: string): string {
  return value
    .split(/\s+and\s+/i)[0]
    .replace(/\s+as\s+input\b.*$/i, "")
    .replace(/\s+to\s+downstream\b.*$/i, "")
    .replace(/[.?!:]$/g, "")
    .trim();
}

function dedupeRelations(relations: GraphRelationCandidate[]): GraphRelationCandidate[] {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const key = `${relation.subject.toLowerCase()}|${relation.predicate}|${relation.object.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
