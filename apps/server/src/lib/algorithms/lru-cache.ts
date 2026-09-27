/**
 * LRU + TTL cache.
 *
 * Implementation note: JS `Map` iterates in insertion order, so moving an
 * entry to the end on access gives the same O(1) behaviour as a hand-rolled
 * hash-map + doubly-linked-list, with far less code. Stats expose hit rate
 * for observability (see /metrics).
 */
export interface LruCacheOptions {
  maxEntries: number;
  ttlMs: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<K, V> {
  private map = new Map<K, Entry<V>>();
  private stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(private options: LruCacheOptions) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      this.stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      this.stats.misses += 1;
      return undefined;
    }
    // Refresh recency: re-insert at the tail.
    this.map.delete(key);
    this.map.set(key, entry);
    this.stats.hits += 1;
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.options.ttlMs });
    while (this.map.size > this.options.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
      this.stats.evictions += 1;
    }
  }

  del(key: K): void {
    this.map.delete(key);
  }

  /** Invalidate every entry whose key starts with `prefix` (e.g. "search:"). */
  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of [...this.map.keys()]) {
      if (String(key).startsWith(prefix)) {
        this.map.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.map.clear();
  }

  getStats(): CacheStats {
    return { ...this.stats, size: this.map.size };
  }
}
