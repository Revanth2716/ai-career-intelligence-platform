import { env } from '../config/env.js';
import { LruCache } from './algorithms/lru-cache.js';
import { RateLimiter } from './algorithms/token-bucket.js';
import { makeLlmProvider, type LlmProvider } from '../ai/provider/llm.js';
import { makeEmbeddingProvider, type EmbeddingProvider } from '../ai/provider/embeddings.js';

/**
 * Manual dependency-injection container.
 *
 * Why manual DI instead of a framework: explicit construction order, zero
 * reflection magic, trivially inspectable wiring — appropriate for a
 * single-process service (rationale in docs/DECISIONS.md).
 */
export interface Container {
  cache: LruCache<string, unknown>;
  rateLimiter: RateLimiter;
  aiRateLimiter: RateLimiter;
  llmProvider: LlmProvider;
  embeddingProvider: EmbeddingProvider;
}

export function createContainer(): Container {
  const cache = new LruCache<string, unknown>({
    maxEntries: 1_000,
    ttlMs: 15 * 60 * 1000,
  });

  return {
    cache,
    rateLimiter: new RateLimiter({
      capacity: env.RATE_LIMIT_MAX,
      refillPerSec: env.RATE_LIMIT_MAX / env.RATE_LIMIT_WINDOW_SEC,
    }),
    aiRateLimiter: new RateLimiter({
      capacity: env.AI_RATE_LIMIT_MAX,
      refillPerSec: env.AI_RATE_LIMIT_MAX / env.AI_RATE_LIMIT_WINDOW_SEC,
    }),
    llmProvider: makeLlmProvider(),
    embeddingProvider: makeEmbeddingProvider(),
  };
}

/** Process-wide singleton (overridable in tests). */
let globalContainer: Container | undefined;

export function getContainer(): Container {
  if (globalContainer === undefined) globalContainer = createContainer();
  return globalContainer;
}

export function setContainer(c: Container | undefined): void {
  globalContainer = c;
}
