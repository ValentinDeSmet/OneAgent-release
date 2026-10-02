import fs from "node:fs";
import path from "node:path";
import { isPathInside } from "../../shared/src/index.ts";
import type { InboxItem, ProductConfig, WorkMemoryConfig } from "../../shared/src/index.ts";
import { resolveWikiPath } from "./wiki-store.ts";

export interface WikiPatchPreview {
  action: "append" | "create" | "replace" | "none";
  targetPath?: string;
  content?: string;
  reason?: string;
}

export function previewWikiPatch(product: ProductConfig, item: InboxItem): WikiPatchPreview {
  const targetPath = item.payload.targetPath;
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return {
      action: "none",
      reason: `Inbox item ${item.id} has no wiki target path.`
    };
  }

  const resolvedTargetPath = resolveWikiTargetPath(product, targetPath);
  const content = buildWikiContent(item);
  const shouldReplace = item.payload.proposalKind === "wiki_write_review";

  return {
    action: fs.existsSync(resolvedTargetPath) ? (shouldReplace ? "replace" : "append") : "create",
    targetPath: resolvedTargetPath,
    content
  };
}

/** @deprecated Legacy Inbox publication must not infer a shared repo from a product. */
export function applyWikiPatch(_product: ProductConfig, _item: InboxItem): WikiPatchPreview {
  throw new Error("Product wiki publication is blocked. Keep the synthesis in private memory; a shared contribution requires an explicit repository target and reviewed content.");
}

export function previewGlobalWikiPatch(config: WorkMemoryConfig, item: InboxItem): WikiPatchPreview {
  const targetPath = item.payload.targetPath;
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return {
      action: "none",
      reason: `Inbox item ${item.id} has no wiki target path.`
    };
  }

  const resolvedTargetPath = resolveGlobalWikiTargetPath(config, targetPath);
  const content = buildWikiContent(item);
  const shouldReplace = item.payload.proposalKind === "wiki_write_review";

  return {
    action: fs.existsSync(resolvedTargetPath) ? (shouldReplace ? "replace" : "append") : "create",
    targetPath: resolvedTargetPath,
    content
  };
}

export function applyGlobalWikiPatch(config: WorkMemoryConfig, item: InboxItem): WikiPatchPreview {
  const preview = previewGlobalWikiPatch(config, item);
  if (preview.action === "none" || !preview.targetPath || !preview.content) {
    return preview;
  }

  fs.mkdirSync(path.dirname(preview.targetPath), { recursive: true });
  if (preview.action === "append") {
    const existing = fs.readFileSync(preview.targetPath, "utf8");
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(preview.targetPath, `${existing}${separator}${preview.content}`, "utf8");
  } else {
    const output = preview.content.endsWith("\n") ? preview.content : `${preview.content}\n`;
    fs.writeFileSync(preview.targetPath, output, "utf8");
  }

  return preview;
}

export function resolveWikiTargetPath(product: ProductConfig, targetPath: string): string {
  const repository = product.repositories.find((candidate) => candidate.wikiRoot) ?? product.repositories[0];
  if (!repository) {
    throw new Error(`Product ${product.id} has no repository configured.`);
  }

  if (path.isAbsolute(targetPath)) {
    throw new Error("Wiki target path must be relative.");
  }

  const wikiRoot = repository.wikiRoot ?? "docs/wiki";
  const normalizedTargetPath = targetPath.startsWith(`${wikiRoot}/`) || targetPath === wikiRoot
    ? targetPath
    : path.join(wikiRoot, targetPath);
  const absoluteWikiRoot = path.resolve(repository.path, wikiRoot);
  const absoluteTargetPath = path.resolve(repository.path, normalizedTargetPath);

  if (!isPathInside(absoluteTargetPath, absoluteWikiRoot)) {
    throw new Error(`Refusing to write outside wiki root: ${targetPath}`);
  }

  return absoluteTargetPath;
}

export function resolveGlobalWikiTargetPath(config: WorkMemoryConfig, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    throw new Error("Wiki target path must be relative.");
  }
  const normalizedTargetPath = targetPath.startsWith("wiki/")
    ? targetPath.slice("wiki/".length)
    : targetPath;
  return resolveWikiPath(config, normalizedTargetPath);
}

function buildWikiContent(item: InboxItem): string {
  if (item.payload.proposalKind === "wiki_write_review" && typeof item.payload.content === "string") {
    return item.payload.content;
  }

  const confidence = typeof item.payload.confidence === "number" ? item.payload.confidence.toFixed(2) : "unknown";
  const sourceLine = item.sourceId ? `Source: ${item.sourceId}` : "Source: unknown";
  const metadata = [
    `Status: candidate`,
    `Type: ${item.type}`,
    `Confidence: ${confidence}`,
    sourceLine
  ].join("\n");

  if (item.type === "open_question") {
    return `## ${item.title}\n\n${metadata}\n\n${item.body}`;
  }

  if (item.type === "risk") {
    return `## ${item.title}\n\n${metadata}\n\n${item.body}`;
  }

  return `# ${item.title}\n\n${metadata}\n\n## Summary\n\n${item.body}`;
}
