import { describe, expect, it, vi } from 'vitest';
import {
  MinHeap,
  LruCache,
  RateLimiter,
  InvertedIndex,
  Bm25Index,
  reciprocalRankFusion,
  tokenize,
} from '../../lib/algorithms/index.js';

describe('MinHeap', () => {
  it('pops in ascending order', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    for (const n of [5, 3, 8, 1, 9, 2]) heap.push(n);
    expect(heap.drain()).toEqual([1, 2, 3, 5, 8, 9]);
  });

  it('pushBounded keeps the k largest — bounded top-k in O(n log k) (evicts the minimum)', () => {
    const heap = new MinHeap<number>((a, b) => a - b);
    for (const n of [9, 7, 5, 3, 1]) heap.pushBounded(n, 3);
    // Root is the worst of the kept set, so overflow pops the smallest —
    // exactly what BM25 top-k needs (keep the k highest scores).
    expect(heap.drain()).toEqual([5, 7, 9]);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry beyond capacity', () => {
    const cache = new LruCache<string, number>({ maxEntries: 2, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh a
    cache.set('c', 3); // evicts b
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('expires entries after ttl', () => {
    vi.useFakeTimers();
    const cache = new LruCache<string, number>({ maxEntries: 2, ttlMs: 50 });
    cache.set('k', 1);
    vi.advanceTimersByTime(60);
    expect(cache.get('k')).toBeUndefined();
    vi.useRealTimers();
  });

  it('tracks hit/miss stats', () => {
    const cache = new LruCache<string, number>({ maxEntries: 4, ttlMs: 60_000 });
    cache.get('x');
    cache.set('x', 1);
    cache.get('x');
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});

describe('RateLimiter (token bucket)', () => {
  it('allows bursts up to capacity then throttles', () => {
    const limiter = new RateLimiter({ capacity: 3, refillPerSec: 0.001 });
    expect(limiter.take('ip1').allowed).toBe(true);
    expect(limiter.take('ip1').allowed).toBe(true);
    expect(limiter.take('ip1').allowed).toBe(true);
    const blocked = limiter.take('ip1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('keys are independent', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 0.001 });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
  });

  it('refills over time', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    expect(limiter.take('x').allowed).toBe(true);
    vi.advanceTimersByTime(1100);
    expect(limiter.take('x').allowed).toBe(true);
    vi.useRealTimers();
  });
});

describe('InvertedIndex + tokenize', () => {
  it('tokenizes, lowercases and removes stopwords', () => {
    expect(tokenize('The Quick-Brown Fox! A C++ developer')).toEqual([
      'quick',
      'brown',
      'fox',
      'c++',
      'developer',
    ]);
  });

  it('indexes documents and answers term/doc queries', () => {
    const idx = new InvertedIndex();
    idx.addDocument({ id: '1', text: 'python backend rest api' });
    idx.addDocument({ id: '2', text: 'react frontend typescript' });
    expect(idx.docCount).toBe(2);
    expect(idx.termFrequency('python', '1')).toBe(1);
    expect(idx.documentFrequency('react')).toBe(1);
    expect([...idx.docIdsForTerm('react')]).toEqual(['2']);
    idx.removeDocument('1');
    expect(idx.hasDocument('1')).toBe(false);
  });
});

describe('Bm25Index', () => {
  it('ranks documents containing the query terms higher', () => {
    const bm25 = new Bm25Index();
    bm25.addDocument({ id: 'python-job', text: 'python backend developer rest api sql' });
    bm25.addDocument({ id: 'react-job', text: 'react frontend developer typescript css' });
    bm25.addDocument({ id: 'mixed-job', text: 'python react developer fullstack' });
    const results = bm25.search('python rest', 3);
    expect(results[0]?.docId).toBe('python-job');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty for unmatched terms', () => {
    const bm25 = new Bm25Index();
    bm25.addDocument({ id: 'a', text: 'alpha beta' });
    expect(bm25.search('zebra', 5)).toEqual([]);
  });
});

describe('reciprocalRankFusion', () => {
  it('fuses lists and rewards agreement across lists', () => {
    const fused = reciprocalRankFusion<string>(
      [
        ['a', 'b', 'c'],
        ['b', 'a', 'd'],
      ],
      { k: 60 },
    );
    expect(fused[0]?.item === 'a' || fused[0]?.item === 'b').toBe(true);
    expect(fused.length).toBe(4);
    expect(fused.find((f) => f.item === 'd')?.sourceRanks[1]).toBe(3);
  });

  it('applies weights', () => {
    const fused = reciprocalRankFusion<string>([['a'], ['a', 'b']], { k: 60, weights: [1, 0] });
    // 'a' only gets a contribution from list 0.
    expect(fused[0]?.item).toBe('a');
  });
});
