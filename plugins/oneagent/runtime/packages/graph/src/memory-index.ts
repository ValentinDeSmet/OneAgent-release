import fs from "node:fs";
import path from "node:path";
import type { EntityRef, ResolvedContextScope, WorkMemoryConfig } from "../../shared/src/index.ts";
import { isMetadataOnlyEntityRef } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { listTaskReadModel } from "../../tasks/src/index.ts";
import { entityWikiDir, listWikiPages, listRepositoryWikiPages, parseWikiMetadata } from "../../wiki/src/index.ts";

export interface MemoryEntry {
  id: string;
  kind: string;
  category: "entity" | "document" | "source" | "note" | "capture" | "task";
  title: string;
  description?: string;
  status?: string;
  updatedAt?: string;
  refs: string[];
  labels: string[];
  file?: string;
  url?: string;
  detailRef?: string;
  taskId?: string;
  noteId?: string;
}

const key = (ref: EntityRef) => `${ref.kind}:${ref.id}`;
const within = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
const webUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return; }
};

/** A complete metadata catalogue, independent of the graph's rendering budget.
 * No network fetch, embedding, or persistent duplicate of document contents. */
export function buildMemoryIndex(config: WorkMemoryConfig, db: WorkMemoryDatabase, context?: ResolvedContextScope): { entries: MemoryEntry[] } {
  const strict = context?.scope.mode === "strict" ? context : undefined;
  const access = strict?.scope.sourceAccess ?? "full";
  const allowed = strict ? new Set(strict.entities.map(key)) : undefined;
  const entities = db.listEntities().filter(entity => !allowed || allowed.has(key(entity)));
  const labels = new Map(entities.map(entity => [key(entity), entity.label]));
  const safeRefs = (refs: string[]) => [...new Set(refs)].filter(ref => !allowed || allowed.has(ref));
  const contentRefs = new Set(entities.filter(entity => !isMetadataOnlyEntityRef(strict, entity)).map(key));
  const entries: MemoryEntry[] = [];
  const roots = [config.workspaceRoot, ...config.products.flatMap(product => product.repositories.map(repo => repo.path))]
    .filter((root): root is string => Boolean(root) && fs.existsSync(root!)).map(root => fs.realpathSync(root));
  const filePath = (candidate: string | undefined) => {
    if (!candidate || access !== "full") return;
    try {
      const resolved = fs.realpathSync(path.resolve(config.workspaceRoot, candidate));
      return roots.some(root => within(resolved, root)) && fs.statSync(resolved).isFile() ? resolved : undefined;
    } catch { return; }
  };
  const add = (entry: Omit<MemoryEntry, "labels">) => {
    entry.refs = safeRefs(entry.refs);
    entries.push({ ...entry, labels: entry.refs.map(ref => labels.get(ref) || ref) });
  };
  const related = new Map<string, string[]>();
  for (const relation of db.listEntityRelations()) {
    const left = `${relation.sourceKind}:${relation.sourceId}`, right = `${relation.targetKind}:${relation.targetId}`;
    if (strict && (!contentRefs.has(left) || !contentRefs.has(right))) continue;
    related.set(left, [...(related.get(left) ?? []), right]);
    related.set(right, [...(related.get(right) ?? []), left]);
  }
  for (const entity of entities) {
    const ref = key(entity), content = contentRefs.has(ref);
    add({ id: `entity:${ref}`, kind: entity.kind, category: "entity", title: entity.label, refs: [ref, ...(related.get(ref) ?? [])], detailRef: ref,
      ...(content ? { description: [entity.description, ...(entity.aliases ?? [])].filter(Boolean).join(" · "), status: entity.status, updatedAt: entity.updatedAt,
        url: access === "full" ? webUrl(entity.metadata?.url) : undefined } : {}) });
  }
  const entityEntries = new Map(entries.filter(entry => entry.category === "entity").map(entry => [entry.detailRef, entry]));
  // A path belongs to its most specific entity directory (a product directory
  // may also contain nested feature slices). This also supports legacy pages.
  const dirs = (access === "full" ? entities : []).filter(entity => contentRefs.has(key(entity))).map(entity => { const dir = entityWikiDir(config, entity.kind, entity.id, db); return { ref: key(entity), dir: fs.existsSync(dir) ? fs.realpathSync(dir) : dir }; }).sort((a, b) => b.dir.length - a.dir.length);
  if (access === "full") {
    const pages = listWikiPages(config);
    for (const page of pages) {
      const file = filePath(page.absolutePath);
      if (!file) continue;
      // Read a bounded header, never the whole document, for title/frontmatter.
      const owner = dirs.find(item => within(file, item.dir));
      if (strict && !owner) continue;
      const fd = fs.openSync(file, "r");
      let header: string;
      try { const buf = Buffer.alloc(8192); header = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8"); } finally { fs.closeSync(fd); }
      const parsed = parseWikiMetadata(header);
      const metadata = parsed?.subject && parsed.home ? { subject: parsed.subject, home: parsed.home, related: parsed.related } : undefined;
      if (strict && metadata && (!contentRefs.has(key(metadata.subject)) || !contentRefs.has(key(metadata.home)))) continue;
      const refs = metadata ? [key(metadata.subject), key(metadata.home), ...(metadata.related ?? []).map(key)] : owner ? [owner.ref] : [];
      const title = header.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file);
      add({ id: `document:${page.relativePath}`, kind: "markdown", category: "document", title, description: page.relativePath, updatedAt: page.updatedAt, refs, file, detailRef: metadata ? key(metadata.subject) : owner?.ref });
      const entity = entityEntries.get(metadata ? key(metadata.subject) : owner?.ref);
      if (entity && (!entity.file || /\/(index|page)\.md$/i.test(file))) entity.file = file;
    }
    for (const page of listRepositoryWikiPages(config, db, strict ? { repositoryIds: entities.filter(e => e.kind === "repository" && contentRefs.has(key(e))).map(e => e.id) } : {})) {
      const repo = entities.find(entity => entity.kind === "repository" && entity.id === page.repositoryId);
      if (!repo?.repoPath) continue;
      const file = filePath(path.resolve(repo.repoPath, repo.wikiRoot || "docs/wiki", page.relativePath));
      if (file && !entries.some(entry => entry.category === "document" && entry.file === file)) add({ id: `repository-document:${page.repositoryId}:${page.relativePath}`, kind: "markdown", category: "document", title: path.basename(file), description: page.relativePath, refs: [`repository:${page.repositoryId}`, ...page.entityRefs.map(key)], file, updatedAt: page.updatedAt });
    }
  }
  const capturedSources = new Map<string, string>();
  if (access !== "none") {
    for (const capture of db.listCaptures({})) {
      if (strict && !strict.captureIds.includes(capture.id)) continue;
      const primary = `${capture.primaryEntityKind}:${capture.primaryEntityId}`;
      if (strict && !contentRefs.has(primary)) continue;
      const note = capture.sourceKind === "manual" && ["note", "question"].includes(capture.contentType);
      if (capture.sourceId) capturedSources.set(capture.sourceId, `capture:${capture.id}`);
      add({ id: `capture:${capture.id}`, category: note ? "note" : "capture", kind: capture.contentType, title: capture.title, status: capture.status, updatedAt: capture.updatedAt,
        refs: [primary, ...capture.relatedEntities.map(ref => `${ref.entityKind}:${ref.entityId}`)], detailRef: primary,
        file: filePath(capture.path), noteId: note && access === "full" ? capture.id : undefined });
    }
    for (const source of db.listSourceProvenance()) {
      if (strict && !strict.sourceIds.includes(source.id)) continue;
      if (source.status === "superseded") continue;
      const url = access === "full" ? webUrl(source.originUri) : undefined;
      const file = filePath(source.rawPath);
      const existing = entries.find(entry => entry.id === capturedSources.get(source.id) || (file && entry.file === file && entry.category === "document"));
      if (existing) { if (url) existing.url = url; continue; }
      const kind = url?.includes("docs.google.com/spreadsheets/") ? "google_sheet" : url?.includes("docs.google.com/document/") ? "google_doc" : url ? "linked_document" : "source";
      add({ id: `source:${source.id}`, category: "source", kind, title: source.title, refs: source.entityLinks.map(key), status: source.status, updatedAt: source.capturedAt,
        url, file, description: access === "full" ? source.originUri : undefined });
    }
  }
  for (const task of listTaskReadModel(db, [])) {
    if (strict && !strict.taskIds.includes(task.id)) continue;
    add({ id: `task:${task.id}`, category: "task", kind: "task", title: task.title, taskId: task.id, status: task.status, updatedAt: task.updatedAt,
      description: access === "full" ? task.body : undefined,
      refs: [...(task.productId ? [`product:${task.productId}`] : []), ...task.links.map(link => `${link.targetKind}:${link.targetId}`)] });
  }
  return { entries };
}
