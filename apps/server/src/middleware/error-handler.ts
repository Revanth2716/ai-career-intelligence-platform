import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, RateLimitError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getElapsedMs } from './request-context.js';

/**
 * Single global error handler. Domain errors map to their status codes,
 * ZodErrors to 422 with flattened issues, everything else to a sanitized 500
 * (no stack traces leaked). Every envelope carries the correlation id.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? 'unknown';
  const elapsed = getElapsedMs(res);

  const envelope = (error: string, code: string, details?: unknown) => ({
    error,
    code,
    details,
    requestId,
  });

  if (err instanceof RateLimitError) {
    res.setHeader('Retry-After', String(err.retryAfterSec));
  }

  if (err instanceof AppError) {
    logger.warn({ requestId, code: err.code, msg: err.message, elapsedMs: elapsed }, 'request_failed');
    res.status(err.statusCode).json(envelope(err.message, err.code, err.details));
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json(envelope('Validation failed', 'VALIDATION_ERROR', err.flatten()));
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(envelope('Malformed JSON body', 'MALFORMED_JSON'));
    return;
  }

  // Unknown errors — log full detail server-side, return sanitized envelope.
  logger.error({ requestId, err, elapsedMs: elapsed }, 'unhandled_error');
  res.status(500).json(envelope('Internal server error', 'INTERNAL_ERROR'));
}
