/**
 * Reciprocal Rank Fusion (RRF): merge multiple ranked lists (e.g. BM25
 * lexical + pgvector semantic) into one robust ranking.
 *
 *   RRF(d) = Σ_lists  w_i / (k + rank_i(d))     with k ≈ 60 (canonical)
 *
 * RRF is used instead of raw score mixing because BM25 and cosine similarity
 * live on incomparable scales; ranks do not.
 */

export interface RankedItem<T> {
  item: T;
  rank: number; // 1-based rank in its list
  weight: number;
}

export interface FusedItem<T> {
  item: T;
  score: number;
  /** ranks of the item in each input list (null when absent) */
  sourceRanks: (number | null)[];
}

export function reciprocalRankFusion<T>(
  rankedLists: T[][],
  options: { k?: number; weights?: number[] } = {},
): FusedItem<T>[] {
  const k = options.k ?? 60;
  const weights = options.weights ?? rankedLists.map(() => 1);

  const scores = new Map<T, { score: number; ranks: (number | null)[] }>();

  rankedLists.forEach((list, listIdx) => {
    const weight = weights[listIdx] ?? 1;
    list.forEach((item, position) => {
      const rank = position + 1;
      const contribution = weight / (k + rank);
      const entry = scores.get(item);
      if (entry) {
        entry.score += contribution;
        entry.ranks[listIdx] = rank;
      } else {
        const ranks: (number | null)[] = rankedLists.map(() => null);
        ranks[listIdx] = rank;
        scores.set(item, { score: contribution, ranks });
      }
    });
  });

  return [...scores.entries()]
    .map(([item, { score, ranks }]) => ({ item, score, sourceRanks: ranks }))
    .sort((a, b) => b.score - a.score);
}
