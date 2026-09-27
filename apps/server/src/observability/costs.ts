import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { cacheService } from '../services/cache.service.js';
import type { CostSummary } from '@career/shared';

/**
 * GET /costs/summary — aggregated LLM spend (admins see all users; users see
 * their own). Cached for 60s to keep dashboard polling cheap.
 */
export const costRouter = Router();

costRouter.get(
  '/summary',
  requireAuth,
  validate({
    query: z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = (req as Request & { validatedQuery?: Record<string, unknown> }).validatedQuery!;
    const from = q['from'] as string | undefined;
    const to = q['to'] as string | undefined;

    const isAdmin = req.auth!.role === 'ADMIN';
    const cacheKey = `costs:${isAdmin ? 'all' : req.auth!.userId}:${from ?? '0'}:${to ?? 'now'}`;
    const summary = await cacheService.wrap(cacheKey, async (): Promise<CostSummary> => {
      const rows = await prisma.llmCall.groupBy({
        by: ['purpose'],
        where: {
          ...(isAdmin ? {} : { userId: req.auth!.userId }),
          ...(from !== undefined || to !== undefined
            ? { createdAt: { gte: from !== undefined ? new Date(from) : undefined, lte: to !== undefined ? new Date(to) : undefined } }
            : {}),
        },
        _sum: { promptTokens: true, completionTokens: true, costUsd: true },
        _count: { purpose: true },
      });
      const byPurpose = rows.map((r) => ({
        purpose: r.purpose,
        calls: r._count.purpose,
        tokensIn: r._sum.promptTokens ?? 0,
        tokensOut: r._sum.completionTokens ?? 0,
        costUsd: r._sum.costUsd ?? 0,
      }));
      return {
        totalCalls: byPurpose.reduce((s, r) => s + r.calls, 0),
        totalTokensIn: byPurpose.reduce((s, r) => s + r.tokensIn, 0),
        totalTokensOut: byPurpose.reduce((s, r) => s + r.tokensOut, 0),
        totalCostUsd: byPurpose.reduce((s, r) => s + r.costUsd, 0),
        byPurpose,
      };
    });

    res.json(summary);
  }),
);
