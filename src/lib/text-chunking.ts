import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS } from "@/lib/rag-config";

export type TextChunk = {
  content: string;
  index: number;
  estimatedTokens: number;
};

function splitOversizedParagraph(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_TARGET_CHARS) return [paragraph];

  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    if (sentence.length > CHUNK_TARGET_CHARS) {
      if (current) pieces.push(current);
      current = "";

      let remainder = sentence;
      while (remainder.length > CHUNK_TARGET_CHARS) {
        const maxPieceChars = CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS;
        let cut = remainder.lastIndexOf(" ", maxPieceChars);
        if (cut < maxPieceChars / 2) cut = maxPieceChars;
        pieces.push(remainder.slice(0, cut).trim());
        remainder = remainder.slice(cut).trim();
      }
      current = remainder;
      continue;
    }

    if (current && current.length + sentence.length + 1 > CHUNK_TARGET_CHARS) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Split on paragraph/sentence boundaries, then keep a short tail from the
 * previous chunk so a fact at a boundary is visible to both chunks. We use
 * chars / 4 as a portable token estimate; the embedding model's tokenizer can
 * differ, so the playground labels this count as an estimate.
 */
export function chunkText(input: string): TextChunk[] {
  const normalized = input
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitOversizedParagraph);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && candidate.length > CHUNK_TARGET_CHARS) {
      chunks.push(current.trim());
      const overlap = current.slice(-CHUNK_OVERLAP_CHARS).trim();
      current =
        overlap && overlap.length + paragraph.length + 2 <= CHUNK_TARGET_CHARS
          ? `${overlap}\n\n${paragraph}`
          : paragraph;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.map((content, index) => ({
    content,
    index,
    estimatedTokens: Math.ceil(content.length / 4),
  }));
}
