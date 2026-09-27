import type { ZodTypeAny } from 'zod';
import { parseJsonReply, type ChatMessage, type ChatResponse } from '../provider/llm.js';
import { logger } from '../../lib/logger.js';

/**
 * Structured-output enforcement. The LLM is asked for JSON; the reply is
 * validated against a zod schema; on failure the model is retried with the
 * validation error appended (max 2 attempts). Guarantees that everything
 * persisted from an LLM has passed schema validation. Cumulative token usage
 * across attempts is returned so cost tracking captures retries too.
 */

export interface StructuredResult<T> {
  data: T;
  attempts: number;
  rawText: string | null;
  usage: { promptTokens: number; completionTokens: number };
}

export async function getStructuredOutput<T>(opts: {
  call: (messages: ChatMessage[]) => Promise<ChatResponse>;
  system: string;
  user: string;
  schema: ZodTypeAny;
  maxAttempts?: number;
}): Promise<StructuredResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let feedback = '';
  const usage = { promptTokens: 0, completionTokens: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const messages: ChatMessage[] = [
      { role: 'system', content: opts.system },
      ...(feedback !== ''
        ? [{ role: 'user' as const, content: `Previous attempt was invalid: ${feedback}\n\n${opts.user}` }]
        : [{ role: 'user' as const, content: opts.user }]),
    ];
    const response = await opts.call(messages);
    usage.promptTokens += response.usage.promptTokens;
    usage.completionTokens += response.usage.completionTokens;

    const parsed = parseJsonReply<unknown>(response.text);
    if (parsed === undefined) {
      feedback = 'response was not parseable JSON';
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) {
      return { data: result.data as T, attempts: attempt, rawText: response.text, usage };
    }
    feedback = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    logger.debug({ attempt, feedback }, 'structured_output_retry');
  }
  throw new Error(`LLM failed to produce schema-valid output after ${maxAttempts} attempts: ${feedback}`);
}
