import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const held = new Map<string, { token: string; users: number }>();

/** Coordinate supported runtime operations with a filesystem + database snapshot. */
export function acquireMemoryLock(databasePath: string, options: { exclusive?: boolean; timeoutMs?: number } = {}): () => void {
  const directory = path.dirname(path.resolve(databasePath));
  fs.mkdirSync(directory, { recursive: true });
  const lockPath = path.join(fs.realpathSync(directory), `.${path.basename(databasePath)}.operation-lock`);
  const existing = held.get(lockPath);
  if (existing) {
    if (options.exclusive) throw new Error("Close the active OneAgent runtime before creating a backup.");
    existing.users += 1;
    return releaseHandle(lockPath, existing.token);
  }
  const token = randomUUID();
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  while (true) {
    let descriptor: number;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`OneAgent memory is busy: ${lockPath}. Retry after other operations finish. After a crash, remove this lock only after verifying that all OneAgent processes have stopped.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      continue;
    }
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
    } catch (error) {
      fs.unlinkSync(lockPath);
      throw error;
    } finally {
      fs.closeSync(descriptor);
    }
    held.set(lockPath, { token, users: 1 });
    return releaseHandle(lockPath, token);
  }
}

function releaseHandle(lockPath: string, token: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = held.get(lockPath);
    if (!current || current.token !== token || --current.users > 0) return;
    held.delete(lockPath);
    try {
      const owner = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { token?: string };
      if (owner.token === token) fs.unlinkSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}
