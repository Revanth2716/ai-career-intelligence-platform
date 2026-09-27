import { InvertedIndex, tokenize, type IndexedDoc } from './inverted-index.js';
import { MinHeap } from './min-heap.js';

/**
 * BM25 (Okapi) lexical scorer over a hand-built inverted index.
 *
 *   score(q, d) = Σ_t IDF(t) · tf(t,d)·(k1+1) / (tf(t,d) + k1·(1−b+b·|d|/avgdl))
 *   IDF(t)      = ln(1 + (N − df + 0.5) / (df + 0.5))
 *
 * Top-k uses a bounded min-heap: O(m log k) where m = matching postings,
 * instead of sorting all matches.
 */
export interface Bm25Params {
  k1: number; // term-frequency saturation (1.2–2.0 typical)
  b: number; // length normalisation (0 = none, 1 = full)
}

export interface ScoredDoc {
  docId: string;
  score: number;
}

const DEFAULT_PARAMS: Bm25Params = { k1: 1.5, b: 0.75 };

export class Bm25Index {
  private index = new InvertedIndex();
  private params: Bm25Params;

  constructor(params?: Partial<Bm25Params>) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  addDocument(doc: IndexedDoc): void {
    this.index.addDocument(doc);
  }

  removeDocument(docId: string): void {
    this.index.removeDocument(docId);
  }

  get docCount(): number {
    return this.index.docCount;
  }

  /** Score `query` against all indexed docs, return the top-k by BM25. */
  search(query: string, topK = 10): ScoredDoc[] {
    const terms = tokenize(query);
    if (terms.length === 0 || this.index.docCount === 0) return [];

    const n = this.index.docCount;
    const avgdl = this.index.avgDocLength || 1;
    const { k1, b } = this.params;

    // Accumulate partial scores per doc, one query term at a time.
    const scores = new Map<string, number>();
    const seen = new Set<string>();
    for (const term of terms) {
      if (seen.has(term)) continue; // query term frequency ignored (standard BM25 simplification)
      seen.add(term);
      const df = this.index.documentFrequency(term);
      if (df === 0) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (const docId of this.index.docIdsForTerm(term)) {
        const tf = this.index.termFrequency(term, docId);
        const dl = this.index.docLength(docId) || 0;
        const denom = tf + k1 * (1 - b + (b * dl) / avgdl);
        const contribution = idf * ((tf * (k1 + 1)) / denom);
        scores.set(docId, (scores.get(docId) ?? 0) + contribution);
      }
    }

    // Bounded min-heap of size topK over all scored docs.
    const heap = new MinHeap<ScoredDoc>((a, c) => a.score - c.score);
    for (const [docId, score] of scores) {
      heap.pushBounded({ docId, score }, topK);
    }
    return heap
      .drain()
      .sort((a, c) => c.score - a.score); // descending
  }
}
