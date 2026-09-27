import { Router, type Request } from 'express';
import { z } from 'zod';
import { JobFromUrlSchema, JobCreateSchema, ParsedJobSchema } from '@career/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { jobService } from '../../services/job.service.js';
import { searchService } from '../../services/search.service.js';
import { fetchPageText } from '../../services/fetch-url.service.js';
import { queue } from '../../jobs/queue.js';
import { getContainer } from '../../lib/container.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Job routes. All queries are owner-scoped (users only see their jobs).
 * Search + parse are AI endpoints and get the stricter AI rate limit.
 */
export const jobRouter = Router();

jobRouter.use(requireAuth);

jobRouter.get(
  '/',
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
      company: z.string().max(120).optional(),
      status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = (req as Request & { validatedQuery?: Record<string, unknown> }).validatedQuery!;
    const { items, total } = await jobService.list({
      userId: req.auth!.userId,
      limit: q['limit'] as number,
      offset: q['offset'] as number,
      company: q['company'] as string | undefined,
      status: q['status'] as 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | undefined,
    });
    res.setHeader('X-Total-Count', String(total));
    res.json({ items, total });
  }),
);

jobRouter.post(
  '/',
  validate({ body: JobCreateSchema }),
  asyncHandler(async (req, res) => {
    const created = await jobService.create(req.auth!.userId, { ...req.body, source: 'MANUAL' });
    queue.enqueue('parse-job', { jobId: created.id });
    res.status(201).json({ id: created.id, status: 'PENDING' });
  }),
);

jobRouter.post(
  '/from-url',
  aiRateLimit(),
  validate({ body: JobFromUrlSchema }),
  asyncHandler(async (req, res) => {
    const { url } = req.body as { url: string };

    // Duplicate guard (unique(userId, url) partial-index equivalent logic).
    const existing = await prisma.job.findFirst({
      where: { userId: req.auth!.userId, url },
      select: { id: true },
    });
    if (existing !== null) {
      res.status(409).json({ error: 'This URL is already saved', code: 'CONFLICT', jobId: existing.id });
      return;
    }

    // SSRF-guarded fetch happens here (server-side), then the job is stored.
    const page = await fetchPageText(url);
    const created = await jobService.create(req.auth!.userId, {
      title: page.title.slice(0, 200) || 'Untitled role',
      company: 'Unknown company',
      location: '',
      url: page.url,
      rawText: page.text,
      source: 'URL',
    });
    queue.enqueue('parse-job', { jobId: created.id });
    res.status(201).json({ id: created.id, status: 'PENDING' });
  }),
);

jobRouter.get(
  '/search',
  aiRateLimit(),
  validate({ query: z.object({ q: z.string().min(2).max(300), k: z.coerce.number().int().min(1).max(25).default(8) }) }),
  asyncHandler(async (req, res) => {
    const q = (req as Request & { validatedQuery?: Record<string, unknown> }).validatedQuery!;
    const hits = await searchService.search(req.auth!.userId, q['q'] as string, q['k'] as number);
    res.json({ hits });
  }),
);

jobRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const job = await jobService.getOwned(req.auth!.userId, req.params['id'] ?? '');
    const requirements = await jobService.requirementsOf(job.id);
    res.json({ ...job, requirementsJson: requirements });
  }),
);

jobRouter.put(
  '/:id',
  validate({
    body: JobCreateSchema.partial().refine((b) => Object.keys(b).length > 0, 'empty update'),
  }),
  asyncHandler(async (req, res) => {
    const updated = await jobService.updateOwned(req.auth!.userId, req.params['id'] ?? '', req.body);
    queue.enqueue('parse-job', { jobId: updated.id });
    res.json({ id: updated.id, status: updated.status });
  }),
);

jobRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await jobService.deleteOwned(req.auth!.userId, req.params['id'] ?? '');
    res.status(204).send();
  }),
);

jobRouter.post(
  '/:id/parse',
  aiRateLimit(),
  asyncHandler(async (req, res) => {
    const job = await jobService.getOwned(req.auth!.userId, req.params['id'] ?? '');
    if (job.status === 'RUNNING') {
      res.status(409).json({ error: 'Parse already running', code: 'CONFLICT' });
      return;
    }
    queue.enqueue('parse-job', { jobId: job.id });
    res.status(202).json({ id: job.id, status: 'PENDING' });
  }),
);
