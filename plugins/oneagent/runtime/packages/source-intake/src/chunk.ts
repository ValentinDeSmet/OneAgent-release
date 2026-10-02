import { createStableId, sha256 } from "../../shared/src/index.ts";
import type { SourceChunk } from "../../shared/src/index.ts";

export interface ChunkOptions {
  maxCharacters?: number;
}

interface Section {
  path: string[];
  text: string;
}

/**
 * Heading-aware chunking: the document is split along Markdown headings first, and every
 * chunk is prefixed with its heading path ("Doc › Section › Subsection") so retrieval hits
 * carry their context even when the matching paragraph never names the topic.
 */
export function chunkText(sourceId: string, content: string, options: ChunkOptions = {}): SourceChunk[] {
  const maxCharacters = options.maxCharacters ?? 1600;
  const chunks: string[] = [];

  for (const section of splitIntoSections(content)) {
    const prefix = section.path.length > 0 ? `${section.path.join(" › ")}\n\n` : "";
    const budget = prefix ? Math.max(maxCharacters - prefix.length, 200) : maxCharacters;
    for (const packed of packParagraphs(section.text, budget)) {
      chunks.push(`${prefix}${packed}`);
    }
  }

  return chunks.map((chunk, index) => ({
    id: createStableId("chunk", [sourceId, String(index), sha256(chunk)]),
    sourceId,
    chunkIndex: index,
    content: chunk,
    tokenCount: estimateTokenCount(chunk),
    contentHash: sha256(chunk)
  }));
}

/** Split on ATX headings, tracking the heading stack; fenced code blocks are left intact. */
function splitIntoSections(content: string): Section[] {
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let buffer: string[] = [];
  let inCodeFence = false;

  const flush = (): void => {
    const text = buffer.join("\n").trim();
    if (text) {
      sections.push({ path: stack.map((heading) => heading.title), text });
    }
    buffer = [];
  };

  for (const line of content.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line.trim())) {
      inCodeFence = !inCodeFence;
      buffer.push(line);
      continue;
    }
    const heading = inCodeFence ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, title: heading[2].trim() });
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

function packParagraphs(text: string, maxCharacters: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && `${current}\n\n${paragraph}`.length > maxCharacters) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function estimateTokenCount(content: string): number {
  return Math.ceil(content.trim().split(/\s+/).filter(Boolean).length * 1.25);
}
