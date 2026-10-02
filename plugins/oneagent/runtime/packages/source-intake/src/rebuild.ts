import fs from "node:fs";
import path from "node:path";
import { frontmatterRelatedEntities, parseCaptureFile } from "./capture-file.ts";
import { reingestCapture, type IngestServices } from "./ingest.ts";

export interface RebuildFileResult {
  path: string;
  captureId?: string;
  status: "rebuilt" | "reingested" | "skipped" | "failed";
  error?: string;
}

export interface RebuildResult {
  capturesDir: string;
  scanned: number;
  rebuilt: number;
  reingested: number;
  skipped: number;
  failed: number;
  files: RebuildFileResult[];
}

/**
 * Rebuild the capture rows, their referenced entities and (optionally) the search index
 * from the Markdown capture files, which are the durable source of truth. Safe to run after
 * a reset that preserved the capture files.
 */
export async function rebuildFromCaptures(
  services: IngestServices,
  options: { capturesDir?: string; reingest?: boolean } = {}
): Promise<RebuildResult> {
  const memoryRoot = path.resolve(services.config.workspaceRoot, services.config.workspace.memoryRoot);
  const capturesDir = options.capturesDir ?? path.join(memoryRoot, "captures");
  const reingest = options.reingest !== false;
  const files: RebuildFileResult[] = [];

  for (const filePath of collectMarkdownFiles(capturesDir)) {
    try {
      const { frontmatter } = parseCaptureFile(fs.readFileSync(filePath, "utf8"));
      const id = frontmatter.id || path.basename(filePath, path.extname(filePath));
      if (!frontmatter.title && !frontmatter.id) {
        files.push({ path: filePath, status: "skipped", error: "Not a OneAgent capture file (no frontmatter)." });
        continue;
      }

      restoreEntities(services, frontmatter);

      if (!services.db.getCapture(id)) {
        services.db.createCapture({
          id,
          path: filePath,
          title: frontmatter.title || id,
          contentType: (frontmatter.content_type || "raw_input") as never,
          status: (frontmatter.status || "captured") as never,
          primaryEntityKind: (frontmatter.primary_entity?.kind || "oneagent") as never,
          primaryEntityId: frontmatter.primary_entity?.id || "oneagent",
          relatedEntities: frontmatterRelatedEntities(frontmatter),
          sourceKind: (frontmatter.source?.kind || "import") as never,
          sourceOrigin: (frontmatter.source?.origin || "external_import") as never,
          contentHash: frontmatter.ingestion?.content_hash
        });
      }

      if (reingest) {
        const result = await reingestCapture(services, id);
        files.push({ path: filePath, captureId: id, status: result.status === "indexed" ? "reingested" : "failed", error: result.error });
      } else {
        files.push({ path: filePath, captureId: id, status: "rebuilt" });
      }
    } catch (error) {
      files.push({ path: filePath, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    capturesDir,
    scanned: files.length,
    rebuilt: files.filter((file) => file.status === "rebuilt" || file.status === "reingested").length,
    reingested: files.filter((file) => file.status === "reingested").length,
    skipped: files.filter((file) => file.status === "skipped").length,
    failed: files.filter((file) => file.status === "failed").length,
    files
  };
}

function restoreEntities(services: IngestServices, frontmatter: ReturnType<typeof parseCaptureFile>["frontmatter"]): void {
  const primary = frontmatter.primary_entity;
  if (primary?.kind && primary.id) {
    services.db.upsertEntity({ id: primary.id, kind: primary.kind as never, label: primary.label || primary.id });
  }
  for (const related of frontmatter.related_entities ?? []) {
    if (related.kind && related.id) {
      services.db.upsertEntity({ id: related.id, kind: related.kind as never, label: related.label || related.id });
    }
  }
}

function collectMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        results.push(entryPath);
      }
    }
  };
  walk(root);
  return results.sort();
}
