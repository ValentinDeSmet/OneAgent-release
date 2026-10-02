import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, emptyWorkspaceTaxonomy, normalizeEntityId } from "../../shared/src/index.ts";
import type {
  CustomEntityKindConfig,
  CustomRelationTypeConfig,
  RelationTypeAlias,
  WorkspaceTaxonomy
} from "../../shared/src/index.ts";

/** The workspace taxonomy lives next to the database, editable without touching the YAML config. */
export function taxonomyPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".work-memory", "taxonomy.json");
}

export function loadWorkspaceTaxonomy(workspaceRoot: string): WorkspaceTaxonomy {
  const filePath = taxonomyPath(workspaceRoot);
  if (!fs.existsSync(filePath)) {
    return emptyWorkspaceTaxonomy();
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<WorkspaceTaxonomy>;
  return {
    customEntityKinds: normalizeKinds(parsed.customEntityKinds),
    entityKindAliases: normalizeStringMap(parsed.entityKindAliases),
    customRelationTypes: normalizeRelationTypes(parsed.customRelationTypes),
    relationTypeAliases: normalizeRelationAliases(parsed.relationTypeAliases)
  };
}

export function saveWorkspaceTaxonomy(workspaceRoot: string, taxonomy: WorkspaceTaxonomy): void {
  atomicWriteFile(taxonomyPath(workspaceRoot), `${JSON.stringify(taxonomy, null, 2)}\n`);
}

/** Normalize a proposed custom kind id (lowercase kebab-case, like entity ids). */
export function normalizeKindId(value: string): string {
  return normalizeEntityId(value).replace(/-/g, "_");
}

function normalizeKinds(value: unknown): CustomEntityKindConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is CustomEntityKindConfig => Boolean(entry) && typeof entry === "object" && typeof (entry as CustomEntityKindConfig).id === "string")
    .map((entry) => ({
      id: entry.id,
      label: typeof entry.label === "string" && entry.label ? entry.label : entry.id,
      color: typeof entry.color === "string" ? entry.color : undefined,
      description: typeof entry.description === "string" ? entry.description : "",
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    }));
}

function normalizeRelationTypes(value: unknown): CustomRelationTypeConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is CustomRelationTypeConfig => Boolean(entry) && typeof entry === "object" && typeof (entry as CustomRelationTypeConfig).type === "string")
    .map((entry) => ({
      type: entry.type,
      category: entry.category === "structural" || entry.category === "people" || entry.category === "practice_mission" ? entry.category : "work",
      reading: typeof entry.reading === "string" ? entry.reading : undefined,
      description: typeof entry.description === "string" ? entry.description : undefined,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    }));
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry && entry !== key) {
      result[key] = entry;
    }
  }
  return result;
}

function normalizeRelationAliases(value: unknown): Record<string, RelationTypeAlias> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, RelationTypeAlias> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === "object" && typeof (entry as RelationTypeAlias).into === "string" && (entry as RelationTypeAlias).into !== key) {
      result[key] = { into: (entry as RelationTypeAlias).into, swapDirection: Boolean((entry as RelationTypeAlias).swapDirection) };
    }
  }
  return result;
}
