import type { JobSearchHit } from '@career/shared';
import { prisma } from '../lib/prisma.js';
import { retrieveChunks } from '../ai/rag/retrieve.js';
import { Bm25Index } from '../lib/algorithms/bm25.js';
import { reciprocalRankFusion } from '../lib/algorithms/rrf.js';
import { cacheService } from './cache.service.js';
import { getContainer } from '../lib/container.js';

/**
 * Hybrid job search: pgvector semantic retrieval + BM25 lexical ranking,
 * fused with Reciprocal Rank Fusion.
 *
 * Why hybrid: vectors capture "backend python" ≈ "server-side development",
 * BM25 captures exact keywords ("kubernetes") that embeddings may dilute.
 * The BM25 index is rebuilt per query from the candidate set (k * 4 jobs) —
 * cheap at this scale and keeps the in-memory index coherent with Postgres.
 */

const WEIGHTS = { vector: 0.6, lexical: 0.4 };

interface SearchHitWithSimilarity extends JobSearchHit {
  similarity: number;
}

export const searchService = {
  async search(userId: string, query: string, k = 8): Promise<JobSearchHit[]> {
    const cacheKey = `search:${userId}:${query.trim().toLowerCase()}`;
    const cached = cacheService.get<JobSearchHit[]>(cacheKey);
    if (cached !== undefined) return cached;

    // 1) Semantic candidates via pgvector (user-scoped).
    const semanticChunks = await retrieveChunks(query, k * 4, undefined);

    // 2) Restrict to this user's jobs + fetch metadata for lexical scoring.
    const jobIds = [...new Set(semanticChunks.map((c) => c.jobId))];
    const jobs = jobIds.length > 0
      ? await prisma.job.findMany({
          where: { id: { in: jobIds }, userId },
          select: { id: true, title: true, company: true, location: true },
        })
      : [];

    // Lexical ranking over the same candidate pool (BM25 from scratch).
    const bm25 = new Bm25Index();
    const jobTexts = await prisma.jobEmbedding.findMany({
      where: { jobId: { in: jobs.map((j) => j.id) } },
      select: { jobId: true, content: true },
    });
    for (const jt of jobTexts) {
      bm25.addDocument({ id: jt.jobId, text: jt.content });
    }
    const lexical = bm25.search(query, k * 2);

    // 3) Reciprocal Rank Fusion of both ranked lists.
    const vectorRankByJob = new Map<string, number>();
    for (let i = 0; i < semanticChunks.length; i++) {
      const c = semanticChunks[i];
      if (c === undefined) continue;
      if (!vectorRankByJob.has(c.jobId)) vectorRankByJob.set(c.jobId, i + 1);
    }
    const lexicalRankByJob = new Map<string, number>();
    lexical.forEach((sd, i) => lexicalRankByJob.set(sd.docId, i + 1));

    const fused = reciprocalRankFusion(
      [[...vectorRankByJob.keys()], [...lexicalRankByJob.keys()]],
      { weights: [WEIGHTS.vector, WEIGHTS.lexical] },
    );

    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const chunksByJob = new Map<string, string[]>();
    for (const c of semanticChunks) {
      const list = chunksByJob.get(c.jobId) ?? [];
      list.push(c.content);
      chunksByJob.set(c.jobId, list);
    }

    const candidates = fused
      .map((f): SearchHitWithSimilarity | null => {
        const job = jobById.get(f.item);
        if (job === undefined) return null;
        const vecRank = vectorRankByJob.get(f.item) ?? null;
        const lexRank = lexicalRankByJob.get(f.item) ?? null;
        const similarity = semanticChunks.find((c) => c.jobId === f.item)?.similarity ?? 0;
        const snippet = (chunksByJob.get(f.item)?.[0] ?? '').slice(0, 220);
        return {
          jobId: f.item,
          title: job.title,
          company: job.company,
          location: job.location,
          score: Number((f.score * 1000).toFixed(4)),
          snippet,
          lexicalRank: lexRank,
          vectorRank: vecRank,
          similarity,
        };
      })
      .filter((h): h is SearchHitWithSimilarity => h !== null)
      .slice(0, k)
      .map(({ similarity: _similarity, ...rest }) => rest);

    const hits: JobSearchHit[] = candidates;

    cacheService.set(cacheKey, hits);
    return hits;
  },
};
