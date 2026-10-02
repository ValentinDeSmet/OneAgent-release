import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, sha256, type EntityRecord, type EntityRef, type WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { indexSourceFile } from "../../source-intake/src/index.ts";
import { parseWikiMetadata, resolveWikiHome, withWikiMetadata } from "./layout.ts";
import { entityWikiDir, globalWikiRoot, legacyEntityWikiDir, listWikiPages } from "./wiki-store.ts";

const ENTITY_FIELDS = [
  "label", "description", "aliases", "status", "parentId", "ownerIds",
  "contributorIds", "tags", "focusLevel", "metadata", "repoPath", "wikiRoot"
] as const;

type EntityPageFields = Pick<EntityRecord, typeof ENTITY_FIELDS[number]>;

/** Entity identity and descriptive fields are readable Markdown frontmatter. */
export function readEntityPageFields(markdown: string): Partial<EntityPageFields> | undefined {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  const start = lines.findIndex((line, index) => index > 0 && index < end && line === "oneagent_entity:");
  if (end < 0 || start < 0) return undefined;
  const fields: Record<string, unknown> = {};
  for (const line of lines.slice(start + 1, end)) {
    if (line && !/^\s/.test(line)) break;
    const match = line.match(/^  ([a-zA-Z]+): (.+)$/);
    if (!match || !ENTITY_FIELDS.includes(match[1] as typeof ENTITY_FIELDS[number])) continue;
    try { fields[match[1]] = JSON.parse(match[2]); } catch { /* invalid metadata is reported by migration */ }
  }
  return fields as Partial<EntityPageFields>;
}

export function withEntityPageFields(markdown: string, entity: EntityRecord): string {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const block = ["oneagent_entity:", ...ENTITY_FIELDS.flatMap((field) =>
    entity[field] === undefined ? [] : [`  ${field}: ${JSON.stringify(entity[field])}`]
  )];
  if (lines[0]?.trim() !== "---") return ["---", ...block, "---", "", ...lines].join("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return ["---", ...block, "---", "", ...lines].join("\n");
  const kept: string[] = [];
  for (let index = 1; index < end; index += 1) {
    if (lines[index] !== "oneagent_entity:") {
      kept.push(lines[index]);
      continue;
    }
    while (index + 1 < end && (lines[index + 1].trim() === "" || /^\s/.test(lines[index + 1]))) index += 1;
  }
  return ["---", ...kept, ...block, "---", ...lines.slice(end + 1)].join("\n");
}

export function entityPagePath(config: WorkMemoryConfig, db: WorkMemoryDatabase, ref: EntityRef): string {
  const resolved = resolveWikiHome(config, db, ref);
  const canonical = path.join(entityWikiDir(config, ref.kind, ref.id, db), "index.md");
  const legacy = path.join(legacyEntityWikiDir(config, ref.kind, ref.id), "index.md");
  const unplaced = path.join(globalWikiRoot(config), "unplaced", safeSegment(ref.kind), safeSegment(ref.id), "index.md");
  if (resolved.status === "resolved" && resolved.home) return canonical;
  if (fs.existsSync(legacy)) return legacy;
  return unplaced;
}

/**
 * Persist an entity page and its lexical source in the caller's DB transaction.
 * The returned compensation restores the exact file bytes if that transaction rolls back.
 */
export function persistEntityPage(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  entity: EntityRecord,
  content?: string
): { path: string; undo: () => void; changed: boolean } {
  const ref = { kind: entity.kind, id: entity.id };
  const filePath = entityPagePath(config, db, ref);
  const previousPath = findExistingEntityPage(config, ref, filePath);
  const previous = previousPath ? fs.readFileSync(previousPath, "utf8") : undefined;
  const homeResolution = resolveWikiHome(config, db, ref);
  const home = homeResolution.status === "resolved" && homeResolution.home ? homeResolution.home : ref;
  const initialBody = `# ${entity.label}\n\n${entity.description ?? ""}`.trimEnd() + "\n";
  const base = content === undefined ? previous ?? initialBody : content;
  const existingRelated = previous ? parseWikiMetadata(previous)?.related ?? [] : [];
  const next = withEntityPageFields(withWikiMetadata(base, { subject: ref, home, related: existingRelated }), entity);
  const normalized = next.endsWith("\n") ? next : `${next}\n`;
  const changed = normalized !== previous || previousPath !== filePath;
  const indexed = db.db.prepare("SELECT id FROM sources WHERE raw_path = ? AND content_hash = ? AND status = 'indexed' LIMIT 1")
    .get(filePath, sha256(normalized));
  const undo = (): void => {
    if (previousPath !== filePath && fs.existsSync(filePath)) fs.rmSync(filePath);
    if (previous === undefined) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    } else if (previousPath) atomicWriteFile(previousPath, previous);
  };
  try {
    if (changed) atomicWriteFile(filePath, normalized);
    if (changed || !indexed) {
      const ingested = indexSourceFile({ config, db }, { filePath, entityRefs: [ref], sourceType: "wiki_page", createInbox: false });
      if (previousPath && previousPath !== filePath) {
        db.db.prepare("UPDATE sources SET status = 'superseded', superseded_by = ? WHERE raw_path = ? AND status = 'indexed'")
          .run(ingested.source.id, previousPath);
      }
    }
    if (previousPath && previousPath !== filePath) fs.rmSync(previousPath);
  } catch (error) {
    undo();
    throw error;
  }
  return { path: filePath, undo, changed };
}

export function listEntityPages(config: WorkMemoryConfig, db: WorkMemoryDatabase): Array<{ entity: EntityRecord; path: string; exists: boolean }> {
  return db.listEntities().map((entity) => {
    const filePath = entityPagePath(config, db, { kind: entity.kind, id: entity.id });
    return { entity, path: path.relative(globalWikiRoot(config), filePath), exists: fs.existsSync(filePath) };
  });
}

/** Pull direct Markdown edits into the SQLite graph and lexical search index. */
export function syncEntityPages(config: WorkMemoryConfig, db: WorkMemoryDatabase): number {
  let synced = 0;
  for (const entity of db.listEntities()) {
    const filePath = entityPagePath(config, db, entity);
    const existingPath = findExistingEntityPage(config, entity, filePath);
    if (!existingPath) continue;
    const markdown = fs.readFileSync(existingPath, "utf8");
    const metadata = parseWikiMetadata(markdown);
    if (metadata?.subject && (metadata.subject.kind !== entity.kind || metadata.subject.id !== entity.id)) {
      throw new Error(`Entity page has a different subject: ${filePath}`);
    }
    const fields = readEntityPageFields(markdown);
    const changedFields = fields && ENTITY_FIELDS.some((field) =>
      Object.hasOwn(fields, field) && JSON.stringify(fields[field]) !== JSON.stringify(entity[field])
    );
    const indexed = db.db.prepare("SELECT id FROM sources WHERE raw_path = ? AND content_hash = ? AND status = 'indexed' LIMIT 1")
      .get(filePath, sha256(markdown));
    if (!changedFields && indexed && existingPath === filePath) continue;
    db.runInTransaction(() => {
      if (changedFields && fields) {
        db.upsertEntity({ id: entity.id, kind: entity.kind, ...fields });
      } else {
        const page = persistEntityPage(config, db, entity, markdown);
        db.onRollback(page.undo);
      }
    });
    synced += 1;
  }
  return synced;
}

function findExistingEntityPage(config: WorkMemoryConfig, ref: EntityRef, target: string): string | undefined {
  if (fs.existsSync(target)) return target;
  const alternatives = [
    path.join(legacyEntityWikiDir(config, ref.kind, ref.id), "index.md"),
    path.join(globalWikiRoot(config), "unplaced", safeSegment(ref.kind), safeSegment(ref.id), "index.md")
  ];
  for (const candidate of alternatives) if (fs.existsSync(candidate)) return candidate;
  return listWikiPages(config).find((page) => {
    const subject = parseWikiMetadata(fs.readFileSync(page.absolutePath, "utf8"))?.subject;
    return subject?.kind === ref.kind && subject.id === ref.id;
  })?.absolutePath;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
