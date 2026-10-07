import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { llmCostUsd, llmTokens } from '../../observability/metrics.js';

/**
 * Token/cost tracking. Every LLM/embedding call is recorded to the LlmCall
 * table (source for /costs/summary) and Prometheus counters. Tracking must
 * never break the request path — failures are logged, not thrown.
 */

export type Purpose = 'PARSE' | 'MATCH' | 'EMBED' | 'AGENT' | 'GUARDRAIL';

/** Public list prices, USD per 1M tokens — estimation table, not a bill. */
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

interface CallData {
  userId?: string | null;
  purpose: Purpose;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status?: 'OK' | 'ERROR';
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Mock providers make no real API call — their tokens cost nothing.
  if (model.startsWith('mock')) return 0;
  const price = PRICES[model] ?? { input: 0.15, output: 0.6 };
  return (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
}

export async function trackLlmCall(data: CallData): Promise<void> {
  const costUsd = estimateCost(data.model, data.promptTokens, data.completionTokens);
  try {
    await prisma.llmCall.create({
      data: {
        userId: data.userId ?? null,
        purpose: data.purpose,
        model: data.model,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        costUsd,
        latencyMs: data.latencyMs,
        status: data.status ?? 'OK',
      },
    });
    llmTokens.inc({ purpose: data.purpose, direction: 'in' }, data.promptTokens);
    llmTokens.inc({ purpose: data.purpose, direction: 'out' }, data.completionTokens);
    llmCostUsd.inc({ purpose: data.purpose }, costUsd);
  } catch (err) {
    logger.warn({ err }, 'llm_call_tracking_failed');
  }
}

export interface TrackResult {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
  latencyMs: number;
}

/**
 * Wrap an awaited provider call: time it, track it, return tokens/cost.
 * Usage is read via `extractUsage` (defaults to a `.usage` property when the
 * result has one) so any call shape can be tracked.
 */
export async function trackCall<T>(
  data: { userId?: string | null; purpose: Purpose; model: string },
  fn: () => Promise<T>,
  extractUsage?: (result: T) => { promptTokens: number; completionTokens: number },
): Promise<TrackResult & { result: T }> {
  const started = Date.now();
  try {
    const result = await fn();
    const latencyMs = Date.now() - started;
    const maybeUsage = (
      result as unknown as { usage?: { promptTokens: number; completionTokens: number } }
    ).usage;
    const usage =
      extractUsage !== undefined
        ? extractUsage(result)
        : (maybeUsage ?? { promptTokens: 0, completionTokens: 0 });
    const { promptTokens, completionTokens } = usage;
    await trackLlmCall({ ...data, promptTokens, completionTokens, latencyMs, status: 'OK' });
    return {
      result,
      tokensIn: promptTokens,
      tokensOut: completionTokens,
      costUsd: estimateCost(data.model, promptTokens, completionTokens),
      model: data.model,
      latencyMs,
    };
  } catch (err) {
    await trackLlmCall({
      ...data,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: Date.now() - started,
      status: 'ERROR',
    });
    throw err;
  }
}
