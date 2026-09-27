import { ParsedResumeSchema, type ParsedResume } from '@career/shared';
import { getContainer } from '../../lib/container.js';
import { trackCall } from '../tracking/track.js';
import { RESUME_PARSE_SYSTEM } from '../prompts/index.js';
import { getStructuredOutput } from './structured.js';
import { maskPii } from '../guardrails/pii.js';

/**
 * parse-resume pipeline: resume text → ParsedResume (schema-validated).
 */
export async function parseResumeWithLlm(rawText: string, userId?: string): Promise<ParsedResume> {
  const provider = getContainer().llmProvider;
  const model = provider.model;

  const tracked = await trackCall(
    { userId: userId ?? null, purpose: 'PARSE', model },
    () =>
      getStructuredOutput<ParsedResume>({
        system: RESUME_PARSE_SYSTEM,
        user: maskPii(rawText.slice(0, 12_000)),
        schema: ParsedResumeSchema,
        call: (messages) => provider.chat({ messages, responseJsonSchema: {} }),
      }),
    (r) => r.usage,
  );

  return tracked.result.data;
}
