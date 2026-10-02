import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, isPathInside, nowIso } from "../../shared/src/index.ts";
import type { EntityRef, WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import {
  canonicalEntityWikiRelativeDir,
  parseWikiMetadata,
  resolveWikiHome,
  validateWikiPlacement,
  withWikiMetadata
} from "./layout.ts";
import { withEntityPageFields } from "./entity-page.ts";

export interface WikiPage {
  relativePath: string;
  absolutePath: string;
  bytes: number;
  updatedAt: string;
}

export interface RepositoryWikiPage {
  repositoryId: string;
  entityRefs: EntityRef[];
  relativePath: string;
  bytes: number;
  updatedAt: string;
}

/** The agent-owned global wiki lives at <workspace>/wiki, browsable and never written by humans. */
export function globalWikiRoot(config: WorkMemoryConfig): string {
  return path.resolve(config.workspaceRoot, "wiki");
}

/** Legacy directory used before the product-centred wiki layout. */
export function legacyEntityWikiDir(config: WorkMemoryConfig, kind: string, id: string): string {
  return path.join(globalWikiRoot(config), safeSegment(kind), safeSegment(id));
}

/** Directory holding one entity's curated slice in the canonical product-centred layout. */
export function entityWikiDir(
  config: WorkMemoryConfig,
  kind: string,
  id: string,
  db?: WorkMemoryDatabase
): string {
  if (!db) {
    return legacyEntityWikiDir(config, kind, id);
  }
  const subject = { kind, id };
  const resolution = resolveWikiHome(config, db, subject);
  if (resolution.home && resolution.status === "resolved") {
    return path.join(globalWikiRoot(config), ...canonicalEntityWikiRelativeDir(subject, resolution.home).split("/"));
  }
  const unplaced = path.join(globalWikiRoot(config), "unplaced", safeSegment(kind), safeSegment(id));
  if (fs.existsSync(unplaced)) return unplaced;
  return findEntityWikiDirByMetadata(config, subject) ?? legacyEntityWikiDir(config, kind, id);
}

/** Resolve a relative wiki path to an absolute one, refusing anything outside the global wiki. */
export function resolveWikiPath(config: WorkMemoryConfig, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("Wiki path must be relative to the wiki root.");
  }
  const root = globalWikiRoot(config);
  const absolute = path.resolve(root, relativePath);
  if (!isPathInside(absolute, root)) {
    throw new Error(`Refusing to access path outside the wiki root: ${relativePath}`);
  }
  return absolute;
}

export function readWikiPage(config: WorkMemoryConfig, relativePath: string): string {
  const absolute = resolveWikiPath(config, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Wiki page not found: ${relativePath}`);
  }
  return fs.readFileSync(absolute, "utf8");
}

export function writeWikiPage(config: WorkMemoryConfig, relativePath: string, content: string): string {
  if (!/\.(md|markdown)$/i.test(relativePath)) {
    throw new Error("Wiki pages must be Markdown (.md).");
  }
  const absolute = resolveWikiPath(config, relativePath);
  atomicWriteFile(absolute, content.endsWith("\n") ? content : `${content}\n`);
  return absolute;
}

export interface WriteEntityWikiPageInput {
  subject: EntityRef;
  home: EntityRef;
  page?: string;
  related?: EntityRef[];
  content: string;
}

/** Write entity-owned content through the canonical layout and controlled frontmatter. */
export function writeEntityWikiPage(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  input: WriteEntityWikiPageInput
): { relativePath: string; absolutePath: string; content: string } {
  const relativePath = validateWikiPlacement(config, db, input.subject, input.home, input.page ?? "index.md");
  const existingMetadata = parseWikiMetadata(input.content);
  const related = input.related ?? existingMetadata?.related ?? [];
  for (const ref of related) {
    if (!db.getEntity(ref.kind, ref.id)) throw new Error(`Related wiki entity does not exist: ${ref.kind}:${ref.id}`);
  }
  let content = withWikiMetadata(input.content, {
    subject: input.subject,
    home: input.home,
    related
  });
  if ((input.page ?? "index.md") === "index.md") {
    const entity = db.getEntity(input.subject.kind, input.subject.id);
    if (entity) content = withEntityPageFields(content, entity);
  }
  const absolutePath = writeWikiPage(config, relativePath, content);
  return { relativePath, absolutePath, content };
}

export function deleteWikiPage(config: WorkMemoryConfig, relativePath: string): void {
  const absolute = resolveWikiPath(config, relativePath);
  if (fs.existsSync(absolute)) {
    fs.rmSync(absolute);
  }
}

export interface EntityWikiPage {
  relativePath: string;
  absolutePath: string;
  content: string;
  updatedAt: string;
  bytes: number;
  truncated: boolean;
}

const ENTITY_WIKI_PAGE_CHAR_LIMIT = 20000;
const ENTITY_WIKI_TOTAL_CHAR_LIMIT = 60000;

/**
 * Read one entity's curated wiki slice with page contents, for UI payloads (entity context,
 * cockpit selection panel). page.md/index.md sort first; contents are size-capped so a large
 * slice cannot blow up a JSON payload.
 */
export function listEntityWikiPages(
  config: WorkMemoryConfig,
  kind: string,
  id: string,
  db?: WorkMemoryDatabase
): EntityWikiPage[] {
  const canonicalDir = entityWikiDir(config, kind, id, db);
  const legacyDir = legacyEntityWikiDir(config, kind, id);
  // Never merge canonical and legacy copies into one entity context. That made
  // duplicate pages look like one valid synthesis and allowed stale knowledge
  // to leak back into the cockpit. Legacy content remains readable only until
  // a canonical slice exists, so the migration/lint workflow can recover it.
  const sliceDirs = fs.existsSync(canonicalDir)
    ? [canonicalDir]
    : (fs.existsSync(legacyDir) ? [legacyDir] : []);
  const files = sliceDirs
    .flatMap((sliceDir) => collectMarkdown(sliceDir).map((absolute) => ({ sliceDir, absolute })))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.absolute === entry.absolute) === index)
    .sort((left, right) => {
      const leftRelative = path.relative(left.sliceDir, left.absolute).split(path.sep).join("/");
      const rightRelative = path.relative(right.sliceDir, right.absolute).split(path.sep).join("/");
      return entityPageRank(leftRelative) - entityPageRank(rightRelative) || leftRelative.localeCompare(rightRelative);
    });
  const pages: EntityWikiPage[] = [];
  let budget = ENTITY_WIKI_TOTAL_CHAR_LIMIT;
  for (const file of files) {
    if (budget <= 0) {
      break;
    }
    const absolute = file.absolute;
    const relative = path.relative(file.sliceDir, absolute).split(path.sep).join("/");
    const stat = fs.statSync(absolute);
    const raw = fs.readFileSync(absolute, "utf8");
    const limit = Math.min(ENTITY_WIKI_PAGE_CHAR_LIMIT, budget);
    const content = raw.length > limit ? raw.slice(0, limit) : raw;
    budget -= content.length;
    pages.push({
      relativePath: relative,
      absolutePath: absolute,
      content,
      updatedAt: stat.mtime.toISOString(),
      bytes: stat.size,
      truncated: content.length < raw.length
    });
  }
  return pages;
}

function entityPageRank(relativePath: string): number {
  const normalized = relativePath.toLowerCase();
  return normalized === "page.md" || normalized === "index.md" ? 0 : 1;
}

export function listWikiPages(config: WorkMemoryConfig): WikiPage[] {
  const root = globalWikiRoot(config);
  return collectMarkdown(root).map((absolute) => {
    const stat = fs.statSync(absolute);
    return {
      relativePath: path.relative(root, absolute).split(path.sep).join("/"),
      absolutePath: absolute,
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  });
}

/**
 * List external repository wiki pages without returning their absolute paths.
 * Callers pass an already-resolved allowlist so strict agent reads never need
 * access to raw ProductConfig repository capabilities.
 */
export function listRepositoryWikiPages(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  filter: { entityRefs?: EntityRef[]; repositoryIds?: string[] } = {}
): RepositoryWikiPage[] {
  const requestedRepositories = filter.repositoryIds ? new Set(filter.repositoryIds) : undefined;
  const requestedEntities = filter.entityRefs?.length ? uniqueRefs(filter.entityRefs) : undefined;
  const allowedRepositories = requestedEntities
    ? repositoryEntitiesForSubjects(db, requestedEntities)
    : undefined;
  const pages: RepositoryWikiPage[] = [];
  for (const repository of db.listEntities("repository")) {
    if (!repository.repoPath) continue;
    if (requestedRepositories && !requestedRepositories.has(repository.id)) continue;
    if (allowedRepositories && !allowedRepositories.has(repository.id)) continue;
    const repositoryRoot = path.resolve(repository.repoPath);
    const wikiRoot = path.resolve(repositoryRoot, repository.wikiRoot || "docs/wiki");
    if (!isPathInside(wikiRoot, repositoryRoot)) continue;
    const entityRefs = repositoryOwnerRefs(db, repository.id);
    for (const absolute of collectMarkdown(wikiRoot)) {
      const stat = fs.statSync(absolute);
      pages.push({
        repositoryId: repository.id,
        entityRefs,
        relativePath: path.relative(wikiRoot, absolute).split(path.sep).join("/"),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
    }
  }
  return pages;
}

/** Append one line to the wiki log (Karpathy-style parseable history). */
export function appendWikiLog(config: WorkMemoryConfig, action: string, summary: string): void {
  const root = globalWikiRoot(config);
  fs.mkdirSync(root, { recursive: true });
  const line = `## [${nowIso()}] ${action} | ${summary.replace(/\s+/g, " ").trim()}\n`;
  fs.appendFileSync(path.join(root, "log.md"), line, "utf8");
}

/** Create the global wiki scaffold (conventions + index + log) if missing. Idempotent. */
export function ensureWikiScaffold(config: WorkMemoryConfig): void {
  const root = globalWikiRoot(config);
  fs.mkdirSync(root, { recursive: true });
  // AGENTS.md is the managed schema contract for agent-authored pages. Refresh it
  // on upgrade so an old workspace cannot keep teaching the legacy layout.
  writeManagedFile(path.join(root, "AGENTS.md"), conventionsDoc(config));
  writeIfMissing(path.join(root, "index.md"), "# OneAgent wiki\n\nAgent-curated knowledge base. Pages are optional syntheses attached to graph entities.\n\n## Published knowledge\n\n- _none yet_\n");
  writeIfMissing(path.join(root, "log.md"), "# Curation log\n\nAppend-only history of ingestion and curation events.\n");
}

/**
 * Compatibility entrypoint. Private memory can only leave through a complete,
 * explicitly configured private export, never through entity/repository links.
 */
export function syncEntityWikiToRepo(_config: WorkMemoryConfig, _db: WorkMemoryDatabase, _kind: string, _id: string): never {
  throw new Error("Private wiki synchronization is blocked: product repositories are reference sources. Use oneagent memory export-private to prepare a structured private archive. Git publication is not available yet. Use memory destinations to inspect the reserved private destination, or memory backup for local recovery.");
}

/** @deprecated Entity bindings no longer select private wiki destinations. */
export function repoWikiTargets(_config: WorkMemoryConfig, _db: WorkMemoryDatabase, _kind: string, _id: string): string[] {
  return [];
}

/** Resolve repository entities using only graph identity and structure. */
export function repositoryEntitiesForSubjects(db: WorkMemoryDatabase, subjects: EntityRef[]): Set<string> {
  const requested = uniqueRefs(subjects);
  const requestedKeys = new Set(requested.map((ref) => `${ref.kind}:${ref.id}`));
  const requestedIds = new Set(requested.map((ref) => ref.id));
  const repositories = db.listEntities("repository");
  const ids = new Set<string>();

  for (const ref of requested) {
    if (ref.kind === "repository") ids.add(ref.id);
  }
  for (const repository of repositories) {
    if (repository.parentId && requestedIds.has(repository.parentId)) ids.add(repository.id);
  }
  for (const relation of db.listEntityRelationsForEntities(requested)) {
    const sourceKey = `${relation.sourceKind}:${relation.sourceId}`;
    const targetKey = `${relation.targetKind}:${relation.targetId}`;
    if (relation.sourceKind === "repository" && requestedKeys.has(targetKey)) ids.add(relation.sourceId);
    if (relation.targetKind === "repository" && requestedKeys.has(sourceKey)) ids.add(relation.targetId);
  }
  return ids;
}

function repositoryOwnerRefs(db: WorkMemoryDatabase, repositoryId: string): EntityRef[] {
  const repository = db.getEntity("repository", repositoryId);
  const refs: EntityRef[] = [{ kind: "repository", id: repositoryId }];
  if (repository?.parentId) {
    const parent = db.listEntities().find((entity) => entity.id === repository.parentId && entity.kind !== "repository");
    if (parent) refs.push({ kind: parent.kind, id: parent.id });
  }
  for (const relation of db.listEntityRelations({ kind: "repository", id: repositoryId })) {
    if (relation.sourceKind === "repository" && relation.sourceId === repositoryId) {
      refs.push({ kind: relation.targetKind, id: relation.targetId });
    } else if (relation.targetKind === "repository" && relation.targetId === repositoryId) {
      refs.push({ kind: relation.sourceKind, id: relation.sourceId });
    }
  }
  return uniqueRefs(refs);
}

function uniqueRefs(refs: EntityRef[]): EntityRef[] {
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
}

function collectMarkdown(root: string): string[] {
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

function findEntityWikiDirByMetadata(config: WorkMemoryConfig, subject: EntityRef): string | undefined {
  const root = globalWikiRoot(config);
  for (const absolute of collectMarkdown(root)) {
    const metadata = parseWikiMetadata(fs.readFileSync(absolute, "utf8"));
    if (!metadata?.subject || !metadata.home) continue;
    if (metadata.subject.kind !== subject.kind || metadata.subject.id !== subject.id) continue;
    try {
      const relativeDir = canonicalEntityWikiRelativeDir(subject, metadata.home);
      const expectedDir = path.join(root, ...relativeDir.split("/"));
      if (absolute === expectedDir || isPathInside(absolute, expectedDir)) return expectedDir;
    } catch {
      // Invalid metadata is reported by wiki lint; keep looking for a valid page.
    }
  }
  return undefined;
}

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function writeManagedFile(filePath: string, content: string): void {
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content) {
    atomicWriteFile(filePath, content);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function conventionsDoc(_config: WorkMemoryConfig): string {
  return `# OneAgent wiki — curation conventions

This wiki is **owned and written exclusively by the OneAgent Copilot agent**. Humans and BMAD
read it but never edit it. The raw captures under \`.work-memory/captures\` are the source of
truth; this wiki is the agent's compiled, deduplicated synthesis.

## Layers

1. Raw sources — \`.work-memory/captures/*.md\` (immutable).
2. This wiki — agent-curated Markdown, organised by business context.
3. Schema — this file.

## Structure

\`\`\`
wiki/
  index.md
  products/<product-id>/
    index.md
    discoveries/<discovery-id>/index.md
    features/<feature-id>/index.md
    feature-requests/<request-id>/index.md
    insights/<insight-id>/index.md
    projects/<project-id>/index.md
    decisions/<slug>.md
    risks/<slug>.md
    questions/<slug>.md
  projects/<project-id>/index.md       # cross-product projects only
  domains/<domain-id>/index.md
  people/<person-id>/index.md
  practices/<practice-id>/index.md
  log.md
\`\`\`

Every semantic page carries controlled frontmatter. The runtime computes the path; never invent
or hand-build another layout.

\`\`\`yaml
---
oneagent:
  subject: feature:oneff-janitor
  home: product:oneff
  related:
    - project:return-modernization
---
\`\`\`

Discoveries, features, feature requests and insights require one product home. Product-specific projects live
under that product; cross-product projects live under \`projects/\`. Use projects, not initiatives.
Decisions, risks and questions are content of the entity they concern, never standalone entities.
Interviews and other research material remain immutable captures attached to a discovery; insights
are autonomous entities related with typed graph relations and are never owned exclusively by one discovery.

This wiki is private professional memory. Linked repositories are reference sources, including
BMAD documents read in place. Accepting a page never copies it into a product repository.
A shared BMAD contribution requires an explicit request identifying the target repository and
reviewable content. Private Git synchronization will use a separately configured private backup
and a complete export; \`oneagent wiki sync\` is blocked during this transition.

## Workflows

- **Ingest**: read the new capture, decide its primary + related entities, then update each
  concerned entity through the structured wiki tool — create/merge insights, decisions, risks,
  questions; refresh the entity \`index.md\`; append a \`log.md\` entry; upsert entities and typed
  relations in OneAgent.
- **Query**: search the wiki, synthesize an answer with citations to capture ids; optionally file
  the synthesis back as a new page.
- **Lint**: periodically check for contradictions, stale claims, orphan pages and missing links.

## Rules

- Integrate, do not append blindly: merge new information into existing pages, dedupe, link.
- Never write a semantic page without \`subject\` and \`home\`.
- Never create top-level \`discovery/\`, \`feature/\`, \`feature_request/\`, \`insight/\` or \`initiative/\` folders.
- Never create \`products/<product>/discovery/\`; unbound interviews and research notes are captures, not Wiki entity pages.
- If a OneAgent tool fails, stop and report the error. Never fall back to direct SQLite writes, shell database access,
  or manual Markdown moves. Retrying through the structured runtime is the only supported mutation path.
- Keep entity wikis self-contained so BMAD context stays small.
- Cite capture ids (\`cap_...\`) for traceability.
`;
}
