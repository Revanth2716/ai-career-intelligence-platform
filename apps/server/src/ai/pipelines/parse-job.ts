import { ParsedJobSchema, type ParsedJob } from '@career/shared';
import { getContainer } from '../../lib/container.js';
import { trackCall } from '../tracking/track.js';
import { JOB_PARSE_SYSTEM } from '../prompts/index.js';
import { getStructuredOutput } from './structured.js';
import { maskPii } from '../guardrails/pii.js';
import { logger } from '../../lib/logger.js';

/**
 * parse-job pipeline: raw posting text → ParsedJob (schema-validated).
 * Uses the container's LLM provider. On failure the caller falls back to the
 * deterministic regex-based extractor (services/job-parser.service.ts) so
 * parsing never hard-fails the background task.
 */
export async function parseJobWithLlm(rawText: string, userId?: string): Promise<ParsedJob> {
  const provider = getContainer().llmProvider;
  const model = provider.model;

  const tracked = await trackCall(
    { userId: userId ?? null, purpose: 'PARSE', model },
    () =>
      getStructuredOutput<ParsedJob>({
        system: JOB_PARSE_SYSTEM,
        user: maskPii(rawText.slice(0, 12_000)),
        schema: ParsedJobSchema,
        call: (messages) => provider.chat({ messages, responseJsonSchema: {} }),
      }),
    (r) => r.usage,
  );

  logger.info({ model, tokens: tracked.tokensIn + tracked.tokensOut }, 'job_parsed_llm');
  return tracked.result.data;
}
