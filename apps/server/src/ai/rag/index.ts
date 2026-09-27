import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { getContainer } from '../../lib/container.js';
import { chunkText } from './chunk.js';

/**
 * Embedding indexer: chunk a job's raw text, embed all chunks in one batched
 * provider call, then replace existing vectors atomically (delete + raw
 * inserts in one interactive transaction).
 *
 * The `vector` column is a Prisma `Unsupported` type (pgvector), so inserts
 * go through parameterised raw SQL — the vector literal is generated from a
 * numeric array, never from user input.
 */
export async function indexJobEmbeddings(jobId: string, rawText: string): Promise<number> {
  const provider = getContainer().embeddingProvider;
  const chunks = chunkText(rawText);
  if (chunks.length === 0) return 0;

  const vectors = await provider.embed(chunks.map((c) => c.content));
  if (vectors.length !== chunks.length) {
    throw new Error(`Embedding provider returned ${vectors.length} vectors for ${chunks.length} chunks`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.jobEmbedding.deleteMany({ where: { jobId } });
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors[i];
      if (chunk === undefined || vector === undefined) continue;
      await tx.$executeRaw`
        INSERT INTO "JobEmbedding" ("id", "jobId", "chunkIndex", "content", "vector", "model", "tokenCount")
        VALUES (
          ${crypto.randomUUID()}::text,
          ${jobId}::text,
          ${chunk.index}::int,
          ${chunk.content}::text,
          ${vectorLiteral(vector)}::vector,
          ${provider.model}::text,
          ${chunk.tokenEstimate}::int
        )
      `;
    }
  });
  return chunks.length;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
