import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { metricsMiddleware, registry } from './observability/metrics.js';
import { healthHandler, readyHandler } from './observability/health.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { resumeRouter } from './modules/resumes/resume.routes.js';
import { jobRouter } from './modules/jobs/job.routes.js';
import { matchRouter } from './modules/matching/match.routes.js';
import { agentRouter } from './modules/agents/agent.routes.js';
import { costRouter } from './observability/costs.js';
import { queue } from './jobs/queue.js';
import { logger } from './lib/logger.js';
import { resumeService } from './modules/resumes/resume.service.js';
import { jobService } from './services/job.service.js';
import { prisma } from './lib/prisma.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind nginx in prod
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);
  app.use(metricsMiddleware());
  app.use(rateLimit());

  // ── Observability endpoints (unauthenticated; scrape-internal) ──
  app.get('/health', healthHandler());
  app.get('/ready', readyHandler());
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  // ── API v1 ──
  const api = express.Router();
  api.use('/auth', authRouter);
  api.use('/resumes', resumeRouter);
  api.use('/jobs', jobRouter);
  api.use('/matches', matchRouter);
  api.use('/agents', agentRouter);
  api.use('/costs', costRouter);
  app.use('/api/v1', api);

  // 404 for unknown API routes (before error handler).
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  // ── Background worker + dead-letter handling ──
  queue.register('parse-resume', async (payload) => {
    const resumeId = payload['resumeId'] as string | undefined;
    if (resumeId === undefined) return;
    try {
      await resumeService.runParse(resumeId);
    } catch (err) {
      await resumeService.markFailed(resumeId);
      throw err;
    }
  });
  queue.register('parse-job', async (payload) => {
    const jobId = payload['jobId'] as string | undefined;
    if (jobId === undefined) return;
    await jobService.runParse(jobId);
  });
  queue.setDeadLetterHandler(async (task) => {
    const resumeId = task.payload['resumeId'];
    const jobId = task.payload['jobId'];
    if (task.name === 'parse-resume' && typeof resumeId === 'string') {
      await resumeService.markFailed(resumeId).catch(() => undefined);
    }
    if (task.name === 'parse-job' && typeof jobId === 'string') {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED' } }).catch(() => undefined);
    }
  });
  queue.start();
  logger.info('background queue started');

  return app;
}
