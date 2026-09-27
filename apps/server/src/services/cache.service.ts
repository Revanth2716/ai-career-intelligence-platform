import { getContainer } from '../lib/container.js';
import { cacheEvictions, cacheHits, cacheMisses } from '../observability/metrics.js';
import crypto from 'node:crypto';

/**
 * Cache-aside pattern over the in-memory LRU (Redis-swappable via the
 * container interface). Keys are namespaced; `wrap` is the primary entry.
 */
export const cacheService = {
  get<T>(key: string): T | undefined {
    const value = getContainer().cache.get(key) as T | undefined;
    if (value !== undefined) {
      cacheHits.inc();
    } else {
      cacheMisses.inc();
    }
    return value;
  },

  set(key: string, value: unknown): void {
    const before = getContainer().cache.getStats().evictions;
    getContainer().cache.set(key, value);
    const after = getContainer().cache.getStats().evictions;
    if (after > before) cacheEvictions.inc(after - before);
  },

  del(key: string): void {
    getContainer().cache.del(key);
  },

  /** Invalidate every entry whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void {
    getContainer().cache.invalidatePrefix(prefix);
  },

  clear(): void {
    getContainer().cache.clear();
  },

  /** Cache-aside: return cached value or produce, store and return it. */
  async wrap<T>(key: string, producer: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await producer();
    this.set(key, value);
    return value;
  },
};

/** Stable content-hash cache key (e.g. embedding inputs, fetched pages). */
export function contentHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}
