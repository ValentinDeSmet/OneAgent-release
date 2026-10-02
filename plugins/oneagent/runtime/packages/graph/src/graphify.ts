import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStableId } from "../../shared/src/index.ts";
import type { GraphNodeStatus, GraphNodeType, GraphViewDiagnostic, GraphViewEdge, GraphViewNode, RepositoryConfig } from "../../shared/src/index.ts";

export interface GraphifyOptions {
  command?: string;
  maxNodes?: number;
  maxEdges?: number;
}

export interface GraphifyRefreshInput extends GraphifyOptions {
  repository: RepositoryConfig;
  update?: boolean;
  mode?: "deep" | string;
}

export interface GraphifyRefreshResult {
  repositoryId: string;
  productId: string;
  available: boolean;
  ok: boolean;
  graphPath?: string;
  message: string;
}

export interface GraphifyImportInput extends GraphifyOptions {
  repository: RepositoryConfig;
}

export interface GraphifyImportResult {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  diagnostic: GraphViewDiagnostic;
}

export function graphifyOutputPath(repositoryPath: string): string {
  return path.join(repositoryPath, "graphify-out", "graph.json");
}

export function isGraphifyAvailable(command = "graphify"): boolean {
  const result = spawnSync(command, ["--help"], {
    encoding: "utf8",
    timeout: 10_000
  });
  return !result.error && (result.status === 0 || Boolean(result.stdout || result.stderr));
}

export function refreshGraphifyRepository(input: GraphifyRefreshInput): GraphifyRefreshResult {
  const command = input.command ?? "graphify";
  if (!isGraphifyAvailable(command)) {
    return {
      repositoryId: input.repository.id,
      productId: input.repository.productId,
      available: false,
      ok: false,
      message: `Graphify CLI not found: ${command}`
    };
  }

  const args = ["extract", ".", "--out", "."];
  if (input.mode) {
    args.push("--mode", input.mode);
  }

  const result = spawnSync(command, args, {
    cwd: input.repository.path,
    encoding: "utf8",
    timeout: 20 * 60_000
  });
  const graphPath = graphifyOutputPath(input.repository.path);

  if (result.error || result.status !== 0) {
    return {
      repositoryId: input.repository.id,
      productId: input.repository.productId,
      available: true,
      ok: false,
      graphPath,
      message: (result.stderr || result.stdout || result.error?.message || "Graphify failed").trim()
    };
  }

  return {
    repositoryId: input.repository.id,
    productId: input.repository.productId,
    available: true,
    ok: fs.existsSync(graphPath),
    graphPath,
    message: fs.existsSync(graphPath) ? "Graphify graph refreshed." : `Graphify finished but graph.json was not found at ${graphPath}`
  };
}

export function importGraphifyGraph(input: GraphifyImportInput): GraphifyImportResult {
  const graphPath = graphifyOutputPath(input.repository.path);
  if (!fs.existsSync(graphPath)) {
    return {
      nodes: [],
      edges: [],
      diagnostic: {
        provider: "graphify",
        status: "missing",
        message: `No Graphify graph found for ${input.repository.id}. Run graph-view with --refresh-graphify.`,
        path: graphPath
      }
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(graphPath, "utf8")) as unknown;
    const normalized = normalizeGraphifyJson(raw, input.repository, input.maxNodes ?? 150, input.maxEdges ?? 300);
    return {
      ...normalized,
      diagnostic: {
        provider: "graphify",
        status: "ok",
        message: `Loaded Graphify graph for ${input.repository.id}.`,
        path: graphPath
      }
    };
  } catch (error) {
    return {
      nodes: [],
      edges: [],
      diagnostic: {
        provider: "graphify",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        path: graphPath
      }
    };
  }
}

function normalizeGraphifyJson(
  raw: unknown,
  repository: RepositoryConfig,
  maxNodes: number,
  maxEdges: number
): { nodes: GraphViewNode[]; edges: GraphViewEdge[] } {
  const nodeInputs = extractGraphifyNodes(raw).slice(0, maxNodes);
  const idMap = new Map<string, string>();
  const nodes = nodeInputs.map((nodeInput) => {
    const rawId = graphifyRawNodeId(nodeInput);
    const id = `graphify:${repository.productId}:${repository.id}:${rawId}`;
    idMap.set(rawId, id);
    return graphifyNodeToViewNode(nodeInput, id, repository);
  });

  const edges = extractGraphifyEdges(raw)
    .map((edgeInput) => graphifyEdgeToViewEdge(edgeInput, idMap, repository))
    .filter((edge): edge is GraphViewEdge => Boolean(edge))
    .slice(0, maxEdges);

  return { nodes, edges };
}

function extractGraphifyNodes(raw: unknown): Record<string, unknown>[] {
  const candidate = raw as Record<string, unknown>;
  const arrays = [
    candidate.nodes,
    (candidate.graph as Record<string, unknown> | undefined)?.nodes,
    (candidate.elements as Record<string, unknown> | undefined)?.nodes
  ];

  for (const value of arrays) {
    if (Array.isArray(value)) {
      return value.map((entry) => unwrapData(entry)).filter(isRecord);
    }
  }

  return [];
}

function extractGraphifyEdges(raw: unknown): Record<string, unknown>[] {
  const candidate = raw as Record<string, unknown>;
  const arrays = [
    candidate.edges,
    candidate.links,
    (candidate.graph as Record<string, unknown> | undefined)?.edges,
    (candidate.elements as Record<string, unknown> | undefined)?.edges
  ];

  for (const value of arrays) {
    if (Array.isArray(value)) {
      return value.map((entry) => unwrapData(entry)).filter(isRecord);
    }
  }

  return [];
}

function unwrapData(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return isRecord(value.data) ? value.data : value;
}

function graphifyNodeToViewNode(input: Record<string, unknown>, id: string, repository: RepositoryConfig): GraphViewNode {
  const label = stringValue(input.label ?? input.name ?? input.title ?? input.id ?? input.key, "Unnamed");
  const pathValue = stringValue(input.path ?? input.file ?? input.file_path ?? input.source_path, "");
  return {
    id,
    label,
    type: mapGraphifyNodeType(input, pathValue),
    status: mapGraphifyStatus(input.status),
    productIds: [repository.productId],
    path: pathValue ? resolveGraphifyPath(repository.path, pathValue) : undefined,
    sourceId: stringValue(input.source_id ?? input.sourceId, "") || undefined,
    confidence: numberValue(input.confidence ?? input.score ?? input.weight),
    provider: "graphify",
    meta: {
      repositoryId: repository.id,
      rawType: input.type ?? input.kind ?? input.category
    }
  };
}

function graphifyEdgeToViewEdge(
  input: Record<string, unknown>,
  idMap: Map<string, string>,
  repository: RepositoryConfig
): GraphViewEdge | undefined {
  const rawSource = stringValue(input.source ?? input.from ?? input.u ?? input.source_id ?? input.sourceId, "");
  const rawTarget = stringValue(input.target ?? input.to ?? input.v ?? input.target_id ?? input.targetId, "");
  const source = idMap.get(rawSource);
  const target = idMap.get(rawTarget);
  if (!source || !target) {
    return undefined;
  }

  const predicate = stringValue(input.predicate ?? input.type ?? input.kind ?? input.relation ?? input.label, "related_to");
  return {
    id: `graphify-edge:${repository.productId}:${repository.id}:${createStableId("edge", [source, predicate, target])}`,
    source,
    target,
    label: predicate,
    predicate,
    status: mapGraphifyStatus(input.status),
    confidence: numberValue(input.confidence ?? input.score ?? input.weight),
    sourceId: stringValue(input.source_id ?? input.sourceId, "") || undefined,
    provider: "graphify",
    meta: {
      repositoryId: repository.id
    }
  };
}

function graphifyRawNodeId(input: Record<string, unknown>): string {
  return stringValue(input.id ?? input.key ?? input.node_id ?? input.nodeId ?? input.label ?? input.name, createStableId("graphify-node", [JSON.stringify(input)]));
}

function mapGraphifyNodeType(input: Record<string, unknown>, pathValue: string): GraphNodeType {
  const raw = stringValue(input.type ?? input.kind ?? input.category ?? input.node_type ?? input.nodeType, "").toLowerCase();
  const resolvedPath = pathValue.toLowerCase();
  if (resolvedPath.includes("/docs/wiki/") || resolvedPath.endsWith(".md") || resolvedPath.endsWith(".markdown")) {
    return "wiki_page";
  }
  if (raw.includes("product")) {
    return "product";
  }
  if (raw.includes("repo")) {
    return "repository";
  }
  if (raw.includes("decision")) {
    return "decision";
  }
  if (raw.includes("question")) {
    return "question";
  }
  if (raw.includes("risk")) {
    return "risk";
  }
  if (raw.includes("task")) {
    return "task";
  }
  if (raw.includes("file") || raw.includes("source") || raw.includes("document")) {
    return "source";
  }
  return "concept";
}

function mapGraphifyStatus(value: unknown): GraphNodeStatus {
  const status = stringValue(value, "unknown").toLowerCase();
  if (
    status === "accepted" ||
    status === "active" ||
    status === "candidate" ||
    status === "conflicted" ||
    status === "deprecated" ||
    status === "indexed" ||
    status === "open" ||
    status === "pending" ||
    status === "rejected" ||
    status === "reviewed" ||
    status === "superseded" ||
    status === "validated"
  ) {
    return status;
  }
  return "unknown";
}

function resolveGraphifyPath(repositoryPath: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repositoryPath, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
