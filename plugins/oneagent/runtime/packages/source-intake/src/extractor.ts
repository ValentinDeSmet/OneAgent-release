import type { StructuredInsight } from "../../shared/src/index.ts";

export function extractStructuredInsights(content: string): StructuredInsight[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const insights: StructuredInsight[] = [];

  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (isMetadataLine(normalized) || isLowValueHeading(line)) {
      continue;
    }

    if (/\b(decision|décision|decided)\b/.test(normalized)) {
      insights.push({
        kind: "decision",
        title: titleFromLine(line, "Decision candidate"),
        body: line,
        confidence: 0.72,
        targetPath: `docs/wiki/decisions/${slugify(line)}.md`
      });
      continue;
    }

    if (/\b(question|open question|à clarifier)\b/.test(normalized) || line.endsWith("?")) {
      insights.push({
        kind: "question",
        title: titleFromLine(line, "Open question"),
        body: line,
        confidence: 0.7,
        targetPath: "docs/wiki/open-questions.md"
      });
      continue;
    }

    if (/\b(action|todo|task|tâche|follow[- ]?up)\b/.test(normalized)) {
      insights.push({
        kind: "task",
        title: titleFromLine(line, "Task"),
        body: line,
        confidence: 0.68
      });
      continue;
    }

    if (/\b(risk|risque|blocker|contradiction)\b/.test(normalized)) {
      insights.push({
        kind: "risk",
        title: titleFromLine(line, "Risk"),
        body: line,
        confidence: 0.66,
        targetPath: "docs/wiki/risks/index.md"
      });
    }
  }

  for (const concept of extractBacktickConcepts(content)) {
    insights.push({
      kind: "concept",
      title: concept,
      body: `Concept candidate mentioned as \`${concept}\`.`,
      confidence: 0.62,
      targetPath: `docs/wiki/concepts/${slugify(concept)}.md`
    });
  }

  return dedupeInsights(insights);
}

function extractBacktickConcepts(content: string): string[] {
  const matches = content.matchAll(/`([^`]{2,80})`/g);
  return Array.from(matches, (match) => match[1].trim()).filter(isBusinessConceptToken);
}

function isMetadataLine(normalizedLine: string): boolean {
  return (
    normalizedLine.startsWith("status:") ||
    normalizedLine.startsWith("type:") ||
    normalizedLine.startsWith("confidence:") ||
    normalizedLine.startsWith("source:")
  );
}

function isBusinessConceptToken(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("/") || normalized.includes("*")) {
    return false;
  }

  if (/^#+\s*\d*\.?$/.test(normalized) || /^\d+\.?$/.test(normalized)) {
    return false;
  }

  return /[a-zA-Z0-9_]/.test(normalized);
}

function titleFromLine(line: string, fallback: string): string {
  const withoutMarkdown = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\d+[\.)]\s*/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
  const withoutMarker = withoutMarkdown.replace(/^(decision candidate|decision|décision|question|action|todo|risk|risque)\s*:\s*/i, "");
  const sentence = withoutMarker.split(/[.?!]/)[0]?.trim();
  return sentence ? sentence.slice(0, 120) : fallback;
}

function isLowValueHeading(line: string): boolean {
  return /^#{1,6}\s*\d+\.?\s*$/.test(line.trim());
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "proposal";
}

function dedupeInsights(insights: StructuredInsight[]): StructuredInsight[] {
  const seen = new Set<string>();
  return insights.filter((insight) => {
    const key = `${insight.kind}:${insight.title}:${insight.body}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
