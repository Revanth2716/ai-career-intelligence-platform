import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { ParsedJobSchema, ParsedResumeSchema } from '@career/shared';
import { scoreMatch } from './scorer.js';
import { explainMatchWithLlm } from '../../ai/pipelines/match.js';
import { retrieveChunks } from '../../ai/rag/retrieve.js';
import { cacheService } from '../../services/cache.service.js';
import { logger } from '../../lib/logger.js';

/**
 * Match orchestration (two-stage candidate-then-explain design):
 *  1. deterministic scorer computes coverage (always, $0, explainable)
 *  2. RAG retrieves the top posting chunks (context for the LLM)
 *  3. LLM produces evidence + gap suggestions (degrades to score-only)
 * Everything is persisted in one transaction with an audit log entry.
 */

export const matchService = {
  async run(userId: string, resumeId: string, jobId: string) {
    const cacheKey = `match:${resumeId}:${jobId}`;
    const cached = cacheService.get<unknown>(cacheKey);
    if (cached !== undefined) return cached;

    const [resume, job] = await Promise.all([
      prisma.resume.findFirst({ where: { id: resumeId, userId } }),
      prisma.job.findFirst({ where: { id: jobId, userId } }),
    ]);
    if (resume === null) throw new NotFoundError('Resume');
    if (job === null) throw new NotFoundError('Job');
    if (resume.parsedJson == null) throw new BadRequestError('Resume is not parsed yet — trigger parsing first');
    if (job.requirementsJson == null) throw new BadRequestError('Job is not parsed yet — trigger parsing first');

    const parsedResume = ParsedResumeSchema.parse(resume.parsedJson);
    const parsedJob = ParsedJobSchema.parse(job.requirementsJson);

    // ── Stage 1: deterministic score (no LLM, fully explainable) ──
    const deterministic = scoreMatch(parsedResume, parsedJob);

    // ── Stage 2: RAG grounding ──
    let ragChunks: string[] = [];
    try {
      const chunks = await retrieveChunks(job.rawText.slice(0, 1000), 3, job.id);
      ragChunks = chunks.map((c) => c.content);
    } catch (err) {
      logger.warn({ jobId, err }, 'rag_retrieval_failed_continuing');
    }

    // ── Stage 3: LLM explanation (graceful degradation) ──
    let explanation: Awaited<ReturnType<typeof explainMatchWithLlm>> | undefined;
    try {
      explanation = await explainMatchWithLlm(
        {
          resumeSummary: parsedResume.summary,
          resumeSkills: parsedResume.skills,
          jobSummary: parsedJob.summary,
          jobRequirements: deterministic.perSkill.map((p) => ({
            skill: p.skill,
            importance: p.importance,
            covered: p.covered,
            partial: p.partial,
          })),
          ragChunks,
        },
        userId,
      );
    } catch (err) {
      logger.warn({ resumeId, jobId, err }, 'llm_explanation_failed_score_only');
    }

    const matchedSkills = explanation?.matchedSkills.map((m) => ({
      skill: m.skill,
      evidence: m.evidence,
      confidence: m.confidence,
    })) ?? deterministic.perSkill.filter((p) => p.covered || p.partial).map((p) => ({
      skill: p.skill,
      evidence: p.evidence || 'Matched by deterministic scorer',
      confidence: p.covered ? 0.9 : 0.5,
    }));

    const missingSkills = explanation?.missingSkills.map((m) => ({
      skill: m.skill,
      importance: m.importance,
      suggestion: m.suggestion,
    })) ?? deterministic.perSkill.filter((p) => !p.covered).map((p) => ({
      skill: p.skill,
      importance: p.importance,
      suggestion: 'No suggestion available (LLM explanation unavailable)',
    }));

    const summary =
      explanation?.summary ??
      `Deterministic coverage ${deterministic.score}/100 — ` +
        `${deterministic.perSkill.filter((p) => p.covered).length} of ${deterministic.perSkill.length} requirements covered.`;

    const scoreSource = explanation !== undefined ? 'LLM_EXPLAINED' : 'DETERMINISTIC';

    // ── Persist (match + audit in one transaction) ──
    const report = await prisma.$transaction(async (tx) => {
      const saved = await tx.matchReport.upsert({
        where: { resumeId_jobId: { resumeId, jobId } },
        create: {
          userId,
          resumeId,
          jobId,
          score: deterministic.score,
          scoreSource,
          matchedSkills: matchedSkills as unknown as Prisma.InputJsonValue,
          missingSkills: missingSkills as unknown as Prisma.InputJsonValue,
          summary,
          citedChunkIdx: ragChunks.length > 0 ? (ragChunks.map((_, i) => i) as unknown as Prisma.InputJsonValue) : undefined,
          model: explanation?.model,
          tokensIn: explanation?.tokensIn ?? 0,
          tokensOut: explanation?.tokensOut ?? 0,
          costUsd: explanation?.costUsd ?? 0,
          latencyMs: explanation?.latencyMs ?? 0,
        },
        update: {
          // Full overwrite on rerun (idempotent).
          score: deterministic.score,
          scoreSource,
          matchedSkills: matchedSkills as unknown as Prisma.InputJsonValue,
          missingSkills: missingSkills as unknown as Prisma.InputJsonValue,
          summary,
          citedChunkIdx: ragChunks.length > 0 ? (ragChunks.map((_, i) => i) as unknown as Prisma.InputJsonValue) : undefined,
          model: explanation?.model,
          tokensIn: explanation?.tokensIn ?? 0,
          tokensOut: explanation?.tokensOut ?? 0,
          costUsd: explanation?.costUsd ?? 0,
          latencyMs: explanation?.latencyMs ?? 0,
        },
      });
      await tx.auditLog.create({
        data: { action: 'match.run', userId, entity: 'MatchReport', entityId: saved.id },
      });
      return saved;
    });

    const result = {
      id: report.id,
      resumeId,
      jobId,
      score: deterministic.score,
      scoreSource,
      matchedSkills,
      missingSkills,
      summary,
      model: explanation?.model ?? null,
      tokensIn: explanation?.tokensIn ?? 0,
      tokensOut: explanation?.tokensOut ?? 0,
      costUsd: explanation?.costUsd ?? 0,
      latencyMs: explanation?.latencyMs ?? 0,
      createdAt: report.createdAt.toISOString(),
    };
    cacheService.set(cacheKey, result);
    return result;
  },

  async listForResume(userId: string, resumeId?: string) {
    return prisma.matchReport.findMany({
      where: { userId, ...(resumeId !== undefined ? { resumeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },

  async getOwned(userId: string, matchId: string) {
    const report = await prisma.matchReport.findFirst({ where: { id: matchId, userId } });
    if (report === null) throw new NotFoundError('Match report');
    return report;
  },
};
