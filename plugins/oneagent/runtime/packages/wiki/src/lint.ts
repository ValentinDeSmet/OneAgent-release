import fs from "node:fs";
import path from "node:path";
import { ENTITY_KINDS } from "../../shared/src/index.ts";
import type { EntityRef, WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import {
  canonicalEntityWikiRelativeDir,
  parseWikiMetadata,
  resolveWikiHome
} from "./layout.ts";
import { globalWikiRoot, listEntityWikiPages } from "./wiki-store.ts";

export interface WikiLintFinding {
  rule:
    | "orphan_page"
    | "stale_page"
    | "broken_reference"
    | "legacy_layout"
    | "duplicate_subject"
    | "missing_metadata"
    | "invalid_placement"
    | "invalid_home";
  entity?: string;
  path?: string;
  message: string;
}

export interface WikiLintReport {
  findings: WikiLintFinding[];
  pagesScanned: number;
  entitiesChecked: number;
}

const ENTITY_REF_PATTERN = new RegExp(`\\b(${ENTITY_KINDS.join("|")}):([a-z0-9][a-z0-9-]*)\\b`, "g");
const INFRASTRUCTURE_PAGES = new Set(["AGENTS.md", "index.md", "log.md"]);

/** Deterministic hygiene for the canonical product-centred wiki layout. */
export function lintWiki(config: WorkMemoryConfig, db: WorkMemoryDatabase): WikiLintReport {
  const findings: WikiLintFinding[] = [];
  const root = globalWikiRoot(config);
  const entities = db.listEntities();
  const entityRefs = new Set(entities.map((entity) => `${entity.kind}:${entity.id}`));
  for (const product of config.products ?? []) entityRefs.add(`product:${product.id}`);

  // Legacy directories are migration candidates. Keep the old orphan diagnostic as
  // well so deleted/merged entities are not hidden behind a layout warning.
  for (const kind of ENTITY_KINDS) {
    const kindDir = path.join(root, kind);
    if (!fs.existsSync(kindDir)) continue;
    for (const entry of fs.readdirSync(kindDir, { withFileTypes: true })) {
      const legacyId = entry.isDirectory()
        ? entry.name
        : (entry.isFile() && /\.(md|markdown)$/i.test(entry.name) ? entry.name.replace(/\.(md|markdown)$/i, "") : undefined);
      if (!legacyId) continue;
      const ref = `${kind}:${legacyId}`;
      const legacyPath = path.posix.join(kind, entry.name);
      if (!entityRefs.has(ref)) {
        findings.push({
          rule: "orphan_page",
          entity: ref,
          path: legacyPath,
          message: `Legacy wiki content '${legacyPath}' has no matching entity (deleted or merged?).`
        });
      } else {
        findings.push({
          rule: "legacy_layout",
          entity: ref,
          path: legacyPath,
          message: `${ref} still uses the legacy '${legacyPath}' layout.`
        });
      }
    }
  }

  // An intermediate layout stored raw research under
  // products/<product>/discovery/. These pages cannot be pluralized blindly:
  // unbound notes must become captures, while explicitly bound discovery pages
  // can be moved by the layout migration.
  const productsRoot = path.join(root, "products");
  if (fs.existsSync(productsRoot)) {
    for (const product of fs.readdirSync(productsRoot, { withFileTypes: true })) {
      if (!product.isDirectory()) continue;
      const legacyRoot = path.join(productsRoot, product.name, "discovery");
      if (!fs.existsSync(legacyRoot) || !fs.statSync(legacyRoot).isDirectory()) continue;
      for (const absolute of collectMarkdown(legacyRoot)) {
        const legacyPath = path.relative(root, absolute).split(path.sep).join("/");
        const metadata = parseWikiMetadata(fs.readFileSync(absolute, "utf8"));
        findings.push({
          rule: "legacy_layout",
          entity: metadata?.subject ? ref(metadata.subject) : undefined,
          path: legacyPath,
          message: `${legacyPath} uses the legacy product discovery research layout; bind it to a discovery entity or re-ingest it as a capture.`
        });
      }
    }
  }

  // Existing pages may be stale. Missing pages are valid: wiki content is an
  // optional synthesis attached to an entity, not a mandatory graph mirror.
  for (const entity of entities) {
    if (entity.kind === "oneagent") continue;
    const references = db.countCaptureReferences(entity.kind, entity.id);
    if (references === 0) continue;
    const pages = listEntityWikiPages(config, entity.kind, entity.id, db);
    if (pages.length === 0) continue;
    const newestPageMtime = Math.max(...pages.map((page) => Date.parse(page.updatedAt)));
    const newestCuration = db
      .listCapturesForEntity(entity.kind, entity.id)
      .map((capture) => (capture.curationStatus === "curated" && capture.curatedAt ? Date.parse(capture.curatedAt) : 0))
      .reduce((left, right) => Math.max(left, right), 0);
    if (newestCuration > newestPageMtime + 60_000) {
      findings.push({
        rule: "stale_page",
        entity: `${entity.kind}:${entity.id}`,
        message: `${entity.kind}:${entity.id} had a capture curated after its wiki was last written — the pages may miss recent knowledge.`
      });
    }
  }

  let pagesScanned = 0;
  const subjectPages = new Map<string, { canonicalDir: string; paths: string[] }>();
  for (const absolute of collectMarkdown(root)) {
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    pagesScanned += 1;
    const content = fs.readFileSync(absolute, "utf8");

    if (!INFRASTRUCTURE_PAGES.has(relative)) {
      validatePagePlacement(config, db, relative, content, entityRefs, findings);
      const metadata = parseWikiMetadata(content);
      if (metadata?.subject && metadata.home) {
        try {
          const subjectRef = ref(metadata.subject);
          const current = subjectPages.get(subjectRef) ?? {
            canonicalDir: canonicalEntityWikiRelativeDir(metadata.subject, metadata.home),
            paths: []
          };
          current.paths.push(relative);
          subjectPages.set(subjectRef, current);
        } catch {
          // Invalid homes are already reported by validatePagePlacement.
        }
      }
    }

    const seen = new Set<string>();
    for (const match of content.matchAll(ENTITY_REF_PATTERN)) {
      const ref = `${match[1]}:${match[2]}`;
      if (seen.has(ref) || entityRefs.has(ref) || ref === "oneagent:oneagent") continue;
      seen.add(ref);
      findings.push({
        rule: "broken_reference",
        entity: ref,
        path: relative,
        message: `${relative} references ${ref}, which does not exist (typo, or entity merged/renamed?).`
      });
    }
  }

  for (const [entity, pages] of subjectPages) {
    const outsideCanonical = pages.paths.filter((page) =>
      page !== `${pages.canonicalDir}/index.md` && !page.startsWith(`${pages.canonicalDir}/`)
    );
    if (pages.paths.length > 1 && outsideCanonical.length > 0) {
      findings.push({
        rule: "duplicate_subject",
        entity,
        path: pages.paths.sort().join(", "),
        message: `${entity} is declared by canonical and/or legacy pages in several locations: ${pages.paths.sort().join(", ")}.`
      });
    }
  }

  return { findings: dedupeFindings(findings), pagesScanned, entitiesChecked: entities.length };
}

function validatePagePlacement(
  config: WorkMemoryConfig,
  db: WorkMemoryDatabase,
  relative: string,
  content: string,
  entityRefs: Set<string>,
  findings: WikiLintFinding[]
): void {
  const metadata = parseWikiMetadata(content);
  if (!metadata?.subject || !metadata.home) {
    findings.push({
      rule: "missing_metadata",
      path: relative,
      message: `${relative} must declare oneagent.subject and oneagent.home.`
    });
    return;
  }
  const subject = metadata.subject;
  const home = metadata.home;
  const subjectRef = ref(subject);
  if (!entityRefs.has(subjectRef)) {
    findings.push({ rule: "orphan_page", entity: subjectRef, path: relative, message: `${relative} belongs to missing ${subjectRef}.` });
    return;
  }
  if (!entityRefs.has(ref(home))) {
    findings.push({ rule: "invalid_home", entity: subjectRef, path: relative, message: `${relative} uses missing home ${ref(home)}.` });
    return;
  }
  if (["discovery", "feature", "feature_request", "insight"].includes(subject.kind) && home.kind !== "product") {
    findings.push({ rule: "invalid_home", entity: subjectRef, path: relative, message: `${subjectRef} requires a product home.` });
    return;
  }
  if (subject.kind === "project" && home.kind !== "product" && ref(subject) !== ref(home)) {
    findings.push({ rule: "invalid_home", entity: subjectRef, path: relative, message: `${subjectRef} must use a product home or its own cross-product space.` });
    return;
  }
  if (!["discovery", "feature", "feature_request", "insight", "product", "project", "initiative"].includes(subject.kind) && ref(subject) !== ref(home)) {
    findings.push({ rule: "invalid_home", entity: subjectRef, path: relative, message: `${subjectRef} must own its cross-cutting wiki space.` });
    return;
  }
  if (subject.kind === "initiative") {
    findings.push({ rule: "invalid_home", entity: subjectRef, path: relative, message: `${subjectRef} must be converted or attached to a project; initiatives are not part of the canonical wiki.` });
    return;
  }
  let expectedDir: string;
  try {
    expectedDir = canonicalEntityWikiRelativeDir(subject, home);
  } catch (error) {
    findings.push({ rule: "invalid_home", entity: subjectRef, path: relative, message: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (relative !== `${expectedDir}/index.md` && !relative.startsWith(`${expectedDir}/`)) {
    findings.push({
      rule: "invalid_placement",
      entity: subjectRef,
      path: relative,
      message: `${relative} declares ${subjectRef} at ${ref(home)} but must live under ${expectedDir}/.`
    });
  }

  const resolved = resolveWikiHome(config, db, subject);
  if (resolved.status === "resolved" && resolved.home && ref(resolved.home) !== ref(home)) {
    findings.push({
      rule: "invalid_home",
      entity: subjectRef,
      path: relative,
      message: `${relative} declares ${ref(home)}, while structural relations resolve ${ref(resolved.home)}.`
    });
  }
}

function ref(value: EntityRef): string {
  return `${value.kind}:${value.id}`;
}

function collectMarkdown(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdown(absolute));
    else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
}

function dedupeFindings(findings: WikiLintFinding[]): WikiLintFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.rule}|${finding.entity ?? ""}|${finding.path ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
