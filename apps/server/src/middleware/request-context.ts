import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns every request a correlation id, exposes it on the response and the
 * request object, and stamps completion time. Log lines and error envelopes
 * reference it so a whole request can be reconstructed from logs.
 */
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 64
      ? incoming
      : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.locals.start = Date.now();
  next();
}

export function getElapsedMs(res: Response): number {
  const start = res.locals['start'] as number | undefined;
  return start === undefined ? 0 : Date.now() - start;
}

export function clientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) {
    return (xf.split(',')[0] ?? '').trim();
  }
  return req.ip ?? 'unknown';
}
