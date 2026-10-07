/**
 * Text tokenisation + inverted index (term → postings).
 * Foundation for the BM25 lexical scorer. Deliberately hand-rolled to
 * demonstrate the data structure; at production scale this would be Postgres
 * FTS or an external search engine.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'you', 'your', 'we', 'our', 'this', 'these', 'those',
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/i)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface IndexedDoc {
  id: string;
  text: string;
}

export class InvertedIndex {
  /** term → (docId → term frequency) */
  private index = new Map<string, Map<string, number>>();
  private docLengths = new Map<string, number>();
  private totalLength = 0;

  get docCount(): number {
    return this.docLengths.size;
  }

  get avgDocLength(): number {
    return this.docCount === 0 ? 0 : this.totalLength / this.docCount;
  }

  addDocument(doc: IndexedDoc): void {
    this.removeDocument(doc.id);
    const tokens = tokenize(doc.text);
    this.docLengths.set(doc.id, tokens.length);
    this.totalLength += tokens.length;
    for (const term of tokens) {
      let postings = this.index.get(term);
      if (postings === undefined) {
        postings = new Map();
        this.index.set(term, postings);
      }
      postings.set(doc.id, (postings.get(doc.id) ?? 0) + 1);
    }
  }

  removeDocument(docId: string): void {
    const len = this.docLengths.get(docId);
    if (len === undefined) return;
    this.totalLength -= len;
    this.docLengths.delete(docId);
    for (const [term, postings] of this.index) {
      if (postings.delete(docId) && postings.size === 0) this.index.delete(term);
    }
  }

  hasDocument(docId: string): boolean {
    return this.docLengths.has(docId);
  }

  documentFrequency(term: string): number {
    return this.index.get(term)?.size ?? 0;
  }

  termFrequency(term: string, docId: string): number {
    return this.index.get(term)?.get(docId) ?? 0;
  }

  /** Document ids containing `term` (postings keys). */
  docIdsForTerm(term: string): Iterable<string> {
    return this.index.get(term)?.keys() ?? [];
  }

  /** Stored token count for a document. */
  docLength(docId: string): number | undefined {
    return this.docLengths.get(docId);
  }

  /** All terms in the vocabulary (for diagnostics/tests). */
  vocabulary(): string[] {
    return [...this.index.keys()].sort();
  }
}
