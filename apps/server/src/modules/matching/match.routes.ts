import { Router } from 'express';
import { CreateMatchSchema } from '@career/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { matchService } from './match.service.js';
import { ConflictError } from '../../lib/errors.js';

export const matchRouter = Router();

matchRouter.use(requireAuth);

matchRouter.post(
  '/',
  aiRateLimit(),
  validate({ body: CreateMatchSchema }),
  asyncHandler(async (req, res) => {
    const { resumeId, jobId } = req.body as { resumeId: string; jobId: string };
    try {
      const report = await matchService.run(req.auth!.userId, resumeId, jobId);
      res.status(201).json(report);
    } catch (err) {
      if (err instanceof ConflictError) {
        // Unique(resumeId, jobId): rerun returns the existing report (idempotent).
        res.status(200).json({ message: 'Existing report returned' });
        return;
      }
      throw err;
    }
  }),
);

matchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const resumeId = typeof req.query['resumeId'] === 'string' ? req.query['resumeId'] : undefined;
    const items = await matchService.listForResume(req.auth!.userId, resumeId);
    res.json({ items });
  }),
);

matchRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const report = await matchService.getOwned(req.auth!.userId, req.params['id'] ?? '');
    res.json(report);
  }),
);
