import { createHash, randomUUID } from "node:crypto";
import type { WorkMemoryDatabase } from "../../storage/src/index.ts";
import { listPriorities } from "./priorities.ts";

export const PRIORITY_VIEWS_UI_KEY = "prioritySavedViews";
const texts = ["query", "titleQuery", "bodyQuery", "requesterQuery", "urlQuery", "sourceUrlQuery", "deadlineFrom", "deadlineTo"] as const;
const facets = ["filter", "itemType", "workType", "deadlineQuarter", "deadlineYear", "involvedEntity", "relatedEntity", "entity", "productId", "priority", "status", "deadlineKind"] as const;
export const priorityViewFields = [...texts, ...facets, "view", "sortBy", "sortDirection"];
type Criteria = Record<string, string | string[]>;
export interface PrioritySavedView { id: string; name: string; criteria: Criteria; createdAt: string; updatedAt: string; }
interface Store { version: 1; defaultViewId: string | null; items: PrioritySavedView[]; }
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Objet JSON attendu.");
  return raw as Record<string, unknown>;
}
function fields(raw: unknown, allowed: string[]) {
  const value = object(raw);
  if (value.scope !== "portfolio") throw new Error("Le périmètre portfolio est obligatoire.");
  for (const key of Object.keys(value)) if (!["scope", ...allowed].includes(key)) throw new Error(`Champ inconnu : ${key}`);
  return value;
}
function string(value: unknown, label: string, max = 80) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > max) throw new Error(`Champ invalide : ${label}`);
  return value.trim();
}
/** Only declarative query criteria survive. Never store dates of reading, pages or task IDs as an order snapshot. */
export function normalizePriorityViewCriteria(db: WorkMemoryDatabase, raw: unknown): Criteria {
  const value = object(raw);
  for (const key of Object.keys(value)) if (!priorityViewFields.includes(key)) throw new Error(`Critère inconnu : ${key}`);
  if (Buffer.byteLength(JSON.stringify(value)) > 16384) throw new Error("Cette vue contient trop de critères.");
  // Reuse the query's complete validation, including dates, enums and multi-select limits.
  listPriorities(db, { ...value, scope: "portfolio", limit: 1 });
  const result: Criteria = { view: String(value.view ?? "active").trim(), sortBy: String(value.sortBy ?? "manual").trim(), sortDirection: String(value.sortDirection ?? "asc").trim() };
  for (const key of texts) result[key] = typeof value[key] === "string" ? value[key].trim() : "";
  for (const key of facets) {
    const choices = value[key] === undefined ? [] : Array.isArray(value[key]) ? value[key] as string[] : [value[key] as string];
    result[key] = choices.some(choice => choice.trim() === "all") ? [] : [...new Set(choices.map(choice => choice.trim()).filter(Boolean))].sort();
  }
  return result;
}
function store(db: WorkMemoryDatabase): Store {
  const value = db.getUiState<Store>(PRIORITY_VIEWS_UI_KEY) ?? { version: 1, items: [], defaultViewId: null };
  if (value.version !== 1 || !Array.isArray(value.items) || value.items.length > 50 || !(value.defaultViewId === null || typeof value.defaultViewId === "string")) throw new Error("Vues enregistrées invalides ; ne pas les remplacer automatiquement.");
  return value;
}
const revision = (value: Store) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const response = (value: Store) => ({ items: [...value.items].sort((a,b) => a.name.localeCompare(b.name, "fr")), defaultViewId: value.defaultViewId, revision: revision(value) });
export function listPriorityViews(db: WorkMemoryDatabase, raw: unknown) { fields(raw, []); return response(store(db)); }
function checkedStore(db: WorkMemoryDatabase, value: Record<string, unknown>) {
  const current = store(db);
  if (value.revision !== revision(current)) throw new Error("Les vues ont changé. Actualise avant de réessayer.");
  return current;
}
export function savePriorityView(db: WorkMemoryDatabase, raw: unknown) {
  const value = fields(raw, ["revision", "id", "name", "criteria", "makeDefault"]);
  if (value.makeDefault !== undefined && typeof value.makeDefault !== "boolean") throw new Error("makeDefault doit être un booléen.");
  return db.runInImmediateTransaction(() => {
    const current = checkedStore(db, value), id = value.id === undefined ? randomUUID() : string(value.id, "id", 256);
    const existing = current.items.find(item => item.id === id);
    if (value.id !== undefined && !existing) throw new Error("Cette vue n’existe plus. Actualise la liste.");
    if (!existing && current.items.length >= 50) throw new Error("Limite de 50 vues atteinte.");
    const name = value.name === undefined && existing ? existing.name : string(value.name, "name");
    if (current.items.some(item => item.id !== id && item.name.normalize("NFKC").toLocaleLowerCase("fr") === name.normalize("NFKC").toLocaleLowerCase("fr"))) throw new Error("Une vue porte déjà ce nom. Choisis un autre nom.");
    const criteria = value.criteria === undefined && existing ? existing.criteria : normalizePriorityViewCriteria(db, value.criteria);
    const now = new Date().toISOString(), item: PrioritySavedView = { id, name, criteria, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const next: Store = { version: 1, items: [...current.items.filter(item => item.id !== id), item],
      defaultViewId: value.makeDefault === true ? id : value.makeDefault === false && current.defaultViewId === id ? null : current.defaultViewId };
    if (Buffer.byteLength(JSON.stringify(next)) > 524288) throw new Error("Les vues enregistrées contiennent trop de critères.");
    db.setUiState(PRIORITY_VIEWS_UI_KEY, next);
    return { ...response(next), saved: item };
  });
}
export function deletePriorityView(db: WorkMemoryDatabase, raw: unknown) {
  const value = fields(raw, ["revision", "id"]), id = string(value.id, "id", 256);
  return db.runInImmediateTransaction(() => {
    const current = checkedStore(db, value);
    if (!current.items.some(item => item.id === id)) throw new Error("Cette vue n’existe plus. Actualise la liste.");
    const next: Store = { ...current, items: current.items.filter(item => item.id !== id), defaultViewId: current.defaultViewId === id ? null : current.defaultViewId };
    db.setUiState(PRIORITY_VIEWS_UI_KEY, next);
    return { ...response(next), deleted: true, id };
  });
}
