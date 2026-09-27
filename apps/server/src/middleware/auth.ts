import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuthError, ForbiddenError } from '../lib/errors.js';

export interface AuthPayload {
  userId: string;
  role: 'USER' | 'ADMIN';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

/**
 * Verifies the Bearer access token (HS256, alg pinned) and attaches the
 * decoded payload to req.auth. Ownership checks stay in the service layer.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    next(new AuthError());
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    const { sub, role } = decoded as { sub?: unknown; role?: unknown };
    if (typeof sub !== 'string' || (role !== 'USER' && role !== 'ADMIN')) {
      throw new AuthError('Invalid token payload');
    }
    req.auth = { userId: sub, role };
    next();
  } catch {
    next(new AuthError('Invalid or expired access token'));
  }
};

/** Role gate — use after requireAuth. */
export function requireRole(...roles: AuthPayload['role'][]): RequestHandler {
  return (req, _res, next) => {
    if (req.auth === undefined) {
      next(new AuthError());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new ForbiddenError('Insufficient role'));
      return;
    }
    next();
  };
}
