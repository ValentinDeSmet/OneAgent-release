import fs from "node:fs";
import path from "node:path";

export function copyStableDatabase(source: string, temporaryRoot: string): string {
  const signature = (file: string): string | null => {
    try {
      const stat = fs.statSync(file, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const suffixes = ["", "-wal", "-journal"];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = suffixes.map((suffix) => signature(source + suffix));
    // A rollback journal requires recovery, outside a read-only inventory.
    if (!before[0] || before[2]) throw new Error("Database is absent or has an active rollback journal.");
    const target = path.join(temporaryRoot, `snapshot-${attempt}.db`);
    fs.copyFileSync(source, target);
    try {
      if (before[1]) fs.copyFileSync(source + "-wal", target + "-wal");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const after = suffixes.map((suffix) => signature(source + suffix));
    if (before.every((value, index) => value === after[index])) return target;
  }
  throw new Error("Database changed during inventory; retry when writes are idle.");
}
