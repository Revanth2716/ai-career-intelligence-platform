import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { ParsedResumeSchema } from '@career/shared';
import { parseResumeWithLlm } from '../../ai/pipelines/parse-resume.js';
import { logger } from '../../lib/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Resume domain service. Upload persists the file + row (PENDING); the
 * worker extracts text and runs the parse pipeline; parsed JSON is stored
 * atomically with the status flip.
 */

export const resumeService = {
  async create(userId: string, data: {
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    rawText?: string;
  }) {
    return prisma.resume.create({
      data: {
        userId,
        title: data.title,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        rawText: data.rawText ?? '',
        status: 'PENDING',
      },
    });
  },

  async list(userId: string) {
    return prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, fileName: true, mimeType: true, sizeBytes: true,
        status: true, createdAt: true,
      },
    });
  },

  async getOwned(userId: string, resumeId: string) {
    const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId } });
    if (resume === null) throw new NotFoundError('Resume');
    return resume;
  },

  async deleteOwned(userId: string, resumeId: string): Promise<void> {
    const resume = await this.getOwned(userId, resumeId);
    await prisma.resume.delete({ where: { id: resume.id } });
    if (resume.fileName.length > 0) {
      await fs.unlink(path.join(process.env['UPLOAD_DIR'] ?? './uploads', resume.fileName)).catch(() => undefined);
    }
  },

  async runParse(resumeId: string): Promise<void> {
    const resume = await prisma.resume.findUnique({ where: { id: resumeId } });
    if (resume === null) return;
    await prisma.resume.update({ where: { id: resumeId }, data: { status: 'RUNNING' } });

    // Extract text if the upload didn't include it inline.
    let rawText = resume.rawText;
    if (rawText.length === 0) {
      const { extractText } = await import('../../services/text-extraction.service.js');
      const filePath = path.join(process.env['UPLOAD_DIR'] ?? './uploads', resume.fileName);
      const buffer = await fs.readFile(filePath);
      rawText = await extractText(buffer, resume.mimeType, resume.fileName);
    }

    let parsed;
    try {
      parsed = await parseResumeWithLlm(rawText, resume.userId);
    } catch (err) {
      logger.warn({ resumeId, err }, 'resume_llm_parse_failed');
      parsed = { skills: [], experience: [], education: [], summary: rawText.slice(0, 200) };
    }

    const checked = ParsedResumeSchema.safeParse(parsed);
    const finalParsed = checked.success ? checked.data : { skills: [], experience: [], education: [], summary: '' };

    await prisma.resume.update({
      where: { id: resumeId },
      data: {
        rawText,
        parsedJson: finalParsed as never,
        status: 'DONE',
      },
    });
  },

  async markFailed(resumeId: string): Promise<void> {
    await prisma.resume.update({ where: { id: resumeId }, data: { status: 'FAILED' } }).catch(() => undefined);
  },
};
