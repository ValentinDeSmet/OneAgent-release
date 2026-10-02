import type { StructuredInsight } from "../../shared/src/index.ts";
import { extractFallbackGraph, type GraphRelationCandidate } from "./fallback-graph.ts";

export interface GraphProvider {
  readonly name: string;
  extract(content: string, insights: StructuredInsight[]): GraphRelationCandidate[];
}

export class FallbackGraphProvider implements GraphProvider {
  readonly name = "fallback";

  extract(content: string, insights: StructuredInsight[]): GraphRelationCandidate[] {
    return extractFallbackGraph(content, insights);
  }
}

export function createDefaultGraphProvider(): GraphProvider {
  return new FallbackGraphProvider();
}
