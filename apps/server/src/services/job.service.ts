import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { NotFoundError } from '../lib/errors.js';
import { ParsedJobSchema, type ParsedJob } from '@career/shared';
import { parseJobDeterministic } from './job-parser.service.js';
import { parseJobWithLlm } from '../ai/pipelines/parse-job.js';
import { indexJobEmbeddings } from '../ai/rag/index.js';
import { cacheService } from './cache.service.js';
import { logger } from '../lib/logger.js';

/**
 * Job domain service. Parsing runs in the background worker; the LLM parser
 * is primary, the deterministic parser is fallback, embeddings are re-indexed
 * in the same transaction that marks the job DONE.
 */

export interface JobListQuery {
  userId: string;
  limit: number;
  offset: number;
  company?: string;
  status?: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
}

export const jobService = {
  async create(userId: string, data: {
    title: string;
    company: string;
    location: string;
    url?: string;
    rawText: string;
    salaryMin?: number;
    salaryMax?: number;
    employmentType?: string;
    postedAt?: string;
    source?: 'URL' | 'MANUAL' | 'SEED';
  }): Promise<{ id: string }> {
    const job = await prisma.job.create({
      data: {
        userId,
        title: data.title,
        company: data.company,
        location: data.location,
        url: data.url,
        rawText: data.rawText,
        source: data.source ?? 'MANUAL',
        salaryMin: data.salaryMin,
        salaryMax: data.salaryMax,
        employmentType: data.employmentType,
        postedAt: data.postedAt === undefined ? undefined : new Date(data.postedAt),
      },
    });
    return { id: job.id };
  },

  async list(query: JobListQuery) {
    const where: Prisma.JobWhereInput = {
      userId: query.userId,
      ...(query.company !== undefined ? { company: { contains: query.company, mode: 'insensitive' } } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        select: {
          id: true, title: true, company: true, location: true, url: true,
          source: true, status: true, salaryMin: true, salaryMax: true,
          employmentType: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.job.count({ where }),
    ]);
    return { items, total };
  },

  async getOwned(userId: string, jobId: string) {
    const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
    if (job === null) throw new NotFoundError('Job');
    return job;
  },

  async updateOwned(userId: string, jobId: string, data: Partial<{
    title: string; company: string; location: string; rawText: string;
    salaryMin: number; salaryMax: number; employmentType: string;
  }>) {
    await this.getOwned(userId, jobId);
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: { ...data, status: 'PENDING' }, // edits invalidate the parse
    });
    return updated;
  },

  async deleteOwned(userId: string, jobId: string): Promise<void> {
    await this.getOwned(userId, jobId);
    await prisma.job.delete({ where: { id: jobId } });
  },

  /**
   * Full parse pipeline for the worker: LLM (fallback deterministic) →
   * persist requirements → re-index embeddings → mark DONE — atomically.
   */
  async runParse(jobId: string): Promise<void> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (job === null) return;

    await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    let parsed: ParsedJob;
    try {
      parsed = await parseJobWithLlm(job.rawText, job.userId);
    } catch (err) {
      logger.warn({ jobId, err }, 'llm_parse_failed_falling_back');
      const fallback = parseJobDeterministic(job.rawText);
      parsed = { ...fallback, requirements: fallback.requirements.map((r) => ({ ...r })) };
    }
    const checked = ParsedJobSchema.safeParse(parsed);
    const finalParsed = checked.success ? checked.data : ParsedJobSchema.parse(parseJobDeterministic(job.rawText));

    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          title: finalParsed.title || job.title,
          company: finalParsed.company || job.company,
          location: finalParsed.location || job.location,
          requirementsJson: finalParsed as unknown as Prisma.InputJsonValue,
          status: 'DONE',
        },
      });
    });

    // Embeddings are re-indexed after the parse (best-effort; search degrades
    // to lexical-only when a job has no vectors yet). Search results are
    // cached per user+query, so invalidate them: this job's content changed.
    cacheService.invalidatePrefix('search:');
    cacheService.invalidatePrefix('match:'); // cached reports may reference stale requirements
    try {
      await indexJobEmbeddings(jobId, job.rawText);
    } catch (err) {
      logger.warn({ jobId, err }, 'embedding_index_failed');
    }
  },

  /** Count of requirements extracted (for UI badges). */
  async requirementsOf(jobId: string): Promise<ParsedJob | null> {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { requirementsJson: true } });
    if (job?.requirementsJson == null) return null;
    const parsed = ParsedJobSchema.safeParse(job.requirementsJson);
    return parsed.success ? parsed.data : null;
  },
};
