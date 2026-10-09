import { createHash } from "node:crypto";

/** A bounded response, with a cursor to every remaining character. Offsets use
 * JavaScript UTF-16 indices and must be taken from nextOffset, not guessed. */
export function readTextSection(text: string, input: { offset?: number; maxChars?: number; revision?: string } = {}) {
  const offset = input.offset ?? 0, maxChars = input.maxChars ?? 32000;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error("Invalid document offset. Read from offset 0 after a revision change.");
  if (!Number.isSafeInteger(maxChars) || maxChars < 500 || maxChars > 200000) throw new Error("maxChars must be between 500 and 200000.");
  const revision = createHash("sha256").update(text).digest("hex");
  if (input.revision && input.revision !== revision) throw new Error("Document changed since the previous section. Read again from offset 0.");
  let end = Math.min(text.length, offset + maxChars);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  const nextOffset = end < text.length ? end : null;
  return { content: text.slice(offset, end), offset, nextOffset, totalChars: text.length, revision, truncated: nextOffset !== null };
}
