import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getContainer } from '../../lib/container.js';
import { cacheService, contentHash } from '../../services/cache.service.js';

/**
 * Semantic retrieval over JobEmbedding vectors (pgvector).
 * Query embeddings are cached by content hash → repeat queries are free.
 */

export interface RetrievedChunk {
  jobId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export async function retrieveChunks(
  query: string,
  k = 8,
  jobScope?: string,
): Promise<RetrievedChunk[]> {
  const embeddingProvider = getContainer().embeddingProvider;
  const cacheKey = `emb:q:${contentHash(query)}`;

  const [queryVec] = await cacheService.wrap(cacheKey, async () => {
    return embeddingProvider.embed([query]);
  });

  if (queryVec === undefined) return [];

  // pgvector cosine distance operator `<=>` (1 − cosine similarity).
  // The vector literal is generated from a numeric array (not user input);
  // jobScope, k are bound parameters via Prisma.sql.
  const scopeCondition =
    jobScope === undefined ? Prisma.sql`TRUE` : Prisma.sql`"jobId" = ${jobScope}`;

  const rows = await prisma.$queryRaw<
    Array<{ jobId: string; chunkIndex: number; content: string; distance: number }>
  >`
    SELECT "jobId", "chunkIndex", content, "vector" <=> ${vectorLiteral(queryVec)}::vector AS distance
    FROM "JobEmbedding"
    WHERE ${scopeCondition}
    ORDER BY distance ASC
    LIMIT ${k}
  `;

  return rows.map((r) => ({
    jobId: r.jobId,
    chunkIndex: Number(r.chunkIndex),
    content: r.content,
    similarity: 1 - Number(r.distance),
  }));
}
