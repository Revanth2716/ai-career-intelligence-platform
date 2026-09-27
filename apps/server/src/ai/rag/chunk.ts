/**
 * Text chunking for embeddings. ~800-token chunks with overlap keeps each
 * embedded unit semantically coherent while fitting embedding-model limits.
 *
 * Invariant: every chunk's content is <= charTarget characters. Paragraph
 * boundaries are preferred split points, then sentences; a single oversized
 * sentence is hard-split into overlapping windows.
 */
export interface Chunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

export function chunkText(text: string, targetTokens = 800, overlapTokens = 100): Chunk[] {
  // ~4 chars per token (English prose) — conservative to stay under limits.
  const charTarget = targetTokens * 4;
  const charOverlap = overlapTokens * 4;

  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    current = trimmed.slice(-charOverlap); // carry overlap into the next chunk
  };

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  for (const para of paragraphs) {
    const pieces: string[] =
      para.length > charTarget ? para.split(/(?<=[.!?])\s+/).flatMap((s) => hardSplit(s, charTarget, charOverlap)) : [para];

    for (const piece of pieces) {
      if (current.length + piece.length + 1 > charTarget) flush();
      current = current.length === 0 ? piece : `${current}\n${piece}`;
    }
  }
  const tail = current.trim();
  if (tail.length > 0) chunks.push(tail);

  return chunks.map((content, index) => ({ index, content, tokenEstimate: estimateTokens(content) }));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split an oversized string into windows of at most `maxChars` with overlap. */
function hardSplit(text: string, maxChars: number, overlapChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const step = Math.max(1, maxChars - overlapChars);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) {
    out.push(text.slice(i, i + maxChars));
    if (i + maxChars >= text.length) break;
  }
  return out;
}
