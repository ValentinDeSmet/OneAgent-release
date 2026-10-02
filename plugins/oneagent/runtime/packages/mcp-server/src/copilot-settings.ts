import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface Node { value: any; start: number; end: number; fields?: Map<string, Node>; }

/** A small JSONC reader retaining offsets: only the OneAgent entry is rewritten. */
function parse(text: string): Node {
  let cursor = 0;
  const fail = (): never => { throw new Error("Les paramètres Copilot sont invalides ; aucun réglage n’a été modifié."); };
  const space = () => {
    for (;;) {
      while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
      if (text.slice(cursor, cursor + 2) === "//") {
        const end = text.indexOf("\n", cursor); cursor = end < 0 ? text.length : end;
      } else if (text.slice(cursor, cursor + 2) === "/*") {
        const end = text.indexOf("*/", cursor + 2); if (end < 0) fail(); cursor = end + 2;
      } else break;
    }
  };
  const string = () => {
    const start = cursor++;
    while (cursor < text.length) {
      const ch = text[cursor++];
      if (ch === "\\") cursor++;
      else if (ch === '"') { try { return JSON.parse(text.slice(start, cursor)); } catch { fail(); } }
    }
    return fail();
  };
  const read = (depth = 0): Node => {
    if (depth > 100) fail();
    space(); const start = cursor;
    if (text[cursor] === "{") {
      cursor++; const value = Object.create(null), fields = new Map<string, Node>(); space();
      while (text[cursor] !== "}") {
        if (text[cursor] !== '"') fail();
        const key = string(); space(); if (text[cursor++] !== ":" || fields.has(key)) fail();
        const child = read(depth + 1); value[key] = child.value; fields.set(key, child); space();
        if (text[cursor] !== ",") break;
        cursor++; space();
      }
      if (text[cursor++] !== "}") fail();
      return { value, start, end: cursor, fields };
    }
    if (text[cursor] === "[") {
      cursor++; const value = []; space();
      while (text[cursor] !== "]") {
        value.push(read(depth + 1).value); space();
        if (text[cursor] !== ",") break;
        cursor++; space();
      }
      if (text[cursor++] !== "]") fail();
      return { value, start, end: cursor };
    }
    if (text[cursor] === '"') return { value: string(), start, end: cursor };
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));
    if (!token) return fail();
    cursor += token[0].length;
    return { value: JSON.parse(token[0]), start, end: cursor };
  };
  const result = read(); space(); if (cursor !== text.length || !result.fields) fail(); return result;
}

export function readCopilotSettings(file: string): { raw: string; value: Record<string, any> } {
  if (!path.isAbsolute(file)) throw new Error("COPILOT_HOME doit désigner un dossier absolu.");
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)) {
    throw new Error("Les paramètres Copilot doivent être un fichier JSONC ordinaire de moins de 1 Mio. Aucun fichier n’a été remplacé.");
  }
  const raw = stat ? fs.readFileSync(file, "utf8") : "";
  return { raw, value: parse(raw || "{}").value };
}

export function patchMarketplace(raw: string, name: string, entry: Record<string, unknown>): string {
  const text = raw || "{}\n", root = parse(text);
  const marketplaces = root.fields!.get("extraKnownMarketplaces");
  if (marketplaces && !marketplaces.fields) throw new Error("extraKnownMarketplaces doit être un objet ; aucun réglage modifié.");
  const owner = marketplaces ?? root;
  const key = marketplaces ? name : "extraKnownMarketplaces";
  const value = marketplaces ? entry : { [name]: entry };
  const existing = owner.fields!.get(key), encoded = JSON.stringify(value, null, 2);
  if (existing) return text.slice(0, existing.start) + encoded + text.slice(existing.end);
  return text.slice(0, owner.start + 1) + `\n${JSON.stringify(key)}: ${encoded}${owner.fields!.size ? "," : ""}\n` + text.slice(owner.start + 1);
}

export function saveMarketplace(file: string, previous: string, name: string, entry: Record<string, unknown>): void {
  const next = patchMarketplace(previous, name, entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.oneagent-updates-lock`;
  let handle: number;
  try { handle = fs.openSync(lock, "wx", 0o600); }
  catch { throw new Error("Les réglages de mise à jour sont déjà en cours de modification. Réessayer après la fin de l’opération."); }
  const temporary = path.join(path.dirname(file), `.oneagent-updates-${randomUUID()}.tmp`);
  try {
    if (readCopilotSettings(file).raw !== previous) throw new Error("Les paramètres Copilot ont changé. Relancer le choix des mises à jour.");
    fs.writeFileSync(temporary, next, { flag: "wx", mode: 0o600 });
    if (readCopilotSettings(file).raw !== previous) throw new Error("Les paramètres Copilot ont changé. Aucun réglage remplacé.");
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true }); fs.closeSync(handle); fs.unlinkSync(lock);
  }
}
