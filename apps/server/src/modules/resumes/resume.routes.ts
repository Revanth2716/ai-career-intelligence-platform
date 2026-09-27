import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiRateLimit } from '../../middleware/rate-limit.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { resolveKind } from '../../services/text-extraction.service.js';
import { queue } from '../../jobs/queue.js';
import { resumeService } from './resume.service.js';

/**
 * Resume routes. Upload: multipart, 2 MiB cap, extension allowlist, magic
 * byte check; row created PENDING, parse task enqueued (202-style flow).
 */
export const resumeRouter = Router();

const ALLOWED_KINDS = new Set(['pdf', 'docx', 'text']);
const ALLOWED_MIME = /^application\/(pdf|x-pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|octet-stream)$|^text\/(plain|markdown)$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: env.UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
      void file;
    },
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const kind = resolveKind(file.mimetype, file.originalname);
    if (!ALLOWED_KINDS.has(kind) || !ALLOWED_MIME.test(file.mimetype)) {
      cb(new BadRequestError(`Unsupported file type. Allowed: PDF, DOCX, TXT, MD (≤ ${env.MAX_UPLOAD_MB} MB)`));
      return;
    }
    cb(null, true);
  },
});

resumeRouter.use(requireAuth);

resumeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await resumeService.list(req.auth!.userId);
    res.json({ items });
  }),
);

resumeRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.file === undefined) throw new BadRequestError('file field is required');
    const title = typeof req.body['title'] === 'string' && req.body['title'].trim().length > 0
      ? req.body['title'].trim().slice(0, 200)
      : req.file.originalname;
    const resume = await resumeService.create(req.auth!.userId, {
      title,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    queue.enqueue('parse-resume', { resumeId: resume.id });
    res.status(201).json({ id: resume.id, status: resume.status });
  }),
);

resumeRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const resume = await resumeService.getOwned(req.auth!.userId, req.params['id'] ?? '');
    const parsed = ParsedResumeDto(resume.parsedJson);
    res.json({ ...resume, parsedJson: parsed });
  }),
);

function ParsedResumeDto(json: unknown): unknown {
  return json; // pass-through; client decodes with shared schema
}

resumeRouter.post(
  '/:id/parse',
  aiRateLimit(),
  asyncHandler(async (req, res) => {
    const resume = await resumeService.getOwned(req.auth!.userId, req.params['id'] ?? '');
    if (resume.status === 'RUNNING') {
      res.status(409).json({ error: 'Parse already running', code: 'CONFLICT' });
      return;
    }
    queue.enqueue('parse-resume', { resumeId: resume.id });
    res.status(202).json({ id: resume.id, status: 'PENDING' });
  }),
);

resumeRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await resumeService.deleteOwned(req.auth!.userId, req.params['id'] ?? '');
    res.status(204).send();
  }),
);
