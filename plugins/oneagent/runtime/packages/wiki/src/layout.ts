import fs from "node:fs";
import path from "node:path";
import type { EntityRef, WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";

export type WikiLayoutStatus = "ready" | "review" | "conflict" | "migrated";

export interface WikiHomeResolution {
  home?: EntityRef;
  status: "resolved" | "review";
  reason: string;
  candidates: EntityRef[];
}

export interface WikiMigrationEntry {
  source: string;
  target?: string;
  sourceType?: "directory" | "file";
  subject?: EntityRef;
  home?: EntityRef;
  status: WikiLayoutStatus;
  reason: string;
  conflicts?: string[];
}

export interface WikiMigrationReport {
  dryRun: boolean;
  backupPath?: string;
  entries: WikiMigrationEntry[];
  summary: {
    ready: number;
    review: number;
    conflict: number;
    migrated: number;
  };
}

export interface WikiPageMetadata {
  subject: EntityRef;
  home: EntityRef;
  related: EntityRef[];
}

const ROOT_BY_KIND: Record<string, string> = {
  oneagent: "oneagent",
  domain: "domains",
  subdomain: "subdomains",
  team: "teams",
  repository: "repositories",
  mission: "missions",
  okr: "okrs",
  kpi: "kpis",
  person: "people",
  practice: "practices"
};

const PRODUCT_SCOPED_KINDS = new Set(["discovery", "feature", "feature_request", "insight"]);
const OUTBOUND_HOME_RELATIONS = new Set(["part_of", "scoped_to", "owned_by"]);
const INBOUND_HOME_RELATIONS = new Set(["contains", "owns"]);

/** Resolve the single navigation home used to place an entity's wiki content. */
export function resolveWikiHome(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  subject: EntityRef
): WikiHomeResolution {
  if (subject.kind === "initiative") {
    return {
      status: "review",
      reason: "Initiatives are not part of the canonical wiki layout; convert or attach this entity to a project first.",
      candidates: []
    };
  }

  if (subject.kind === "product") {
    return { home: subject, status: "resolved", reason: "A product owns its wiki space.", candidates: [subject] };
  }

  const productIds = new Set(db.listEntities("product").map((entity) => entity.id));
  const candidates = new Map<string, EntityRef>();
  const addProduct = (kind: string, id: string): void => {
    if (kind === "product" && productIds.has(id)) {
      candidates.set(`product:${id}`, { kind: "product", id });
    }
  };

  const entity = db.getEntity(subject.kind, subject.id);
  if (entity?.parentId && productIds.has(entity.parentId)) {
    addProduct("product", entity.parentId);
  }
  for (const relation of db.listEntityRelations({ kind: subject.kind, id: subject.id })) {
    const outbound = relation.sourceKind === subject.kind && relation.sourceId === subject.id;
    if (outbound && OUTBOUND_HOME_RELATIONS.has(relation.relationType)) {
      addProduct(relation.targetKind, relation.targetId);
    }
    const inbound = relation.targetKind === subject.kind && relation.targetId === subject.id;
    if (inbound && INBOUND_HOME_RELATIONS.has(relation.relationType)) {
      addProduct(relation.sourceKind, relation.sourceId);
    }
  }

  const resolved = [...candidates.values()];
  if (resolved.length === 1) {
    return {
      home: resolved[0],
      status: "resolved",
      reason: "Resolved from an explicit parent or structural product relation.",
      candidates: resolved
    };
  }
  if (resolved.length > 1) {
    return {
      status: "review",
      reason: `Several product homes are structurally linked: ${resolved.map(entityRef).join(", ")}.`,
      candidates: resolved
    };
  }

  if (PRODUCT_SCOPED_KINDS.has(subject.kind)) {
    const prefixMatches = [...productIds]
      .filter((productId) => subject.id === productId || subject.id.startsWith(`${productId}-`))
      .map((id) => ({ kind: "product", id }));
    return {
      status: "review",
      reason: prefixMatches.length === 1
        ? `The id suggests ${entityRef(prefixMatches[0])}, but no structural ownership relation confirms it.`
        : "A product-scoped wiki entity requires one explicit product home.",
      candidates: prefixMatches
    };
  }

  if (subject.kind === "project") {
    return { home: subject, status: "resolved", reason: "No product owner: keep this project in the cross-product project space.", candidates: [subject] };
  }

  return { home: subject, status: "resolved", reason: "This entity kind uses its own cross-cutting wiki space.", candidates: [subject] };
}

/** Canonical directory relative to wiki/, independent from the physical workspace root. */
export function canonicalEntityWikiRelativeDir(subject: EntityRef, home: EntityRef): string {
  const subjectId = safeSegment(subject.id);
  if (subject.kind === "initiative") {
    throw new Error("initiative wiki content must be converted or attached to a project");
  }
  if (subject.kind === "product") {
    return path.posix.join("products", subjectId);
  }
  if (PRODUCT_SCOPED_KINDS.has(subject.kind)) {
    if (home.kind !== "product") {
      throw new Error(`${subject.kind}:${subject.id} requires a product home`);
    }
    const collection = subject.kind === "discovery"
      ? "discoveries"
      : subject.kind === "feature"
        ? "features"
        : subject.kind === "feature_request"
          ? "feature-requests"
          : "insights";
    return path.posix.join("products", safeSegment(home.id), collection, subjectId);
  }
  if (subject.kind === "project") {
    return home.kind === "product"
      ? path.posix.join("products", safeSegment(home.id), "projects", subjectId)
      : path.posix.join("projects", subjectId);
  }
  const root = ROOT_BY_KIND[subject.kind] ?? pluralizeKind(subject.kind);
  return path.posix.join(root, subjectId);
}

export function canonicalWikiPageRelativePath(subject: EntityRef, home: EntityRef, page = "index.md"): string {
  const normalizedPage = normalizePagePath(page);
  return path.posix.join(canonicalEntityWikiRelativeDir(subject, home), normalizedPage);
}

export function validateWikiPlacement(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  subject: EntityRef,
  home: EntityRef,
  page = "index.md"
): string {
  if (!entityExists(db, subject)) {
    throw new Error(`Wiki subject does not exist: ${entityRef(subject)}`);
  }
  if (!entityExists(db, home)) {
    throw new Error(`Wiki home does not exist: ${entityRef(home)}`);
  }
  if (PRODUCT_SCOPED_KINDS.has(subject.kind) && home.kind !== "product") {
    throw new Error(`${entityRef(subject)} must use a product home`);
  }
  if (subject.kind === "product" && entityRef(subject) !== entityRef(home)) {
    throw new Error(`${entityRef(subject)} must own its own wiki space`);
  }
  if (subject.kind === "project" && home.kind !== "product" && entityRef(subject) !== entityRef(home)) {
    throw new Error(`${entityRef(subject)} must use a product home or its own cross-product space`);
  }
  if (!PRODUCT_SCOPED_KINDS.has(subject.kind) && !["product", "project"].includes(subject.kind) && entityRef(subject) !== entityRef(home)) {
    throw new Error(`${entityRef(subject)} must own its cross-cutting wiki space`);
  }
  return canonicalWikiPageRelativePath(subject, home, page);
}

/** Add or replace the controlled OneAgent frontmatter while preserving other frontmatter keys. */
export function withWikiMetadata(content: string, metadata: WikiPageMetadata): string {
  const normalized = content.replace(/^\uFEFF/, "");
  const block = metadataBlock(metadata);
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return `---\n${block.join("\n")}\n---\n\n${normalized.replace(/^\n+/, "")}`;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return `---\n${block.join("\n")}\n---\n\n${normalized}`;
  }
  const frontmatter = lines.slice(1, end);
  const kept: string[] = [];
  for (let index = 0; index < frontmatter.length; index += 1) {
    if (frontmatter[index].trim() !== "oneagent:") {
      kept.push(frontmatter[index]);
      continue;
    }
    index += 1;
    while (index < frontmatter.length && (frontmatter[index].trim() === "" || /^\s/.test(frontmatter[index]))) {
      index += 1;
    }
    index -= 1;
  }
  const nextFrontmatter = [...kept.filter((line, index, all) => line.trim() || all[index - 1]?.trim()), ...block];
  return ["---", ...nextFrontmatter, "---", ...lines.slice(end + 1)].join("\n");
}

export function parseWikiMetadata(content: string): Partial<WikiPageMetadata> | undefined {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return undefined;
  }
  const start = lines.findIndex((line, index) => index > 0 && index < end && line.trim() === "oneagent:");
  if (start === -1) {
    return undefined;
  }
  let subject: EntityRef | undefined;
  let home: EntityRef | undefined;
  const related: EntityRef[] = [];
  let inRelated = false;
  for (const raw of lines.slice(start + 1, end)) {
    if (raw && !/^\s/.test(raw)) {
      break;
    }
    const line = raw.trim();
    if (line.startsWith("subject:")) {
      subject = parseRefScalar(line.slice("subject:".length));
      inRelated = false;
    } else if (line.startsWith("home:")) {
      home = parseRefScalar(line.slice("home:".length));
      inRelated = false;
    } else if (line === "related:") {
      inRelated = true;
    } else if (inRelated && line.startsWith("- ")) {
      const ref = parseRefScalar(line.slice(2));
      if (ref) related.push(ref);
    }
  }
  return { subject, home, related };
}

export function planWikiLayoutMigration(config: WorkMemoryConfig, db: WorkMemoryDatabase): WikiMigrationReport {
  const root = wikiRoot(config);
  const entries: WikiMigrationEntry[] = [];
  for (const entity of db.listEntities()) {
    const subject = { kind: entity.kind, id: entity.id };
    const legacyBase = path.posix.join(safeSegment(entity.kind), safeSegment(entity.id));
    const directoryAbsolute = path.join(root, ...legacyBase.split("/"));
    const sources: Array<{ source: string; absolute: string; sourceType: "directory" | "file" }> = [];
    if (fs.existsSync(directoryAbsolute) && fs.statSync(directoryAbsolute).isDirectory()) {
      sources.push({ source: legacyBase, absolute: directoryAbsolute, sourceType: "directory" });
    }
    for (const extension of [".md", ".markdown"]) {
      const source = `${legacyBase}${extension}`;
      const absolute = path.join(root, ...source.split("/"));
      if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
        sources.push({ source, absolute, sourceType: "file" });
      }
    }
    if (sources.length === 0) continue;
    const resolution = resolveWikiHome(config, db, subject);
    for (const legacy of sources) {
      if (!resolution.home || resolution.status === "review") {
        entries.push({
          source: legacy.source,
          sourceType: legacy.sourceType,
          subject,
          status: "review",
          reason: resolution.reason
        });
        continue;
      }
      const targetDirectory = canonicalEntityWikiRelativeDir(subject, resolution.home);
      const target = legacy.sourceType === "file" ? path.posix.join(targetDirectory, "index.md") : targetDirectory;
      if (target === legacy.source) continue;
      const targetAbsolute = path.join(root, ...target.split("/"));
      const conflicts = legacy.sourceType === "file"
        ? fileConflicts(legacy.absolute, targetAbsolute)
        : directoryConflicts(legacy.absolute, targetAbsolute);
      if (sources.length > 1 && legacy.sourceType === "file") {
        conflicts.push("Several legacy sources exist for the same entity; merge them explicitly before migration.");
      }
      entries.push({
        source: legacy.source,
        sourceType: legacy.sourceType,
        target,
        subject,
        home: resolution.home,
        status: conflicts.length > 0 ? "conflict" : "ready",
        reason: conflicts.length > 0 ? "The canonical target conflicts with legacy content." : resolution.reason,
        conflicts: conflicts.length > 0 ? conflicts : undefined
      });
    }
  }
  entries.push(...planProductDiscoveryResearchMigration(config, db, root));
  return migrationReport(true, entries);
}

export function applyWikiLayoutMigration(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  planned = planWikiLayoutMigration(config, db)
): WikiMigrationReport {
  const root = wikiRoot(config);
  const hasReadyEntries = planned.entries.some((entry) => entry.status === "ready");
  const backupPath = hasReadyEntries && fs.existsSync(root) ? backupWiki(config, root) : undefined;
  const mappings: Array<{ source: string; target: string }> = [];
  const fileMoves: Array<{ source: string; target: string }> = [];
  const entries = planned.entries.map((entry): WikiMigrationEntry => {
    if (entry.status !== "ready" || !entry.target || !entry.home || !entry.subject) {
      return entry;
    }
    const source = path.join(root, ...entry.source.split("/"));
    const target = path.join(root, ...entry.target.split("/"));
    if (entry.sourceType === "file") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        if (fs.readFileSync(source).compare(fs.readFileSync(target)) !== 0) {
          return { ...entry, status: "conflict", reason: "The canonical target changed after migration preview." };
        }
        fs.rmSync(source);
      } else {
        fs.renameSync(source, target);
      }
      const current = fs.readFileSync(target, "utf8");
      const existing = parseWikiMetadata(current);
      fs.writeFileSync(target, withWikiMetadata(current, {
        subject: entry.subject,
        home: entry.home,
        related: existing?.related ?? []
      }), "utf8");
      fileMoves.push({ source: entry.source, target: entry.target });
      mappings.push({ source: entry.source, target: entry.target });
      return { ...entry, status: "migrated" };
    }
    const movedMarkdown = collectMarkdown(source).map((file) => path.relative(source, file));
    for (const relative of movedMarkdown) {
      fileMoves.push({
        source: path.posix.join(entry.source, relative.split(path.sep).join("/")),
        target: path.posix.join(entry.target, relative.split(path.sep).join("/"))
      });
    }
    mergeDirectory(source, target);
    for (const relative of movedMarkdown) {
      const file = path.join(target, relative);
      if (!fs.existsSync(file)) continue;
      const current = fs.readFileSync(file, "utf8");
      const existing = parseWikiMetadata(current);
      fs.writeFileSync(file, withWikiMetadata(current, {
        subject: entry.subject,
        home: entry.home,
        related: existing?.related ?? []
      }), "utf8");
    }
    mappings.push({ source: entry.source, target: entry.target });
    return { ...entry, status: "migrated" };
  });
  rewriteWikiLinks(root, mappings, fileMoves);
  removeEmptyLegacyRoots(root);
  return migrationReport(false, entries, backupPath);
}

/**
 * Detect the intermediate product-scoped singular layout used for research
 * notes. A note is safe to move only when controlled metadata already binds it
 * to an existing discovery entity. Unbound research belongs in immutable
 * captures, so it must be reviewed instead of being promoted into a fake
 * discovery solely from its filename.
 */
function planProductDiscoveryResearchMigration(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  root: string
): WikiMigrationEntry[] {
  const productsRoot = path.join(root, "products");
  if (!fs.existsSync(productsRoot)) return [];
  const entries: WikiMigrationEntry[] = [];
  for (const productEntry of fs.readdirSync(productsRoot, { withFileTypes: true })) {
    if (!productEntry.isDirectory()) continue;
    const productId = productEntry.name;
    const legacyRoot = path.join(productsRoot, productId, "discovery");
    if (!fs.existsSync(legacyRoot) || !fs.statSync(legacyRoot).isDirectory()) continue;
    for (const absolute of collectMarkdown(legacyRoot)) {
      const source = path.relative(root, absolute).split(path.sep).join("/");
      const content = fs.readFileSync(absolute, "utf8");
      const metadata = parseWikiMetadata(content);
      if (!metadata?.subject || metadata.subject.kind !== "discovery" || !metadata.home) {
        entries.push({
          source,
          sourceType: "file",
          status: "review",
          reason: "This is legacy research material, not a bound discovery entity page. Re-ingest it as a capture and attach it to an existing discovery before removing the Wiki copy."
        });
        continue;
      }
      const subject = metadata.subject;
      if (!entityExists(db, subject)) {
        entries.push({
          source,
          sourceType: "file",
          subject,
          status: "review",
          reason: `The page declares ${entityRef(subject)}, but that discovery entity does not exist.`
        });
        continue;
      }
      if (metadata.home.kind !== "product" || metadata.home.id !== productId) {
        entries.push({
          source,
          sourceType: "file",
          subject,
          home: metadata.home,
          status: "review",
          reason: `The page is stored under product:${productId} but declares home ${entityRef(metadata.home)}.`
        });
        continue;
      }
      const resolution = resolveWikiHome(config, db, subject);
      if (!resolution.home || resolution.status !== "resolved" || entityRef(resolution.home) !== `product:${productId}`) {
        entries.push({
          source,
          sourceType: "file",
          subject,
          home: metadata.home,
          status: "review",
          reason: resolution.reason
        });
        continue;
      }
      const page = path.relative(legacyRoot, absolute).split(path.sep).join("/");
      const target = canonicalWikiPageRelativePath(subject, resolution.home, page);
      const conflicts = fileConflicts(absolute, path.join(root, ...target.split("/")));
      entries.push({
        source,
        sourceType: "file",
        target,
        subject,
        home: resolution.home,
        status: conflicts.length > 0 ? "conflict" : "ready",
        reason: conflicts.length > 0
          ? "The canonical discovery page already contains different content."
          : "Controlled metadata binds this legacy page to an existing product-scoped discovery.",
        conflicts: conflicts.length > 0 ? conflicts : undefined
      });
    }
  }
  return entries;
}

function migrationReport(dryRun: boolean, entries: WikiMigrationEntry[], backupPath?: string): WikiMigrationReport {
  return {
    dryRun,
    backupPath,
    entries,
    summary: {
      ready: entries.filter((entry) => entry.status === "ready").length,
      review: entries.filter((entry) => entry.status === "review").length,
      conflict: entries.filter((entry) => entry.status === "conflict").length,
      migrated: entries.filter((entry) => entry.status === "migrated").length
    }
  };
}

function metadataBlock(metadata: WikiPageMetadata): string[] {
  const lines = ["oneagent:", `  subject: ${entityRef(metadata.subject)}`, `  home: ${entityRef(metadata.home)}`];
  if (metadata.related.length > 0) {
    lines.push("  related:");
    for (const related of metadata.related) lines.push(`    - ${entityRef(related)}`);
  }
  return lines;
}

function parseRefScalar(value: string): EntityRef | undefined {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "");
  const separator = normalized.indexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) return undefined;
  return { kind: normalized.slice(0, separator), id: normalized.slice(separator + 1) };
}

function entityRef(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

function entityExists(db: WorkMemoryDatabase, ref: EntityRef): boolean {
  return Boolean(db.getEntity(ref.kind, ref.id));
}

function normalizePagePath(page: string): string {
  if (!page || path.posix.isAbsolute(page) || path.win32.isAbsolute(page)) {
    throw new Error("Wiki page path must be relative to its entity space.");
  }
  const normalized = page.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.split("/").includes("..")) {
    throw new Error("Wiki page path cannot escape its entity space.");
  }
  if (!/\.(md|markdown)$/i.test(normalized)) {
    throw new Error("Wiki pages must be Markdown (.md).");
  }
  return normalized;
}

function pluralizeKind(kind: string): string {
  const safe = safeSegment(kind).replace(/_/g, "-");
  return safe.endsWith("s") ? safe : `${safe}s`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function wikiRoot(config: WorkMemoryConfig): string {
  return path.resolve(config.workspaceRoot, "wiki");
}

function backupWiki(config: WorkMemoryConfig, root: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const memoryRoot = path.resolve(config.workspaceRoot, config.workspace.memoryRoot || ".work-memory");
  const backup = path.join(memoryRoot, "backups", `wiki-layout-${stamp}`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.cpSync(root, backup, { recursive: true, errorOnExist: true });
  return backup;
}

function directoryConflicts(source: string, target: string): string[] {
  if (!fs.existsSync(target)) return [];
  const conflicts: string[] = [];
  for (const sourceFile of collectFiles(source)) {
    const relative = path.relative(source, sourceFile);
    const targetFile = path.join(target, relative);
    if (fs.existsSync(targetFile) && fs.readFileSync(sourceFile).compare(fs.readFileSync(targetFile)) !== 0) {
      conflicts.push(relative.split(path.sep).join("/"));
    }
  }
  return conflicts;
}

function fileConflicts(source: string, target: string): string[] {
  if (!fs.existsSync(target)) return [];
  return fs.readFileSync(source).compare(fs.readFileSync(target)) === 0 ? [] : [path.basename(target)];
}

function mergeDirectory(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    return;
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const into = path.join(target, entry.name);
    if (entry.isDirectory()) {
      mergeDirectory(from, into);
    } else if (!fs.existsSync(into)) {
      fs.mkdirSync(path.dirname(into), { recursive: true });
      fs.renameSync(from, into);
    } else if (fs.readFileSync(from).compare(fs.readFileSync(into)) === 0) {
      fs.rmSync(from);
    }
  }
  if (fs.existsSync(source) && fs.readdirSync(source).length === 0) fs.rmdirSync(source);
}

function rewriteWikiLinks(
  root: string,
  mappings: Array<{ source: string; target: string }>,
  fileMoves: Array<{ source: string; target: string }>
): void {
  if (mappings.length === 0) return;
  const originalByCurrent = new Map(fileMoves.map((move) => [move.target, move.source]));
  const mapRelativePath = (value: string): string => {
    const normalized = path.posix.normalize(value);
    const match = [...mappings]
      .sort((left, right) => right.source.length - left.source.length)
      .find((mapping) => normalized === mapping.source || normalized.startsWith(`${mapping.source}/`));
    return match ? `${match.target}${normalized.slice(match.source.length)}` : normalized;
  };
  for (const file of collectMarkdown(root)) {
    const original = fs.readFileSync(file, "utf8");
    const currentFile = path.relative(root, file).split(path.sep).join("/");
    const originalFile = originalByCurrent.get(currentFile) ?? currentFile;
    let updated = original;
    updated = updated.replace(/\]\(([^)]+)\)/g, (whole, rawTarget: string) => {
      const target = rawTarget.trim();
      if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
      const anchorIndex = target.search(/[?#]/);
      const targetPath = anchorIndex === -1 ? target : target.slice(0, anchorIndex);
      const suffix = anchorIndex === -1 ? "" : target.slice(anchorIndex);
      if (targetPath.startsWith("wiki/")) {
        return `](${`wiki/${mapRelativePath(targetPath.slice("wiki/".length))}`}${suffix})`;
      }
      const originalTarget = path.posix.normalize(path.posix.join(path.posix.dirname(originalFile), targetPath));
      const mappedTarget = mapRelativePath(originalTarget);
      let nextTarget = path.posix.relative(path.posix.dirname(currentFile), mappedTarget);
      if (!nextTarget.startsWith(".")) nextTarget = `./${nextTarget}`;
      return `](${nextTarget}${suffix})`;
    });
    for (const mapping of mappings) {
      updated = updated.replaceAll(`wiki/${mapping.source}`, `wiki/${mapping.target}`);
      updated = updated.replaceAll(mapping.source, mapping.target);
    }
    if (updated !== original) fs.writeFileSync(file, updated, "utf8");
  }
}

function removeEmptyLegacyRoots(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(root, entry.name));
  }
}

function removeEmptyDirectories(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(dir, entry.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function collectMarkdown(root: string): string[] {
  return collectFiles(root).filter((file) => /\.(md|markdown)$/i.test(file));
}

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}
