import fs from "node:fs";
import path from "node:path";
import { sha256, type EntityRef, type InboxItem, type WorkMemoryConfig } from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { parseWikiMetadata, resolveWikiHome, validateWikiPlacement, withWikiMetadata } from "./layout.ts";
import { globalWikiRoot } from "./wiki-store.ts";
import { withEntityPageFields } from "./entity-page.ts";

export const DOCUMENT_REVIEW_KINDS = ["markdown_document_review", "wiki_write_review"];
type Input = Record<string, unknown>;
function fields(raw: unknown, allowed: string[]): Input {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Objet JSON attendu.");
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`Champ inconnu : ${key}`);
  return raw as Input;
}
function text(value: unknown, name: string, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || value.includes("\0") || value.length > max || !value.trim()) throw new Error(`Champ invalide : ${name}`);
  return value;
}
export function documentEntity(value: unknown): EntityRef {
  const ref = text(value, "entity", 512).trim(), separator = ref.indexOf(":");
  if (separator <= 0 || separator === ref.length - 1) throw new Error("Une entité existante kind:id est requise.");
  return { kind: ref.slice(0, separator), id: ref.slice(separator + 1) };
}
export function isDocumentReview(item: InboxItem): boolean {
  return item.type === "wiki_proposal" && DOCUMENT_REVIEW_KINDS.includes(String(item.payload.proposalKind));
}
/** Bind the reviewed draft, excluding the publication journal maintained by the host. */
export function documentRevision(item: InboxItem): string {
  const { publication: _journal, ...payload } = item.payload;
  return sha256(JSON.stringify([item.id, item.type, item.status, item.title, item.body, payload]));
}
export function withDocumentRevision(item: InboxItem) {
  return isDocumentReview(item) ? { ...item, revision: documentRevision(item) } : item;
}

function safeTarget(config: WorkMemoryConfig, relativePath: string): string {
  const root = globalWikiRoot(config), parts = relativePath.split("/");
  let current = root;
  // A canonical lexical path alone must not follow a symlink into a product repository.
  for (const part of ["", ...parts]) {
    current = part ? path.join(current, part) : current;
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Le document cible ne peut pas traverser un lien symbolique.");
  }
  return current;
}
export function documentTarget(config: WorkMemoryConfig, db: WorkMemoryDatabase, item: InboxItem) {
  if (!isDocumentReview(item)) throw new Error("Cette proposition ne contient pas de document Markdown modifiable.");
  const subject = documentEntity(item.payload.wikiSubject), home = documentEntity(item.payload.wikiHome);
  const page = text(item.payload.wikiPage, "page", 200);
  const relativePath = validateWikiPlacement(config, db, subject, home, page);
  if (item.payload.targetPath !== relativePath) throw new Error("Le rattachement du document a changé. Prépare une nouvelle proposition après lecture de l’entité.");
  const absolutePath = safeTarget(config, relativePath);
  const content = text(item.payload.content, "content", 100000);
  const before = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : undefined;
  const currentHash = before === undefined ? null : sha256(before);
  return { subject, home, page, relativePath, absolutePath, content, before, currentHash };
}

export function proposeDocument(config: WorkMemoryConfig, db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["entity", "home", "page", "title", "content", "summary"]);
  const subject = documentEntity(input.entity);
  const home = input.home === undefined ? resolveWikiHome(config, db, subject).home : documentEntity(input.home);
  if (!home) throw new Error("L’entité doit avoir un emplacement Wiki défini avant de proposer son document.");
  const page = input.page === undefined ? "index.md" : text(input.page, "page", 200).trim();
  const targetPath = validateWikiPlacement(config, db, subject, home, page);
  const target = safeTarget(config, targetPath);
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
  const id = db.insertInboxItem({ type: "wiki_proposal", title: text(input.title, "title", 300).trim(),
    body: text(input.summary, "summary", 2000, true).trim(), status: "pending", payload: {
      proposalKind: "markdown_document_review", entityRef: `${subject.kind}:${subject.id}`,
      wikiSubject: `${subject.kind}:${subject.id}`, wikiHome: `${home.kind}:${home.id}`, wikiPage: page,
      targetPath, content: text(input.content, "content", 100000), baseContentHash: before === undefined ? null : sha256(before)
    } });
  return readDocumentProposal(config, db, id);
}

export function readDocumentProposal(config: WorkMemoryConfig, db: WorkMemoryDatabase, id: string) {
  const item = db.getInboxItem(id);
  if (!item) throw new Error("Proposition de document introuvable.");
  const target = documentTarget(config, db, item);
  const changed = item.status === "pending" && item.payload.proposalKind === "markdown_document_review" && item.payload.baseContentHash !== target.currentHash;
  return { item: withDocumentRevision(item), preview: {
    action: target.before === undefined ? "create" : "replace", targetPath: target.absolutePath, relativePath: target.relativePath,
    content: target.content, beforeContent: target.before?.slice(0, 20000) ?? "", beforeTruncated: (target.before?.length ?? 0) > 20000,
    canAccept: item.status === "pending" && !changed,
    conflicts: changed ? ["Le document cible a changé depuis la proposition. Lis sa nouvelle version et prépare une nouvelle proposition pour conserver les modifications."] : []
  } };
}

export function reviseDocument(config: WorkMemoryConfig, db: WorkMemoryDatabase, raw: unknown) {
  const input = fields(raw, ["itemId", "revision", "content"]);
  const id = text(input.itemId, "itemId", 256), expected = text(input.revision, "revision", 64);
  const content = text(input.content, "content", 100000);
  return db.runInImmediateTransaction(() => {
    const item = db.getInboxItem(id);
    if (!item || !isDocumentReview(item) || item.status !== "pending") throw new Error("Cette proposition de document n’est plus en attente de validation.");
    if (documentRevision(item) !== expected) throw new Error("La proposition a changé. Relis-la avant de réappliquer tes modifications ; ton brouillon est conservé.");
    if ((item.payload.publication as { state?: string } | undefined)?.state === "publishing") throw new Error("La publication est en cours. Termine sa récupération avant de modifier le document.");
    documentTarget(config, db, item);
    db.updateInboxPayload(id, { ...item.payload, content });
    return readDocumentProposal(config, db, id);
  });
}

/** Check both the exact reviewed draft and the file it will replace, before any write. */
export function assertDocumentAcceptance(config: WorkMemoryConfig, db: WorkMemoryDatabase, item: InboxItem, expected?: string) {
  if (!isDocumentReview(item)) return;
  if (item.payload.proposalKind === "markdown_document_review" && !expected) throw new Error("Relis la proposition avant de l’accepter et fournis sa revision.");
  if (expected && documentRevision(item) !== expected) throw new Error("La proposition a changé depuis sa lecture. Relis-la avant de l’accepter.");
  const target = documentTarget(config, db, item);
  if (item.payload.proposalKind !== "markdown_document_review" || item.payload.baseContentHash === target.currentHash) return;
  // Recover a human-approved publication interrupted after its file write.
  const publication = item.payload.publication as { state?: string } | undefined;
  let published = withWikiMetadata(target.content, { subject: target.subject, home: target.home, related: parseWikiMetadata(target.content)?.related ?? [] });
  const entity = db.getEntity(target.subject.kind, target.subject.id);
  if (target.page === "index.md" && entity) published = withEntityPageFields(published, entity);
  if (!published.endsWith("\n")) published += "\n";
  if (publication?.state === "publishing" && target.before === published) return;
  throw new Error("Le document cible a changé depuis la proposition. Prépare une nouvelle proposition ; aucun fichier n’a été remplacé.");
}
