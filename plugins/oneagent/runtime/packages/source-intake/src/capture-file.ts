import type { CaptureEntityRef, CaptureRecord } from "../../shared/src/index.ts";

export interface CaptureEntityFrontmatter {
  kind: string;
  id: string;
  label?: string;
  relation?: string;
}

export interface CaptureFrontmatter {
  id?: string;
  content_type?: string;
  status?: string;
  title?: string;
  primary_entity?: CaptureEntityFrontmatter;
  related_entities?: CaptureEntityFrontmatter[];
  source?: { kind?: string; origin?: string };
  created_at?: string;
  updated_at?: string;
  ingestion?: {
    status?: string;
    last_ingested_at?: string;
    source_id?: string;
    content_hash?: string;
    error?: string;
  };
  curation?: {
    status?: string;
    curated_at?: string;
    summary?: string;
  };
  tags?: string[];
}

export interface ParsedCaptureFile {
  frontmatter: CaptureFrontmatter;
  body: string;
}

export type EntityLabelResolver = (kind: string, id: string) => string | undefined;

/** Serialize a capture record and its Markdown body into a frontmatter document. */
export function serializeCaptureFile(
  capture: CaptureRecord,
  body: string,
  labelFor?: EntityLabelResolver
): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${scalar(capture.id)}`);
  lines.push(`content_type: ${scalar(capture.contentType)}`);
  lines.push(`status: ${scalar(capture.status)}`);
  lines.push(`title: ${scalar(capture.title)}`);

  lines.push("primary_entity:");
  lines.push(...entityBlock(capture.primaryEntityKind, capture.primaryEntityId, undefined, labelFor, 2));

  if (capture.relatedEntities.length > 0) {
    lines.push("related_entities:");
    for (const ref of capture.relatedEntities) {
      lines.push(...entityListItem(ref, labelFor));
    }
  }

  lines.push("source:");
  lines.push(`  kind: ${scalar(capture.sourceKind)}`);
  lines.push(`  origin: ${scalar(capture.sourceOrigin)}`);

  lines.push(`created_at: ${scalar(capture.createdAt)}`);
  lines.push(`updated_at: ${scalar(capture.updatedAt)}`);

  lines.push("ingestion:");
  lines.push(`  status: ${scalar(capture.ingestionStatus)}`);
  if (capture.lastIngestedAt) {
    lines.push(`  last_ingested_at: ${scalar(capture.lastIngestedAt)}`);
  }
  if (capture.sourceId) {
    lines.push(`  source_id: ${scalar(capture.sourceId)}`);
  }
  if (capture.contentHash) {
    lines.push(`  content_hash: ${scalar(capture.contentHash)}`);
  }
  if (capture.error) {
    lines.push(`  error: ${scalar(capture.error)}`);
  }

  lines.push("curation:");
  lines.push(`  status: ${scalar(capture.curationStatus)}`);
  if (capture.curatedAt) {
    lines.push(`  curated_at: ${scalar(capture.curatedAt)}`);
  }
  if (capture.curationSummary) {
    lines.push(`  summary: ${scalar(capture.curationSummary)}`);
  }

  if (capture.tags && capture.tags.length > 0) {
    lines.push("tags:");
    for (const tag of capture.tags) {
      lines.push(`  - ${scalar(tag)}`);
    }
  }

  lines.push("---");
  lines.push("");
  return `${lines.join("\n")}${body}`;
}

/** Split a capture document into its parsed frontmatter and Markdown body. */
export function parseCaptureFile(raw: string): ParsedCaptureFile {
  const normalized = raw.replace(/^﻿/, "");
  if (!normalized.startsWith("---")) {
    return { frontmatter: {}, body: normalized };
  }

  const lines = normalized.split(/\r?\n/);
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatterLines = lines.slice(1, end);
  let body = lines.slice(end + 1).join("\n");
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }
  return { frontmatter: parseFrontmatter(frontmatterLines), body };
}

type FrontmatterSection = "primary_entity" | "source" | "ingestion" | "curation" | "related_entities" | "tags" | "";

function parseFrontmatter(lines: string[]): CaptureFrontmatter {
  const data: CaptureFrontmatter = {};
  let section: FrontmatterSection = "";
  let currentRelated: CaptureEntityFrontmatter | undefined;

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      continue;
    }
    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    if (indent === 0) {
      currentRelated = undefined;
      if (line.endsWith(":")) {
        section = line.slice(0, -1) as FrontmatterSection;
        if (section === "related_entities") {
          data.related_entities = [];
        } else if (section === "tags") {
          data.tags = [];
        } else if (section === "primary_entity") {
          data.primary_entity = { kind: "", id: "" };
        } else if (section === "source") {
          data.source = {};
        } else if (section === "ingestion") {
          data.ingestion = {};
        } else if (section === "curation") {
          data.curation = {};
        }
        continue;
      }
      section = "";
      const { key, value } = splitKeyValue(line);
      assignTopLevel(data, key, value);
      continue;
    }

    if (section === "related_entities") {
      if (line.startsWith("- ")) {
        currentRelated = { kind: "", id: "" };
        data.related_entities?.push(currentRelated);
        const { key, value } = splitKeyValue(line.slice(2));
        assignEntity(currentRelated, key, value);
      } else if (currentRelated) {
        const { key, value } = splitKeyValue(line);
        assignEntity(currentRelated, key, value);
      }
      continue;
    }

    if (section === "tags") {
      if (line.startsWith("- ")) {
        data.tags?.push(unquote(line.slice(2).trim()));
      }
      continue;
    }

    const { key, value } = splitKeyValue(line);
    if (section === "primary_entity") {
      data.primary_entity = data.primary_entity ?? { kind: "", id: "" };
      assignEntity(data.primary_entity, key, value);
    } else if (section === "source") {
      data.source = data.source ?? {};
      if (key === "kind" || key === "origin") {
        data.source[key] = value;
      }
    } else if (section === "ingestion") {
      data.ingestion = data.ingestion ?? {};
      assignIngestion(data.ingestion, key, value);
    } else if (section === "curation") {
      data.curation = data.curation ?? {};
      assignCuration(data.curation, key, value);
    }
  }

  return data;
}

/** Derive capture related-entity refs from parsed frontmatter (relation defaults to related_to). */
export function frontmatterRelatedEntities(frontmatter: CaptureFrontmatter): CaptureEntityRef[] {
  return (frontmatter.related_entities ?? [])
    .filter((entity) => entity.kind && entity.id)
    .map((entity) => ({
      entityKind: entity.kind as CaptureEntityRef["entityKind"],
      entityId: entity.id,
      relationType: entity.relation ?? "related_to"
    }));
}

function entityBlock(
  kind: string,
  id: string,
  relation: string | undefined,
  labelFor: EntityLabelResolver | undefined,
  indent: number
): string[] {
  const pad = " ".repeat(indent);
  const lines = [`${pad}kind: ${scalar(kind)}`, `${pad}id: ${scalar(id)}`];
  const label = labelFor?.(kind, id);
  if (label) {
    lines.push(`${pad}label: ${scalar(label)}`);
  }
  if (relation) {
    lines.push(`${pad}relation: ${scalar(relation)}`);
  }
  return lines;
}

function entityListItem(ref: CaptureEntityRef, labelFor: EntityLabelResolver | undefined): string[] {
  const block = entityBlock(ref.entityKind, ref.entityId, ref.relationType, labelFor, 4);
  // Convert the first line into a list item marker.
  block[0] = `  - ${block[0].trimStart()}`;
  return block;
}

function assignTopLevel(data: CaptureFrontmatter, key: string, value: string): void {
  if (key === "id") data.id = value;
  else if (key === "content_type") data.content_type = value;
  else if (key === "status") data.status = value;
  else if (key === "title") data.title = value;
  else if (key === "created_at") data.created_at = value;
  else if (key === "updated_at") data.updated_at = value;
}

function assignEntity(entity: CaptureEntityFrontmatter, key: string, value: string): void {
  if (key === "kind") entity.kind = value;
  else if (key === "id") entity.id = value;
  else if (key === "label") entity.label = value;
  else if (key === "relation") entity.relation = value;
}

function assignIngestion(ingestion: NonNullable<CaptureFrontmatter["ingestion"]>, key: string, value: string): void {
  if (key === "status") ingestion.status = value;
  else if (key === "last_ingested_at") ingestion.last_ingested_at = value;
  else if (key === "source_id") ingestion.source_id = value;
  else if (key === "content_hash") ingestion.content_hash = value;
  else if (key === "error") ingestion.error = value;
}

function assignCuration(curation: NonNullable<CaptureFrontmatter["curation"]>, key: string, value: string): void {
  if (key === "status") curation.status = value;
  else if (key === "curated_at") curation.curated_at = value;
  else if (key === "summary") curation.summary = value;
}

function splitKeyValue(line: string): { key: string; value: string } {
  const index = line.indexOf(":");
  if (index === -1) {
    return { key: line.trim(), value: "" };
  }
  return { key: line.slice(0, index).trim(), value: unquote(line.slice(index + 1).trim()) };
}

function scalar(value: string): string {
  if (value === "") {
    return '""';
  }
  if (/[:#"'\n]/.test(value) || /^[\s-]/.test(value) || /[\s]$/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
