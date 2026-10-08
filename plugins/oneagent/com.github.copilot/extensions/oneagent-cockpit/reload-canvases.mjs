import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const hash = value => createHash("sha256").update(value).digest("hex");
const canvasIds = new Set(["oneagent-cockpit", "oneagent-document", "oneagent-priorities"]);
const valid = value => value && canvasIds.has(value.canvasId) && [value.instanceId, value.extensionId].every(part => typeof part === "string" && part.length > 0 && part.length < 1024)
  && (value.input === undefined || value.input && typeof value.input === "object" && !Array.isArray(value.input));

/** Private, session-specific receipts survive the process the host will replace.
 * Never store document contents, prompts, tokens, or another extension's tabs. */
export function createCanvasHandoff(directory, sessionId, runningVersion = "unknown") {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Session Copilot manquante.");
  const folder = path.join(directory, "session-" + hash(sessionId));
  const prepare = () => {
    for (const dir of [directory, folder]) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Dossier de reprise OneAgent invalide.");
    }
  };
  const read = name => {
    prepare(); const file = path.join(folder, name), stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 65536) throw new Error("État de reprise OneAgent invalide.");
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  };
  const write = (name, value) => {
    read(name); const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > 65536) throw new Error("Trop d’onglets OneAgent à reprendre.");
    const temp = path.join(folder, randomUUID() + ".tmp");
    try { fs.writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" }); fs.renameSync(temp, path.join(folder, name)); }
    finally { fs.rmSync(temp, { force: true }); }
  };
  const pending = () => {
    const value = read("pending.json");
    if (!value) return;
    if (value.version !== 1 || !Array.isArray(value.canvases) || value.canvases.length > 50 || !value.canvases.every(valid)
      || !(value.target === null || typeof value.target === "string" && /^\d+\.\d+\.\d+$/.test(value.target))) throw new Error("Reprise des onglets invalide.");
    return value;
  };
  return {
    folder,
    register(ctx) {
      const value = { instanceId: ctx.instanceId, extensionId: ctx.extensionId, canvasId: ctx.canvasId, ...(ctx.input ? { input: ctx.input } : {}) };
      if (!valid(value)) throw new Error("Onglet OneAgent invalide.");
      const name = "canvas-" + hash(ctx.instanceId) + ".json";
      write(name, { ...value, pid: process.pid, runningVersion });
      return () => { const current = read(name); if (current?.pid === process.pid) fs.rmSync(path.join(folder, name), { force: true }); };
    },
    owned() {
      prepare();
      return fs.readdirSync(folder).filter(name => /^canvas-[a-f0-9]{64}\.json$/.test(name)).flatMap(name => {
        const value = read(name); if (!value) return [];
        if (!valid(value) || !Number.isSafeInteger(value.pid) || value.pid <= 0) throw new Error("Onglet OneAgent invalide.");
        try { process.kill(value.pid, 0); } catch (error) { if (error.code === "ESRCH") return []; throw error; }
        return [value];
      });
    },
    pending,
    save(target, canvases) { if (!canvases.every(valid)) throw new Error("Onglets de reprise invalides."); write("pending.json", { version: 1, target, canvases }); },
    completed(instanceId) { const value = pending(); if (value) write("pending.json", { ...value, canvases: value.canvases.filter(item => item.instanceId !== instanceId) }); },
    clear() { read("pending.json"); fs.rmSync(path.join(folder, "pending.json"), { force: true }); }
  };
}

export function createCanvasGuard({ now = Date.now } = {}) {
  let pause = false, report, state = { message: "", retry: false };
  return {
    handle(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("État d’onglet invalide.");
      if (input.action === "report") {
        if (typeof input.blocked !== "boolean" || typeof input.locked !== "boolean") throw new Error("État d’éditeur invalide.");
        report = { blocked: input.blocked, locked: input.locked, at: now() };
      } else if (input.action === "prepare") pause = true;
      else if (input.action === "resume") pause = false;
      else if (input.action !== "status") throw new Error("Action d’onglet inconnue.");
      return { pause, ...state, ready: pause && report?.locked === true && report.blocked === false && now() - report.at < 5000, blocked: report?.blocked !== false };
    },
    notify(value) { state = { message: value.message || "", retry: value.retryReload === true }; },
  };
}

/** Only contact URLs returned by the host for canvases registered by our processes. */
export function createCanvasManager(session, handoff, request = fetch) {
  let prepared = [];
  const call = async (canvas, action) => {
    const url = new URL(canvas.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || !/^[a-f0-9]{64}$/.test(url.searchParams.get("token") || "")) throw new Error("Adresse d’onglet OneAgent invalide.");
    const response = await request(new URL("/api/reload-ui", url), { method: "POST", headers: { "Content-Type": "application/json", "X-OneAgent-Token": url.searchParams.get("token") }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(3000), redirect: "error" });
    if (!response.ok) throw new Error("Un onglet OneAgent ne répond pas à la préparation de mise à jour.");
    return response.json();
  };
  return {
    async prepare() {
      const joined = await session, rpc = joined.rpc;
      if (![rpc?.plugins?.reload, rpc?.canvas?.listOpen, rpc?.canvas?.close, rpc?.canvas?.open].every(fn => typeof fn === "function")) throw Object.assign(new Error("Host reload API unavailable"), { userMessage: "Le rechargement intégré nécessite une version plus récente de l’application Copilot. Aucune installation OneAgent lancée." });
      const owned = handoff.owned(), open = (await rpc.canvas.listOpen()).openCanvases;
      prepared = open.filter(item => owned.some(own => own.instanceId === item.instanceId && own.extensionId === item.extensionId && own.canvasId === item.canvasId));
      const states = await Promise.all(prepared.map(item => call(item, "prepare")));
      return states.every(state => state.ready);
    },
    async resume() { await Promise.allSettled(prepared.map(item => call(item, "resume"))); prepared = []; },
    save(target) { handoff.save(target, prepared.map(({ instanceId, extensionId, canvasId, input }) => ({ instanceId, extensionId, canvasId, ...(input ? { input } : {}) }))); },
    async restore(currentVersion) {
      const pending = handoff.pending(); if (!pending || pending.target && pending.target !== currentVersion) return false;
      const joined = await session;
      // A replacement process may join while the host is still reloading its
      // sibling providers. Leave the receipt for a later tick if open rejects.
      const failures = [];
      for (const item of pending.canvases) {
        try {
        const live = (await joined.rpc.canvas.listOpen()).openCanvases;
        if (live.some(open => open.instanceId === item.instanceId && open.extensionId === item.extensionId) && handoff.owned().some(own => own.instanceId === item.instanceId && own.extensionId === item.extensionId && own.runningVersion === currentVersion)) { handoff.completed(item.instanceId); continue; }
        if (live.some(open => open.instanceId === item.instanceId && open.extensionId === item.extensionId)) await joined.rpc.canvas.close({ instanceId: item.instanceId });
        await joined.rpc.canvas.open(item);
        handoff.completed(item.instanceId);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new Error("Certains onglets OneAgent n’ont pas encore pu se réouvrir.");
      handoff.clear(); return true;
    }
  };
}
