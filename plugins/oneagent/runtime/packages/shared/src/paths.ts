import fs from "node:fs";
import path from "node:path";

export function normalizePath(value: string): string {
  return path.resolve(value);
}

/**
 * Write a file atomically: write to a sibling .tmp file, then rename over the target.
 * A rename is atomic on the same filesystem, so a crash never leaves a half-written capture.
 */
export function atomicWriteFile(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  const handle = fs.openSync(tempPath, "w");
  try {
    fs.writeSync(handle, content);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tempPath, filePath);
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Resolve existing ancestors as well as symlinks above a not-yet-created leaf. */
export function resolvePhysicalPath(value: string): string {
  let current = path.resolve(value);
  const missing: string[] = [];
  while (true) {
    try {
      fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
      continue;
    }
    // Resolve outside the ENOENT handler: a dangling symlink is not a missing leaf.
    return path.join(fs.realpathSync(current), ...missing);
  }
}
