import { Router } from 'express';
import { CreateAgentRunSchema } from '@career/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { runAgent, type AgentEvent } from '../../agents/runner.js';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';

export const agentRouter = Router();

agentRouter.use(requireAuth);

/**
 * POST /agents/runs — starts an agent run and streams events as SSE.
 * Body: { kind, jobId?, question? }
 */
agentRouter.post(
  '/runs',
  aiRateLimit(),
  validate({ body: CreateAgentRunSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as { kind: 'RESEARCH_JOB' | 'VERIFY_COMPANY'; jobId?: string; question?: string };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: open\ndata: {}\n\n`);

    const emit = (event: AgentEvent): void => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runAgent({ userId: req.auth!.userId, ...input }, emit);
    } catch (err) {
      // runAgent already emitted 'error'; ensure the stream closes cleanly.
      emit({ type: 'error', message: String(err) });
    } finally {
      res.end();
    }
  }),
);

agentRouter.get(
  '/runs/:id',
  asyncHandler(async (req, res) => {
    const run = await prisma.agentRun.findFirst({
      where: { id: req.params['id'] ?? '', userId: req.auth!.userId },
    });
    if (run === null) throw new NotFoundError('Agent run');
    res.json(run);
  }),
);

agentRouter.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const items = await prisma.agentRun.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    res.json({ items });
  }),
);
