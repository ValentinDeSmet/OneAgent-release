import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ReloadRequest { id: string; installedVersion: string | null; requestedAt: number; }
/** Coordination only: no memory content, repository paths or Copilot settings. */
export class RuntimeReload {
  private readonly lease = `${process.pid}-${randomUUID()}.json`;
  private operations = 0;
  readonly directory: string;
  readonly runningVersion: string;
  constructor(directory: string, runningVersion: string) { this.directory = directory; this.runningVersion = runningVersion; }
  private prepare(): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Dossier de rechargement OneAgent invalide.");
  }
  private read(name: string): any {
    const folder = fs.lstatSync(this.directory, { throwIfNoEntry: false });
    if (folder && (!folder.isDirectory() || folder.isSymbolicLink())) throw new Error("Dossier de rechargement OneAgent invalide.");
    const file = path.join(this.directory, name), stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return undefined;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error("État de rechargement OneAgent invalide.");
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  private write(name: string, value: unknown): void {
    this.prepare();
    const file = path.join(this.directory, name);
    this.read(name); // Reject a link before replacing an existing entry.
    const temp = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
  }
  request(): ReloadRequest | undefined {
    const value = this.read("request.json");
    if (!value) return undefined;
    if (typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isFinite(value.requestedAt)
      || !(value.installedVersion === null || typeof value.installedVersion === "string" && /^\d+\.\d+\.\d+$/.test(value.installedVersion))) {
      throw new Error("Demande de rechargement OneAgent invalide.");
    }
    return value;
  }
  requestReload(installedVersion: string | null): ReloadRequest {
    const value = { id: randomUUID(), installedVersion, requestedAt: Date.now() };
    this.write("request.json", value);
    return value;
  }
  begin(): () => void {
    this.operations++;
    try { this.write(this.lease, { pid: process.pid, runningVersion: this.runningVersion, operations: this.operations }); }
    catch (error) { this.operations--; throw error; }
    let ended = false;
    return () => {
      if (ended) return; ended = true;
      if (--this.operations === 0) fs.rmSync(path.join(this.directory, this.lease), { force: true });
      else this.write(this.lease, { pid: process.pid, runningVersion: this.runningVersion, operations: this.operations });
    };
  }
  busy(): boolean {
    if (!fs.existsSync(this.directory)) return false;
    for (const name of fs.readdirSync(this.directory)) {
      if (!/^\d+-[a-f0-9-]{36}\.json$/.test(name)) continue;
      const value = this.read(name);
      if (!value) continue; // Another process may just have drained its lease.
      if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isSafeInteger(value.operations) || value.operations < 1) throw new Error("Opération OneAgent invalide.");
      try { process.kill(value.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") continue; throw error; }
      return true;
    }
    return false;
  }
}
