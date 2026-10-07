import { z } from 'zod';
import { MatchedSkillSchema, MissingSkillSchema } from '@career/shared';
import { getContainer } from '../../lib/container.js';
import { trackCall } from '../tracking/track.js';
import { matchExplainSystem } from '../prompts/index.js';
import { getStructuredOutput } from './structured.js';
import { maskPii } from '../guardrails/pii.js';
import { wrapUntrusted } from '../guardrails/injection-scan.js';

/**
 * Match-explanation pipeline: deterministic score + RAG chunks → LLM
 * explanation (evidence quotes + gap suggestions). If the LLM fails, the
 * caller degrades gracefully to the deterministic score (see match.service).
 */

const ExplanationsSchema = z.object({
  matchedSkills: z.array(MatchedSkillSchema).max(20),
  missingSkills: z.array(MissingSkillSchema).max(20),
  summary: z.string().max(1200),
});

export interface MatchExplanations {
  matchedSkills: z.infer<typeof MatchedSkillSchema>[];
  missingSkills: z.infer<typeof MissingSkillSchema>[];
  summary: string;
}

export interface ExplainInput {
  resumeSummary: string;
  resumeSkills: string[];
  jobSummary: string;
  jobRequirements: Array<{ skill: string; importance: number; covered: boolean; partial: boolean }>;
  ragChunks: string[];
}

export async function explainMatchWithLlm(
  input: ExplainInput,
  userId?: string,
): Promise<MatchExplanations & { model: string; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number }> {
  const provider = getContainer().llmProvider;

  const ragBlock =
    input.ragChunks.length > 0
      ? input.ragChunks.map((c, i) => `[chunk ${i + 1}] ${wrapUntrusted(c, 'job-posting')}`).join('\n\n')
      : '(no retrieved posting excerpts)';

  const user = [
    `RESUME SUMMARY: ${maskPii(input.resumeSummary) || '(none)'}`,
    `RESUME SKILLS: ${input.resumeSkills.join(', ') || '(none)'}`,
    `JOB: ${maskPii(input.jobSummary) || '(see requirements)'}`,
    '',
    'DETERMINISTIC COVERAGE (computed in code — treat as ground truth):',
    ...input.jobRequirements.map(
      (r) => `- ${r.skill} (importance ${r.importance.toFixed(2)}): ${r.covered ? 'covered' : r.partial ? 'partial' : 'missing'}`,
    ),
    '',
    'POSTING EXCERPTS (RAG context):',
    ragBlock,
  ].join('\n');

  const tracked = await trackCall(
    { userId: userId ?? null, purpose: 'MATCH', model: provider.model },
    () =>
      getStructuredOutput<MatchExplanations>({
        system: matchExplainSystem(),
        user,
        schema: ExplanationsSchema,
        call: (messages) => provider.chat({ messages, responseJsonSchema: {} }),
      }),
    (r) => r.usage,
  );

  return { ...tracked.result.data, model: tracked.model, tokensIn: tracked.tokensIn, tokensOut: tracked.tokensOut, costUsd: tracked.costUsd, latencyMs: tracked.latencyMs };
}
