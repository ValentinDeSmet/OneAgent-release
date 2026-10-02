import type { InboxItem } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";

export interface BmadReadinessSignal {
  label: string;
  status: "ready" | "warning" | "blocked";
  count: number;
  detail: string;
}

export interface BmadReadinessReport {
  productIds: string[];
  score: number;
  status: "ready" | "warning" | "blocked";
  counts: {
    pendingInbox: number;
    openQuestions: number;
    decisionCandidates: number;
    risks: number;
    openTasks: number;
    unvalidatedConcepts: number;
    unreviewedSources: number;
    candidateWikiPages: number;
  };
  signals: BmadReadinessSignal[];
}

export function buildBmadReadinessReport(db: WorkMemoryDatabase, productIds: string[]): BmadReadinessReport {
  const pendingInbox = db.listInbox("pending", productIds);
  const inboxByType = mapCounts(db.countPendingInboxByType(productIds));
  const conceptsByType = mapCounts(db.countCandidateConceptsByType(productIds));
  const unreviewedSources = db.countUnreviewedSources(productIds);
  const candidateWikiPages = countCandidateWikiPages(pendingInbox);
  const productSet = new Set(productIds);
  // Keep the historical `openTasks` response field for UI compatibility, but
  // make it represent the actionable readiness signal: native blocked tasks.
  // Ordinary open work is expected and must not make a product "not ready".
  const blockingTasks = db
    .listTasks(productIds)
    .filter((task) => task.status === "blocked" && (productIds.length === 0 || (task.productId && productSet.has(task.productId))))
    .length;
  const counts = {
    pendingInbox: pendingInbox.length,
    openQuestions: count("open_question", inboxByType) + count("question", conceptsByType),
    decisionCandidates: count("decision_candidate", inboxByType) + count("decision", conceptsByType),
    risks: count("risk", inboxByType) + count("risk", conceptsByType),
    openTasks: blockingTasks,
    unvalidatedConcepts: count("entity", conceptsByType),
    unreviewedSources,
    candidateWikiPages
  };
  const score = calculateScore(counts);
  const signals = buildSignals(counts);

  return {
    productIds,
    score,
    status: score >= 85 ? "ready" : score >= 55 ? "warning" : "blocked",
    counts,
    signals
  };
}

function buildSignals(counts: BmadReadinessReport["counts"]): BmadReadinessSignal[] {
  return [
    signal("Inbox pending", counts.pendingInbox, 0, "pending inbox item(s)"),
    signal("Open questions", counts.openQuestions, 0, "open question(s)"),
    signal("Decision candidates", counts.decisionCandidates, 0, "candidate decision(s)"),
    signal("Risks", counts.risks, 0, "risk item(s)"),
    signal("Blocking tasks", counts.openTasks, 0, "blocked task(s)"),
    signal("Unvalidated concepts", counts.unvalidatedConcepts, 0, "candidate concept(s)"),
    signal("Unreviewed sources", counts.unreviewedSources, 0, "source(s) awaiting review"),
    signal("Candidate wiki pages", counts.candidateWikiPages, 0, "wiki candidate(s)")
  ];
}

function signal(label: string, countValue: number, readyAt: number, unit: string): BmadReadinessSignal {
  return {
    label,
    count: countValue,
    status: countValue <= readyAt ? "ready" : countValue >= 5 ? "blocked" : "warning",
    detail: `${countValue} ${unit}`
  };
}

function calculateScore(counts: BmadReadinessReport["counts"]): number {
  // `pendingInbox` and `candidateWikiPages` are useful workload summaries, but
  // their actionable subtypes are already scored below. Scoring them again
  // would double-penalize the same proposal. A wiki proposal is review work,
  // not proof that an optional entity page is missing.
  const penalty =
    counts.openQuestions * 8 +
    counts.decisionCandidates * 7 +
    counts.risks * 6 +
    counts.openTasks * 10 +
    counts.unvalidatedConcepts * 3 +
    counts.unreviewedSources * 2;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function countCandidateWikiPages(items: InboxItem[]): number {
  return items.filter((item) =>
    item.type === "wiki_proposal" &&
    item.payload.proposalKind === "wiki_write_review" &&
    typeof item.payload.targetPath === "string"
  ).length;
}

function mapCounts(rows: Array<{ key: string; count: number }>): Map<string, number> {
  return new Map(rows.map((row) => [row.key, row.count]));
}

function count(key: string, counts: Map<string, number>): number {
  return counts.get(key) ?? 0;
}
