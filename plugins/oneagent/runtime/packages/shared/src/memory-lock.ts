import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const held = new Map<string, { token: string; users: number }>();
const pause = new Int32Array(new SharedArrayBuffer(4));
interface Owner { pid: number; token: string; createdAt: string; hostname?: string }
interface Lock { owner: Owner; dev: number; ino: number }

/** Serialize database + Markdown operations across local hosts, never across an idle session. */
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
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (true) {
    let descriptor: number;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lock = readLock(lockPath);
      if (lock && recoverStoppedOwner(lockPath, lock)) continue;
      if (Date.now() >= deadline) {
        const owner = lock ? ` Owner: PID ${lock.owner.pid}${lock.owner.hostname ? ` on ${lock.owner.hostname}` : ""}, since ${lock.owner.createdAt}.` : " The lock owner could not be verified.";
        throw new Error(`OneAgent memory is busy: ${lockPath}.${owner} Another operation may still be running; wait for it to finish and retry. Both plugins can share this local memory. If the problem persists, restart both OneAgent hosts and check that both plugins are up to date. An unverifiable lock is preserved for diagnosis.`);
      }
      Atomics.wait(pause, 0, 0, 25);
      continue;
    }
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString(), hostname: os.hostname() }));
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

function readLock(lockPath: string): Lock | undefined {
  let descriptor: number | undefined;
  try {
    if (!fs.lstatSync(lockPath).isFile()) return;
    descriptor = fs.openSync(lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 4096) return;
    const owner = JSON.parse(fs.readFileSync(descriptor, "utf8")) as Owner;
    if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.token !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(owner.token) ||
      typeof owner.createdAt !== "string" || !Number.isFinite(Date.parse(owner.createdAt)) ||
      (owner.hostname !== undefined && (typeof owner.hostname !== "string" || !owner.hostname))) return;
    return { owner, dev: stat.dev, ino: stat.ino };
  } catch {
    // An incomplete, legacy-unrecognizable or inaccessible lock must never be stolen.
    return;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isStopped(owner: Owner): boolean {
  // Older OneAgent locks have no hostname and were intended for a local folder only.
  if (owner.hostname !== undefined && owner.hostname !== os.hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

function recoverStoppedOwner(lockPath: string, candidate: Lock): boolean {
  if (!isStopped(candidate.owner)) return false;
  // Serialize recovery of this exact owner. Without this claim, two waiters could
  // both observe a dead PID and the second could unlink the first waiter's new lock.
  const claim = `${lockPath}.recover-${candidate.owner.token}`;
  try { fs.mkdirSync(claim, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    const current = readLock(lockPath);
    if (!current || current.owner.token !== candidate.owner.token || current.dev !== candidate.dev || current.ino !== candidate.ino || !isStopped(current.owner)) return false;
    fs.unlinkSync(lockPath);
    return true;
  } finally {
    // A crash during recovery leaves the claim in place: fail closed, never guess.
    fs.rmdirSync(claim);
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
    const lock = readLock(lockPath);
    if (lock?.owner.token === token) fs.unlinkSync(lockPath);
  };
}
