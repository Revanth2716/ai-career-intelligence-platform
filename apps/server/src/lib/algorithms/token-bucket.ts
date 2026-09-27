/**
 * Token-bucket rate limiter.
 *
 * Capacity b, refill rate r tokens/sec: allows short bursts up to b while
 * sustaining an average of r req/sec. `take()` is O(1) and lock-free per
 * bucket (single-threaded event loop).
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSec: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private options: TokenBucketOptions) {
    this.tokens = options.capacity;
    this.lastRefill = Date.now();
  }

  /** Try to consume `n` tokens. Returns false + retry hint when empty. */
  take(n = 1): { allowed: boolean; retryAfterSec: number } {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return { allowed: true, retryAfterSec: 0 };
    }
    const deficit = n - this.tokens;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(deficit / this.options.refillPerSec)) };
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.options.capacity, this.tokens + elapsedSec * this.options.refillPerSec);
    this.lastRefill = now;
  }
}

/** Per-key bucket registry with periodic cleanup of idle buckets. */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private lastUsed = new Map<string, number>();

  constructor(
    private options: TokenBucketOptions,
    private cleanupAfterMs = 30 * 60 * 1000,
  ) {}

  take(key: string, n = 1): { allowed: boolean; retryAfterSec: number } {
    let bucket = this.buckets.get(key);
    const now = Date.now();
    if (bucket === undefined) {
      bucket = new TokenBucket(this.options);
      this.buckets.set(key, bucket);
      // Opportunistic cleanup keeps memory bounded behind untrusted keys (IPs).
      if (this.buckets.size % 100 === 0) this.cleanup(now);
    }
    this.lastUsed.set(key, now);
    return bucket.take(n);
  }

  private cleanup(now: number): void {
    for (const key of this.buckets.keys()) {
      const last = this.lastUsed.get(key) ?? 0;
      if (now - last > this.cleanupAfterMs) {
        this.buckets.delete(key);
        this.lastUsed.delete(key);
      }
    }
  }
}
