import OpenAI from 'openai';
import { env, features } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Embedding provider port. Embeddings power semantic search and RAG
 * retrieval. Vector dimension is configurable (env EMBEDDING_DIM) to match
 * the pgvector column created by migration SQL.
 */
export interface EmbeddingRequest {
  inputs: string[];
  model?: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(inputs: string[]): Promise<number[][]>;
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model = env.EMBEDDING_MODEL;
  readonly dimensions = env.EMBEDDING_DIM;
  private client: OpenAI;

  constructor(apiKey: string, baseUrl: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.name = `openai-embeddings(${baseUrl})`;
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    // Batched: one request for all chunks of a job (cost + latency win).
    const res = await this.client.embeddings.create({
      model: env.EMBEDDING_MODEL,
      input: inputs,
      dimensions: env.EMBEDDING_DIM, // text-embedding-3 supports truncation
    });
    return res.data.map((d) => d.embedding as number[]);
  }
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock-embeddings';
  readonly model = 'mock-embedding';
  readonly dimensions = env.EMBEDDING_DIM;

  async embed(inputs: string[]): Promise<number[][]> {
    // Deterministic hashed bag-of-words embedding: stable across runs so
    // semantic search behaves consistently offline, and vector(math) works.
    return inputs.map((text) => {
      const vec = new Array<number>(this.dimensions).fill(0);
      const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
      for (const tok of tokens) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) {
          h ^= tok.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        const idx = Math.abs(h) % this.dimensions;
        vec[idx] = (vec[idx] ?? 0) + 1;
      }
      // L2-normalise so cosine similarity is a plain dot product.
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
  }
}

export function makeEmbeddingProvider(): EmbeddingProvider {
  if (features.useRealLlm) {
    logger.info({ model: env.EMBEDDING_MODEL }, 'Embedding provider: openai-compatible');
    return new OpenAiEmbeddingProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL);
  }
  logger.info('Embedding provider: mock');
  return new MockEmbeddingProvider();
}
