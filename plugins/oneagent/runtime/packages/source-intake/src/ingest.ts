import fs from "node:fs";
import path from "node:path";
import type { GraphProvider } from "../../graph/src/index.ts";
import { atomicWriteFile, createStableId, nowIso, sha256 } from "../../shared/src/index.ts";
import type {
  CaptureRecord,
  CaptureUpdate,
  EntityRef,
  IngestResult,
  SourceRecord,
  SourceType,
  WorkMemoryConfig
} from "../../shared/src/index.ts";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { chunkText } from "./chunk.ts";
import { parseCaptureFile, serializeCaptureFile } from "./capture-file.ts";
import { invalidateCaptureClassificationCuration, markStaleSourceRevisions } from "./observations.ts";

export interface IngestServices {
  config: WorkMemoryConfig;
  db: WorkMemoryDatabase;
  graphProvider?: GraphProvider;
  /**
   * Optional filesystem adapter for capture edits. Production uses
   * `atomicWriteFile`; tests and alternate runtimes may provide an equivalent.
   */
  captureFileWriter?: (filePath: string, content: string) => void;
}

export interface IngestSourceInput {
  filePath: string;
  entityRefs: EntityRef[];
  sourceType?: SourceType;
  createInbox?: boolean;
}

interface IngestTextInput {
  content: string;
  sourceId: string;
  title: string;
  sourceType: SourceType;
  entityRefs: EntityRef[];
  createInbox: boolean;
  originUri?: string;
  rawPath?: string;
  logicalKey: string;
}

export async function ingestSource(services: IngestServices, input: IngestSourceInput): Promise<IngestResult> {
  return indexSourceFile(services, input);
}

/** Synchronous text indexing for entity writes that share a SQLite transaction. */
export function indexSourceFile(services: IngestServices, input: IngestSourceInput): IngestResult {
  if (input.entityRefs.length === 0) {
    throw new Error("Ingestion requires at least one typed entity reference.");
  }
  const absolutePath = path.resolve(input.filePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const contentHash = sha256(content);
  return ingestText(services, {
    content,
    sourceId: createStableId("src", [absolutePath, contentHash]),
    title: extractTitle(content, absolutePath),
    sourceType: input.sourceType ?? inferSourceType(absolutePath),
    entityRefs: uniqueEntityRefs(input.entityRefs),
    createInbox: input.createInbox ?? true,
    originUri: absolutePath,
    rawPath: absolutePath,
    logicalKey: absolutePath
  });
}

function ingestText(services: IngestServices, input: IngestTextInput): IngestResult {
  const source: SourceRecord = {
    id: input.sourceId,
    logicalKey: input.logicalKey,
    title: input.title,
    sourceType: input.sourceType,
    origin: "file",
    originUri: input.originUri,
    rawPath: input.rawPath,
    contentHash: sha256(input.content),
    capturedAt: nowIso(),
    language: "markdown",
    status: "indexing"
  };

  const chunks = chunkText(source.id, input.content);

  services.db.insertSource(source, input.entityRefs);
  try {
    services.db.insertChunks(source, chunks);

    // Publishing a new source revision and invalidating its prior curation are
    // one atomic state change: proposals are retired and accepted observations
    // remain auditable but are flagged as stale for human re-extraction.
    services.db.runInTransaction(() => {
      services.db.activateSourceRevision(source.id);
      markStaleSourceRevisions(services.db);
    });
  } catch (error) {
    services.db.markSourceRevisionFailed(source.id);
    throw error;
  }
  source.status = "indexed";
  // The agent curates observations from captures; accepted observations may later
  // inform entities, relations, context packs or an optional wiki page. Ingestion
  // only keeps the lossless source and searchable chunks and clears legacy regex memory.
  services.db.deleteStructuredMemoryForSource(source.id);

  return {
    source,
    chunks,
    insights: [],
    inboxItemIds: []
  };
}

export interface ReingestCaptureResult {
  captureId: string;
  status: "indexed" | "failed" | "skipped";
  sourceId?: string;
  entityRefs: EntityRef[];
  chunks: number;
  error?: string;
}

export interface ReingestCaptureOptions {
  force?: boolean;
}

export interface EditCaptureInput extends CaptureUpdate {
  /** Replacement Markdown body. Omit it to preserve the current body. */
  content?: string;
}

export interface EditCaptureResult {
  capture: CaptureRecord;
  content: string;
  reingest: ReingestCaptureResult;
}

/**
 * Edit a capture through its Markdown source of truth and synchronously refresh
 * its searchable source projection. Metadata-only edits force reingestion too:
 * the source title and entity links must not retain the previous classification.
 */
export async function editCapture(
  services: IngestServices,
  captureId: string,
  input: EditCaptureInput
): Promise<EditCaptureResult> {
  const current = services.db.getCapture(captureId);
  if (!current) {
    throw new Error(`Capture not found: ${captureId}`);
  }
  if (!current.path) {
    throw new Error(`Capture ${captureId} has no Markdown file to edit.`);
  }
  if (!fs.existsSync(current.path)) {
    throw new Error(`Capture file is missing: ${current.path}`);
  }
  const originalMarkdown = fs.readFileSync(current.path, "utf8");
  const existing = parseCaptureFile(originalMarkdown);
  const content = input.content === undefined ? existing.body : input.content;
  if (!content.trim()) {
    throw new Error("Capture content cannot be empty.");
  }

  const classificationChanged = (
    input.contentType !== undefined && input.contentType !== current.contentType
  ) || (
    input.primaryEntity !== undefined
    && (
      input.primaryEntity.kind !== current.primaryEntityKind
      || input.primaryEntity.id !== current.primaryEntityId
    )
  );

  let updated: CaptureRecord;
  try {
    updated = services.db.runInTransaction(() => {
      let next = services.db.updateCapture(captureId, {
        title: input.title,
        contentType: input.contentType,
        primaryEntity: input.primaryEntity,
        tags: input.tags
      });
      if (classificationChanged) {
        invalidateCaptureClassificationCuration(services.db, current, next);
        next = services.db.updateCaptureCuration(captureId, { curationStatus: "pending" });
        // The prior source projection still represents the old classification.
        // Persisting `stale` also makes an indexing retry publish a new revision.
        next = services.db.updateCaptureIngestion(captureId, {
          ingestionStatus: "stale",
          error: null
        });
      }
      const markdown = serializeCaptureFile(
        next,
        content,
        (kind, entityId) => services.db.getEntity(kind, entityId)?.label
      );
      (services.captureFileWriter ?? atomicWriteFile)(current.path!, markdown);
      return next;
    });
  } catch (error) {
    // The database transaction has already rolled back. A custom writer (or a
    // rare post-write filesystem error) may nevertheless have changed the file,
    // so compensate it back to the exact source-of-truth bytes we started with.
    try {
      if (!fs.existsSync(current.path) || fs.readFileSync(current.path, "utf8") !== originalMarkdown) {
        atomicWriteFile(current.path, originalMarkdown);
      }
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Capture edit failed and its Markdown file could not be restored: ${current.path}`
      );
    }
    throw error;
  }

  const reingest = await reingestCapture(services, captureId, {
    force: true,
  });
  return {
    capture: services.db.getCapture(captureId) ?? updated,
    content,
    reingest
  };
}

/**
 * Reingest a capture from its Markdown source-of-truth file. The capture file is
 * always preserved: on failure the capture is marked `failed` and the file is left intact.
 * When the body hash already matches an indexed capture, reingestion is skipped unless `force`.
 */
export async function reingestCapture(
  services: IngestServices,
  captureId: string,
  options: ReingestCaptureOptions = {}
): Promise<ReingestCaptureResult> {
  const capture = services.db.getCapture(captureId);
  if (!capture) {
    throw new Error(`Capture not found: ${captureId}`);
  }
  if (!capture.path) {
    throw new Error(`Capture ${captureId} has no Markdown file to ingest.`);
  }
  if (!fs.existsSync(capture.path)) {
    services.db.updateCaptureIngestion(captureId, {
      ingestionStatus: "failed",
      error: `Capture file is missing: ${capture.path}`
    });
    appendIngestLog(services, { captureId, status: "failed", error: "missing file" });
    throw new Error(`Capture file is missing: ${capture.path}`);
  }

  const raw = fs.readFileSync(capture.path, "utf8");
  const { body } = parseCaptureFile(raw);
  const entityRefs = captureEntityRefs(capture);
  const bodyHash = sha256(body);
  const contentHash = `sha256:${bodyHash}`;

  if (!options.force && capture.ingestionStatus === "indexed" && capture.sourceId && capture.contentHash === contentHash) {
    appendIngestLog(services, { captureId, status: "skipped", sourceId: capture.sourceId });
    return { captureId, status: "skipped", sourceId: capture.sourceId, entityRefs, chunks: 0 };
  }

  services.db.updateCaptureIngestion(captureId, { ingestionStatus: "indexing" });

  try {
    const result = await ingestText(services, {
      content: body,
      sourceId: captureSourceRevisionId(capture, bodyHash, contentHash),
      title: capture.title,
      sourceType: "markdown",
      entityRefs,
      createInbox: false,
      logicalKey: capture.path,
    });

    let updated = services.db.updateCaptureIngestion(captureId, {
      ingestionStatus: "indexed",
      lastIngestedAt: nowIso(),
      contentHash,
      sourceId: result.source.id,
      error: null
    });
    // A changed body reopens proposal extraction. Existing accepted observations
    // remain auditable but are stale; the new revision needs fresh exact excerpts.
    if (capture.contentHash !== contentHash && updated.curationStatus === "curated") {
      updated = services.db.updateCaptureCuration(captureId, { curationStatus: "pending" });
    }
    rewriteCaptureFile(services, updated);
    appendIngestLog(services, { captureId, status: "indexed", sourceId: result.source.id, chunks: result.chunks.length });

    return {
      captureId,
      status: "indexed",
      sourceId: result.source.id,
      entityRefs,
      chunks: result.chunks.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    services.db.updateCaptureIngestion(captureId, { ingestionStatus: "failed", error: message });
    appendIngestLog(services, { captureId, status: "failed", error: message });
    return {
      captureId,
      status: "failed",
      entityRefs,
      chunks: 0,
      error: message
    };
  }
}

/**
 * Reuse the current immutable projection only when it is known to match both
 * the body and capture classification. Stale/failed projections and changed
 * bodies branch from the current source id, which makes retries idempotent
 * without ever reactivating an older historical revision.
 */
function captureSourceRevisionId(
  capture: CaptureRecord,
  bodyHash: string,
  contentHash: string
): string {
  if (
    capture.sourceId
    && capture.ingestionStatus === "indexed"
    && capture.contentHash === contentHash
  ) {
    return capture.sourceId;
  }
  if (capture.sourceId) {
    return createStableId("src", [capture.path ?? capture.id, bodyHash, "after", capture.sourceId]);
  }
  return createStableId("src", [capture.path ?? capture.id, bodyHash]);
}

/** Append one JSONL line per reingest attempt for operational debugging. */
function appendIngestLog(services: IngestServices, entry: Record<string, unknown>): void {
  try {
    const memoryRoot = path.resolve(services.config.workspaceRoot, services.config.workspace.memoryRoot);
    const logDir = path.join(memoryRoot, "ingest-log");
    fs.mkdirSync(logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `${day}.jsonl`), JSON.stringify({ at: nowIso(), ...entry }) + "\n", "utf8");
  } catch {
    // Logging must never break ingestion.
  }
}

function captureEntityRefs(capture: NonNullable<ReturnType<WorkMemoryDatabase["getCapture"]>>): EntityRef[] {
  const refs = new Map<string, EntityRef>();
  const add = (kind: EntityRef["kind"], id: string): void => {
    refs.set(`${kind}\u0000${id}`, { kind, id });
  };
  add(capture.primaryEntityKind, capture.primaryEntityId);
  for (const related of capture.relatedEntities) {
    add(related.entityKind, related.entityId);
  }
  return [...refs.values()];
}

function uniqueEntityRefs(refs: EntityRef[]): EntityRef[] {
  return [...new Map(refs.map((ref) => [`${ref.kind}\u0000${ref.id}`, ref])).values()];
}

/** Rewrite a capture's Markdown file so its frontmatter matches the current DB record. */
export function rewriteCaptureFile(
  services: IngestServices,
  capture: NonNullable<ReturnType<WorkMemoryDatabase["getCapture"]>>
): void {
  if (!capture.path) {
    return;
  }
  const existing = fs.existsSync(capture.path) ? fs.readFileSync(capture.path, "utf8") : "";
  const body = existing ? parseCaptureFile(existing).body : "";
  const markdown = serializeCaptureFile(capture, body, (kind, id) => services.db.getEntity(kind, id)?.label);
  atomicWriteFile(capture.path, markdown);
}


function extractTitle(content: string, filePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() ?? path.basename(filePath);
}

function inferSourceType(filePath: string): SourceType {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  return "plain_text";
}
