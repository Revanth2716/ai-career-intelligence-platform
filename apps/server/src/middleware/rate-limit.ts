import type { Request, RequestHandler } from 'express';
import { getContainer } from '../lib/container.js';
import { RateLimitError } from '../lib/errors.js';
import { clientIp } from './request-context.js';

/**
 * Token-bucket rate limiting (per IP for global routes, per user for AI
 * routes). Exceeding the bucket returns 429 with Retry-After.
 */
export function rateLimit(): RequestHandler {
  return (req, _res, next) => {
    const { rateLimiter } = getContainer();
    const result = rateLimiter.take(clientIp(req));
    if (!result.allowed) {
      next(new RateLimitError(result.retryAfterSec));
      return;
    }
    next();
  };
}

export function aiRateLimit(): RequestHandler {
  return (req, _res, next) => {
    const { aiRateLimiter } = getContainer();
    const userId = (req as Request & { auth?: { userId: string } }).auth?.userId;
    const key = userId ?? clientIp(req);
    const result = aiRateLimiter.take(key);
    if (!result.allowed) {
      next(new RateLimitError(result.retryAfterSec));
      return;
    }
    next();
  };
}
