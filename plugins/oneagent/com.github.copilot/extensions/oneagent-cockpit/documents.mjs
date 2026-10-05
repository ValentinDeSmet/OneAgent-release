import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "../../../runtime/packages/registry/src/config.ts";

const inside = (file, root) => file === root || file.startsWith(root + path.sep);
const revision = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const documentLimit = 2 * 1024 * 1024;

/** Shared by the cockpit and document tabs. Opening a tab never writes a file. */
export function createDocumentStore({ connection, updates, assetsRoot }) {
  const allowedPath = (file) => {
    if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) throw new Error("Indiquer un chemin de fichier absolu.");
    const config = loadConfig(connection.requireConfig());
    const roots = [config.workspaceRoot, assetsRoot, ...config.products.flatMap((p) => p.repositories.map((r) => r.path))]
      .filter((p) => fs.existsSync(p)).map((p) => fs.realpathSync(p));
    const physical = fs.realpathSync(file);
    if (!roots.some((root) => inside(physical, root))) throw new Error("Ce fichier est hors de la mémoire et de ses dépôts configurés.");
    return physical;
  };
  const read = (file) => {
    updates.assertSessionCurrent();
    file = allowedPath(file);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) return { title: file, content: fs.readdirSync(file).join("\n") };
    if (!stat.isFile() || stat.size > documentLimit) throw new Error("Fichier texte requis (2 Mio maximum).");
    const bytes = fs.readFileSync(file), content = bytes.toString("utf8");
    if (bytes.includes(0) || !bytes.equals(Buffer.from(content))) throw new Error("L’aperçu prend en charge les fichiers texte UTF-8.");
    return { title: path.basename(file), content, file, revision: revision(bytes), markdown: /\.md$/i.test(file),
      editable: /\.(md|txt)$/i.test(file) && !inside(file, fs.realpathSync(assetsRoot)) };
  };
  const save = ({ file, revision: expected, content }) => {
    const current = read(file);
    if (!current.editable || typeof content !== "string" || Buffer.byteLength(content) > documentLimit) throw new Error("Modification de fichier refusée.");
    if (current.revision !== expected) throw new Error("Le fichier a changé. Actualiser le document avant de réessayer ; votre brouillon est conservé.");
    fs.writeFileSync(current.file, content, "utf8");
    return { revision: revision(content) };
  };
  return { read, save, allowedPath };
}

/** A stable tab identity: another click focuses the same file in this session. */
export function createDocumentOpener(session, extensionId, store) {
  return async (file) => {
    const document = store.read(file);
    if (!document.file) throw new Error("Choisir un fichier Markdown.");
    const joined = await session;
    return joined.rpc.canvas.open({ ...(extensionId ? { extensionId } : {}), canvasId: "oneagent-document",
      instanceId: `oneagent-document-${revision(document.file)}`, input: { path: document.file } });
  };
}
