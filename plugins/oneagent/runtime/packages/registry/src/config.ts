import fs from "node:fs";
import path from "node:path";
import { configureTaxonomy } from "../../shared/src/index.ts";
import type { EmbeddingsConfig, EntityLinkConfig, OrganizationEntityConfig, PrivateBackupRepositoryConfig, ProductConfig, RepositoryConfig, WorkMemoryConfig } from "../../shared/src/index.ts";
import { loadWorkspaceTaxonomy } from "./taxonomy-store.ts";

interface ParsedConfig {
  workspace?: {
    name?: string;
    memoryRoot?: string;
    self?: string;
  };
  storage?: {
    databasePath?: string;
  };
  embeddings?: Partial<EmbeddingsConfig>;
  privateBackup?: PrivateBackupRepositoryConfig;
  entities?: OrganizationEntityConfig[];
  entityLinks?: EntityLinkConfig[];
  products?: Array<Omit<ProductConfig, "repositories" | "dependencies"> & {
    dependencies?: string | string[];
    repositories?: Array<Omit<RepositoryConfig, "productId">>;
  }>;
}

export function findConfigPath(startDir: string): string | undefined {
  let current = path.resolve(startDir);

  while (true) {
    const candidates = [
      path.join(current, ".work-memory", "config.yaml"),
      path.join(current, ".work-memory", "config.json"),
      path.join(current, "work-memory.config.yaml"),
      path.join(current, "work-memory.config.json")
    ];

    const match = candidates.find((candidate) => fs.existsSync(candidate));
    if (match) {
      return match;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function loadConfig(configPath: string): WorkMemoryConfig {
  const absoluteConfigPath = path.resolve(configPath);
  const raw = fs.readFileSync(absoluteConfigPath, "utf8");
  const parsed = parseConfig(raw);
  const workspaceRoot = resolveWorkspaceRoot(absoluteConfigPath, parsed.workspace?.memoryRoot);

  // Register the workspace taxonomy before anything validates kinds or relation
  // types — custom kinds and merged-kind aliases apply process-wide from here on.
  const taxonomy = loadWorkspaceTaxonomy(workspaceRoot);
  configureTaxonomy(taxonomy);

  const products = (parsed.products ?? []).map((product) => {
    const repositories = (product.repositories ?? []).map((repository) => ({
      id: requireString(repository.id, `repository id for product ${product.id}`),
      productId: requireString(product.id, "product id"),
      role: requireString(repository.role, `repository role for product ${product.id}`),
      purpose: productRepositoryPurpose(repository.purpose),
      path: resolveFromWorkspace(workspaceRoot, requireString(repository.path, `repository path for product ${product.id}`)),
      wikiRoot: repository.wikiRoot,
      specsRoot: repository.specsRoot,
      gitRemote: repository.gitRemote
    }));

    return {
      id: requireString(product.id, "product id"),
      label: requireString(product.label, `label for product ${product.id}`),
      description: product.description,
      parentEntityId: product.parentEntityId,
      dependencies: parseStringList(product.dependencies),
      repositories
    };
  });

  return {
    configPath: absoluteConfigPath,
    workspaceRoot,
    workspace: {
      name: parsed.workspace?.name ?? "Work Memory",
      memoryRoot: parsed.workspace?.memoryRoot ?? ".work-memory",
      self: parsed.workspace?.self
    },
    storage: {
      databasePath: resolveFromWorkspace(workspaceRoot, parsed.storage?.databasePath ?? ".work-memory/work-memory.db")
    },
    privateBackup: privateBackupConfig(parsed.privateBackup, workspaceRoot),
    embeddings: {
      provider: parsed.embeddings?.provider ?? "noop",
      model: parsed.embeddings?.model ?? "bge-m3",
      endpoint: parsed.embeddings?.endpoint,
      batchSize: Number(parsed.embeddings?.batchSize ?? 8),
      apiKey: parsed.embeddings?.apiKey,
      apiKeyEnv: parsed.embeddings?.apiKeyEnv,
      apiKeyFile: parsed.embeddings?.apiKeyFile
    },
    entities: (parsed.entities ?? []).map((entity) => ({
      id: requireString(entity.id, "entity id"),
      kind: requireEntityKind(entity.kind),
      label: requireString(entity.label, `label for entity ${entity.id}`),
      description: entity.description,
      parentId: entity.parentId,
      members: parseMembers(entity.members)
    })),
    entityLinks: (parsed.entityLinks ?? []).map((link) => ({
      id: requireString(link.id, "link id"),
      sourceId: requireString(link.sourceId, `sourceId for link ${link.id}`),
      targetId: requireString(link.targetId, `targetId for link ${link.id}`),
      type: requireString(link.type, `type for link ${link.id}`),
      description: link.description
    })),
    products,
    taxonomy
  };
}

export function loadConfigFrom(startDir: string): WorkMemoryConfig {
  return loadConfig(resolveConfigPath(startDir));
}

/** Explicit host config wins, then a stable process binding, then legacy discovery. */
export function resolveConfigPath(startDir: string, explicitPath?: string, environment: NodeJS.ProcessEnv = process.env): string {
  if (explicitPath) return path.resolve(startDir, explicitPath);
  const binding = environment.ONEAGENT_CONFIG;
  if (binding !== undefined) {
    if (!binding.trim() || !path.isAbsolute(binding)) {
      throw new Error("ONEAGENT_CONFIG must be an absolute path to a OneAgent configuration file.");
    }
    // A missing explicit binding must fail at load time, never fall back to a
    // different memory discovered in the current product repository.
    return binding;
  }
  const configPath = findConfigPath(startDir);
  if (!configPath) {
    throw new Error(`No Work Memory config found from ${startDir}. Run "pnpm wm init" first.`);
  }
  return configPath;
}

function parseConfig(raw: string): ParsedConfig {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as ParsedConfig;
  }
  return parseYamlConfig(raw);
}

type ParsedProduct = NonNullable<ParsedConfig["products"]>[number];

function parseYamlConfig(raw: string): ParsedConfig {
  const config: Required<Omit<ParsedConfig, "privateBackup">> & Pick<ParsedConfig, "privateBackup"> = {
    workspace: {},
    storage: {},
    embeddings: {},
    entities: [],
    entityLinks: [],
    products: []
  };
  let section = "";
  let currentEntity: OrganizationEntityConfig | undefined;
  let currentLink: EntityLinkConfig | undefined;
  let currentProduct: ParsedProduct | undefined;
  let currentRepository: NonNullable<ParsedProduct["repositories"]>[number] | undefined;

  for (const originalLine of raw.split(/\r?\n/)) {
    const withoutComment = originalLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) {
      continue;
    }

    const indent = withoutComment.search(/\S/);
    const line = withoutComment.trim();

    if (indent === 0 && /^privateBackup\s*:/.test(line) && line !== "privateBackup:") {
      throw new Error("privateBackup must be a mapping with id, purpose and path.");
    }
    if (indent === 0 && line.endsWith(":")) {
      section = line.slice(0, -1);
      if (section === "privateBackup") config.privateBackup = {} as PrivateBackupRepositoryConfig;
      currentEntity = undefined;
      currentLink = undefined;
      currentProduct = undefined;
      currentRepository = undefined;
      continue;
    }

    if (section === "entities") {
      if (indent === 2 && line.startsWith("- ")) {
        currentEntity = { id: "", kind: "team", label: "" };
        config.entities?.push(currentEntity);
        Object.assign(currentEntity, parseKeyValue(line.slice(2)));
        continue;
      }
      if (currentEntity && indent >= 4) {
        Object.assign(currentEntity, parseKeyValue(line));
      }
      continue;
    }

    if (section === "entityLinks") {
      if (indent === 2 && line.startsWith("- ")) {
        currentLink = { id: "", sourceId: "", targetId: "", type: "" };
        config.entityLinks?.push(currentLink);
        Object.assign(currentLink, parseKeyValue(line.slice(2)));
        continue;
      }
      if (currentLink && indent >= 4) {
        Object.assign(currentLink, parseKeyValue(line));
      }
      continue;
    }

    if (section === "products") {
      if (indent === 2 && line.startsWith("- ")) {
        currentProduct = { id: "", label: "", repositories: [] };
        config.products?.push(currentProduct);
        Object.assign(currentProduct, parseKeyValue(line.slice(2)));
        currentRepository = undefined;
        continue;
      }

      if (indent === 4 && line === "repositories:") {
        if (!currentProduct) {
          throw new Error("repositories declared before a product");
        }
        currentProduct.repositories = currentProduct.repositories ?? [];
        continue;
      }

      if (indent === 6 && line.startsWith("- ")) {
        if (!currentProduct) {
          throw new Error("repository declared before a product");
        }
        currentRepository = { id: "", role: "", path: "" };
        currentProduct.repositories = currentProduct.repositories ?? [];
        currentProduct.repositories.push(currentRepository);
        Object.assign(currentRepository, parseKeyValue(line.slice(2)));
        continue;
      }

      const entry = parseKeyValue(line);
      if (currentRepository && indent >= 8) {
        Object.assign(currentRepository, entry);
      } else if (currentProduct && indent >= 4) {
        Object.assign(currentProduct, entry);
      }
      continue;
    }

    const entry = parseKeyValue(line);
    if (section === "workspace") {
      Object.assign(config.workspace, entry);
    } else if (section === "storage") {
      Object.assign(config.storage, entry);
    } else if (section === "privateBackup") {
      config.privateBackup ??= {} as PrivateBackupRepositoryConfig;
      Object.assign(config.privateBackup, entry);
    } else if (section === "embeddings") {
      Object.assign(config.embeddings, entry);
    }
  }

  return config;
}

function parseKeyValue(line: string): Record<string, string | number | boolean> {
  const index = line.indexOf(":");
  if (index === -1) {
    return {};
  }

  const key = line.slice(0, index).trim();
  const value = line.slice(index + 1).trim();
  return { [key]: parseScalar(value) };
}

function parseScalar(value: string): string | number | boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value.replace(/^["']|["']$/g, "");
}

function resolveWorkspaceRoot(configPath: string, memoryRoot = ".work-memory"): string {
  const configDir = path.dirname(configPath);
  if (path.basename(configDir) === path.basename(memoryRoot)) {
    return path.dirname(configDir);
  }
  return configDir;
}

function resolveFromWorkspace(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${label} in Work Memory config`);
  }
  return value;
}

function requireEntityKind(value: unknown): OrganizationEntityConfig["kind"] {
  if (value === "domain" || value === "subdomain" || value === "team") {
    return value;
  }
  throw new Error(`Unknown organization entity kind: ${String(value)}`);
}

function parseMembers(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return value.split(";").map((entry) => {
    const [name, role] = entry.split(" - ").map((part) => part.trim());
    return role ? { name, role } : { name };
  }).filter((member) => member.name);
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function productRepositoryPurpose(value: unknown): "product-reference" {
  if (value !== undefined && value !== "product-reference") {
    throw new Error("Product repositories must have purpose product-reference. Configure a private backup separately with privateBackup.");
  }
  return "product-reference";
}

function privateBackupConfig(value: unknown, workspaceRoot: string): PrivateBackupRepositoryConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || (value as PrivateBackupRepositoryConfig).purpose !== "private-backup") {
    throw new Error("privateBackup requires an explicit purpose: private-backup; no product repository is selected automatically.");
  }
  const candidate = value as PrivateBackupRepositoryConfig;
  return {
    id: requireString(candidate.id, "privateBackup id"),
    purpose: "private-backup",
    path: resolveFromWorkspace(workspaceRoot, requireString(candidate.path, "privateBackup path"))
  };
}
