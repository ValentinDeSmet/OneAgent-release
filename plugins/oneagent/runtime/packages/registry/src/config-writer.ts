import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.ts";
import type { EntityLinkConfig, OrganizationEntityConfig, ProductConfig, RepositoryConfig, WorkMemoryConfig } from "../../shared/src/index.ts";

export interface AddProductInput {
  id: string;
  label?: string;
  description?: string;
  parentEntityId?: string;
  dependencies?: string[];
}

export interface UpsertEntityInput {
  id: string;
  kind: OrganizationEntityConfig["kind"];
  label?: string;
  description?: string;
  parentId?: string;
  members?: string;
}

export interface UpsertEntityLinkInput {
  id?: string;
  sourceId: string;
  targetId: string;
  type: string;
  description?: string;
}

export interface AddRepositoryInput {
  productId: string;
  id: string;
  role: string;
  path: string;
  wikiRoot?: string;
  specsRoot?: string;
  gitRemote?: string;
}

export function addProductToConfig(configPath: string, input: AddProductInput): WorkMemoryConfig {
  const config = loadConfig(configPath);
  if (config.products.some((product) => product.id === input.id)) {
    throw new Error(`Product already exists: ${input.id}`);
  }

  config.products.push({
    id: input.id,
    label: input.label ?? humanizeId(input.id),
    description: input.description,
    parentEntityId: input.parentEntityId,
    dependencies: input.dependencies ?? [],
    repositories: []
  });

  writeConfig(config);
  return loadConfig(config.configPath);
}

export function deleteProductFromConfig(configPath: string, productId: string): WorkMemoryConfig {
  const config = loadConfig(configPath);
  config.products = config.products
    .filter((product) => product.id !== productId)
    .map((product) => ({
      ...product,
      dependencies: (product.dependencies ?? []).filter((dependency) => dependency !== productId)
    }));
  config.entityLinks = config.entityLinks.filter((link) => link.sourceId !== productId && link.targetId !== productId);
  writeConfig(config);
  return loadConfig(config.configPath);
}

export function upsertEntityInConfig(configPath: string, input: UpsertEntityInput): WorkMemoryConfig {
  const config = loadConfig(configPath);
  const existing = config.entities.find((entity) => entity.id === input.id);
  const next: OrganizationEntityConfig = {
    id: input.id,
    kind: input.kind,
    label: input.label ?? humanizeId(input.id),
    description: input.description,
    parentId: input.parentId,
    members: parseMembers(input.members)
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    config.entities.push(next);
  }
  writeConfig(config);
  return loadConfig(config.configPath);
}

export function deleteEntityFromConfig(configPath: string, entityId: string): WorkMemoryConfig {
  const config = loadConfig(configPath);
  config.entities = config.entities.filter((entity) => entity.id !== entityId);
  config.entityLinks = config.entityLinks.filter((link) => link.sourceId !== entityId && link.targetId !== entityId);
  for (const product of config.products) {
    if (product.parentEntityId === entityId) {
      product.parentEntityId = undefined;
    }
  }
  writeConfig(config);
  return loadConfig(config.configPath);
}

/**
 * Remove an organization entity mirror while preserving its structural config
 * references on the canonical merge target.
 */
export function mergeEntityInConfig(configPath: string, fromId: string, intoId: string): WorkMemoryConfig {
  const config = loadConfig(configPath);
  config.entities = config.entities.filter((entity) => entity.id !== fromId);
  const seenLinks = new Set<string>();
  config.entityLinks = config.entityLinks.flatMap((link) => {
    const sourceId = link.sourceId === fromId ? intoId : link.sourceId;
    const targetId = link.targetId === fromId ? intoId : link.targetId;
    if (sourceId === targetId) return [];
    const identity = `${sourceId}\u0000${link.type}\u0000${targetId}`;
    if (seenLinks.has(identity)) return [];
    seenLinks.add(identity);
    return [{ ...link, sourceId, targetId }];
  });
  for (const product of config.products) {
    if (product.parentEntityId === fromId) product.parentEntityId = intoId;
  }
  writeConfig(config);
  return loadConfig(config.configPath);
}

export function upsertEntityLinkInConfig(configPath: string, input: UpsertEntityLinkInput): WorkMemoryConfig {
  const config = loadConfig(configPath);
  const id = input.id || `${input.sourceId}-${input.type}-${input.targetId}`;
  const next: EntityLinkConfig = {
    id,
    sourceId: input.sourceId,
    targetId: input.targetId,
    type: input.type,
    description: input.description
  };
  const existing = config.entityLinks.find((link) => link.id === id);
  if (existing) {
    Object.assign(existing, next);
  } else {
    config.entityLinks.push(next);
  }
  writeConfig(config);
  return loadConfig(config.configPath);
}

export function deleteEntityLinkFromConfig(configPath: string, linkId: string): WorkMemoryConfig {
  const config = loadConfig(configPath);
  config.entityLinks = config.entityLinks.filter((link) => link.id !== linkId);
  writeConfig(config);
  return loadConfig(config.configPath);
}

export function addRepositoryToConfig(configPath: string, input: AddRepositoryInput): WorkMemoryConfig {
  const config = loadConfig(configPath);
  const product = config.products.find((candidate) => candidate.id === input.productId);
  if (!product) {
    throw new Error(`Unknown product id: ${input.productId}`);
  }

  if (config.products.some((candidate) => candidate.repositories.some((repository) => repository.id === input.id))) {
    throw new Error(`Repository already exists: ${input.id}`);
  }

  product.repositories.push({
    id: input.id,
    productId: input.productId,
    role: input.role,
    purpose: "product-reference",
    path: path.resolve(config.workspaceRoot, input.path),
    wikiRoot: input.wikiRoot,
    specsRoot: input.specsRoot,
    gitRemote: input.gitRemote
  });

  writeConfig(config);
  return loadConfig(config.configPath);
}

export function writeConfig(config: WorkMemoryConfig): void {
  fs.writeFileSync(config.configPath, serializeConfig(config), "utf8");
}

/** Set (or clear, with undefined) the workspace owner reference ('person:<id>'). */
export function setWorkspaceSelfInConfig(configPath: string, selfRef: string | undefined): WorkMemoryConfig {
  const config = loadConfig(configPath);
  config.workspace.self = selfRef;
  writeConfig(config);
  return loadConfig(config.configPath);
}

export function serializeConfig(config: WorkMemoryConfig): string {
  const lines: string[] = [];

  lines.push("workspace:");
  lines.push(`  name: ${yamlScalar(config.workspace.name)}`);
  lines.push(`  memoryRoot: ${yamlScalar(config.workspace.memoryRoot)}`);
  if (config.workspace.self) {
    lines.push(`  self: ${yamlScalar(config.workspace.self)}`);
  }
  lines.push("");
  lines.push("storage:");
  lines.push(`  databasePath: ${yamlScalar(toConfigPath(config, config.storage.databasePath))}`);
  lines.push("");
  if (config.privateBackup) {
    lines.push("privateBackup:");
    lines.push(`  id: ${yamlScalar(config.privateBackup.id)}`);
    lines.push(`  purpose: ${yamlScalar(config.privateBackup.purpose)}`);
    lines.push(`  path: ${yamlScalar(toConfigPath(config, config.privateBackup.path))}`);
    lines.push("");
  }
  lines.push("entities:");
  if (config.entities.length === 0) {
    lines[lines.length - 1] = "entities: []";
  } else {
    for (const entity of config.entities) {
      writeEntity(lines, entity);
    }
  }
  lines.push("");
  lines.push("entityLinks:");
  if (config.entityLinks.length === 0) {
    lines[lines.length - 1] = "entityLinks: []";
  } else {
    for (const link of config.entityLinks) {
      writeEntityLink(lines, link);
    }
  }
  lines.push("");
  lines.push("products:");

  if (config.products.length === 0) {
    lines[lines.length - 1] = "products: []";
    return `${lines.join("\n")}\n`;
  }

  for (const product of config.products) {
    writeProduct(lines, config, product);
  }

  return `${lines.join("\n")}\n`;
}

function writeProduct(lines: string[], config: WorkMemoryConfig, product: ProductConfig): void {
  lines.push(`  - id: ${yamlScalar(product.id)}`);
  lines.push(`    label: ${yamlScalar(product.label)}`);
  if (product.description) {
    lines.push(`    description: ${yamlScalar(product.description)}`);
  }
  if (product.parentEntityId) {
    lines.push(`    parentEntityId: ${yamlScalar(product.parentEntityId)}`);
  }
  if (product.dependencies && product.dependencies.length > 0) {
    lines.push(`    dependencies: ${yamlScalar(product.dependencies.join(", "))}`);
  }
  if (product.repositories.length === 0) {
    return;
  }
  lines.push("    repositories:");
  for (const repository of product.repositories) {
    writeRepository(lines, config, repository);
  }
}

function writeEntity(lines: string[], entity: OrganizationEntityConfig): void {
  lines.push(`  - id: ${yamlScalar(entity.id)}`);
  lines.push(`    kind: ${yamlScalar(entity.kind)}`);
  lines.push(`    label: ${yamlScalar(entity.label)}`);
  if (entity.description) {
    lines.push(`    description: ${yamlScalar(entity.description)}`);
  }
  if (entity.parentId) {
    lines.push(`    parentId: ${yamlScalar(entity.parentId)}`);
  }
  if (entity.members && entity.members.length > 0) {
    lines.push(`    members: ${yamlScalar(entity.members.map((member) => member.role ? `${member.name} - ${member.role}` : member.name).join("; "))}`);
  }
}

function writeEntityLink(lines: string[], link: EntityLinkConfig): void {
  lines.push(`  - id: ${yamlScalar(link.id)}`);
  lines.push(`    sourceId: ${yamlScalar(link.sourceId)}`);
  lines.push(`    targetId: ${yamlScalar(link.targetId)}`);
  lines.push(`    type: ${yamlScalar(link.type)}`);
  if (link.description) {
    lines.push(`    description: ${yamlScalar(link.description)}`);
  }
}

function writeRepository(lines: string[], config: WorkMemoryConfig, repository: RepositoryConfig): void {
  lines.push(`      - id: ${yamlScalar(repository.id)}`);
  lines.push(`        role: ${yamlScalar(repository.role)}`);
  lines.push("        purpose: product-reference");
  lines.push(`        path: ${yamlScalar(toConfigPath(config, repository.path))}`);
  if (repository.wikiRoot) {
    lines.push(`        wikiRoot: ${yamlScalar(repository.wikiRoot)}`);
  }
  if (repository.specsRoot) {
    lines.push(`        specsRoot: ${yamlScalar(repository.specsRoot)}`);
  }
  if (repository.gitRemote) {
    lines.push(`        gitRemote: ${yamlScalar(repository.gitRemote)}`);
  }
}

function toConfigPath(config: WorkMemoryConfig, value: string): string {
  if (!path.isAbsolute(value)) {
    return value;
  }

  const relative = path.relative(config.workspaceRoot, value);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative || ".";
  }

  return value;
}

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./~:@-]+(?:, [A-Za-z0-9_./~:@-]+)*$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function humanizeId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function parseMembers(value?: string) {
  if (!value?.trim()) {
    return [];
  }
  return value.split(";").map((entry) => {
    const [name, role] = entry.split(" - ").map((part) => part.trim());
    return role ? { name, role } : { name };
  }).filter((member) => member.name);
}
