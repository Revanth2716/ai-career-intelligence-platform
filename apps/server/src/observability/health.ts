import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';

/** Liveness: process is up. */
export function healthHandler(): RequestHandler {
  return (_req, res) => {
    res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
  };
}

/** Readiness: dependencies reachable (DB ping). */
export function readyHandler(): RequestHandler {
  return async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch (err) {
      next(err);
    }
  };
}
