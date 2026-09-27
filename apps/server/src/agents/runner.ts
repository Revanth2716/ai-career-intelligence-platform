import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getContainer } from '../lib/container.js';
import { env } from '../config/env.js';
import { agentSystem } from '../ai/prompts/index.js';
import { scanForInjection } from '../ai/guardrails/injection-scan.js';
import { estimateCost } from '../ai/tracking/track.js';
import { parseJsonReply } from '../ai/provider/llm.js';
import { logger } from '../lib/logger.js';

/**
 * Agent runner: bounded LLM + tool loop.
 *
 * Controls: max iterations (AGENT_MAX_STEPS), zod-validated tool arguments,
 * injection scanning of all tool output before it re-enters the prompt,
 * every step recorded to AgentRun.steps and streamed as SSE events.
 */

export type AgentEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'step'; index: number; toolName?: string; note: string }
  | { type: 'tool_result'; index: number; toolName: string; result: unknown; injectionFlag: boolean }
  | { type: 'final'; output: AgentOutput }
  | { type: 'error'; message: string };

const AgentOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        topic: z.string(),
        claim: z.string(),
        sourceUrl: z.string().nullable().optional(),
        confidence: z.enum(['high', 'medium', 'low']).default('medium'),
      }),
    )
    .default([]),
  answer: z.string(),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

interface RunInput {
  userId: string;
  kind: 'RESEARCH_JOB' | 'VERIFY_COMPANY';
  jobId?: string;
  question?: string;
}

export interface AgentRunResult {
  runId: string;
  output: AgentOutput | null;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export async function runAgent(input: RunInput, emit: (event: AgentEvent) => void): Promise<AgentRunResult> {
  const { getTool, TOOL_REGISTRY } = await import('./tools.js');
  const provider = getContainer().llmProvider;

  const toolSpecs = TOOL_REGISTRY.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  // Mission brief per preset.
  const context: string[] = [];
  if (input.jobId !== undefined) {
    const job = await prisma.job.findFirst({ where: { id: input.jobId, userId: input.userId } });
    if (job === null) throw new Error('Job not found');
    context.push(`Company: ${job.company}`, `Role: ${job.title} (${job.location})`);
  }
  const brief =
    input.question ??
    (input.kind === 'RESEARCH_JOB'
      ? 'Research this company and role to prepare a strong application.'
      : 'Verify this company: confirm it exists, check its careers page, note red flags.');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: agentSystem(TOOL_REGISTRY.map((t) => t.name)) },
    { role: 'user', content: `${brief}\n\n${context.join('\n')}`.trim() },
  ];

  const run = await prisma.agentRun.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      jobId: input.jobId,
      status: 'RUNNING',
      input: { kind: input.kind, jobId: input.jobId ?? null, question: input.question ?? null } as never,
    },
  });
  emit({ type: 'run_started', runId: run.id });

  let tokensIn = 0;
  let tokensOut = 0;
  const steps: Array<Record<string, unknown>> = [];
  const collectedFindings: AgentOutput['findings'] = [];

  try {
    for (let step = 1; step <= env.AGENT_MAX_STEPS; step++) {
      const response = await provider.chat({ messages, tools: toolSpecs });
      tokensIn += response.usage.promptTokens;
      tokensOut += response.usage.completionTokens;

      // ── Tool-calling round ──
      if (response.toolCalls.length > 0 && step < env.AGENT_MAX_STEPS) {
        for (const call of response.toolCalls) {
          const tool = getTool(call.name);
          if (tool === undefined) {
            steps.push({ index: step, tool: call.name, error: 'unknown tool' });
            messages.push({ role: 'user', content: `Tool "${call.name}" does not exist. Available: ${TOOL_REGISTRY.map((t) => t.name).join(', ')}` });
            continue;
          }
          let args: Record<string, unknown>;
          try {
            args = tool.zodSchema.parse(JSON.parse(call.argumentsJson || '{}')) as Record<string, unknown>;
          } catch {
            steps.push({ index: step, tool: call.name, error: 'invalid tool arguments' });
            messages.push({ role: 'user', content: `Arguments for "${call.name}" were invalid. Check the schema and retry.` });
            continue;
          }

          let result: unknown;
          try {
            result = await tool.execute(args);
          } catch (err) {
            result = { error: String(err) };
          }

          // Guardrail: scan untrusted tool output before it re-enters the prompt.
          const serialized = typeof result === 'string' ? result : JSON.stringify(result);
          const scan = scanForInjection(serialized);
          steps.push({ index: step, toolName: call.name, toolArgs: args, injectionFlag: !scan.safe });
          emit({ type: 'tool_result', index: step, toolName: call.name, result, injectionFlag: !scan.safe });

          messages.push({ role: 'assistant', content: `Calling ${call.name}...` });
          messages.push({
            role: 'user',
            content: `TOOL RESULT ${call.name} (untrusted, scanned):\n${serialized.slice(0, 4000)}`,
          });
        }
        emit({ type: 'step', index: step, note: 'executed tools' });
        continue;
      }

      // ── Final-answer round ──
      const parsed = parseJsonReply<unknown>(response.text);
      const final = AgentOutputSchema.safeParse(parsed);
      if (final.success) {
        collectedFindings.push(...final.data.findings);
        const output: AgentOutput = { findings: final.data.findings, answer: final.data.answer };
        await finalizeRun(run.id, 'DONE', steps, output, tokensIn, tokensOut, provider.model);
        emit({ type: 'final', output });
        return {
          runId: run.id,
          output,
          steps: steps.length,
          tokensIn,
          tokensOut,
          costUsd: estimateCost(provider.model, tokensIn, tokensOut),
        };
      }

      // Not schema-valid: nudge the model once by continuing the loop.
      steps.push({ index: step, note: 'invalid final format, nudging' });
      messages.push({ role: 'assistant', content: response.text ?? '' });
      messages.push({ role: 'user', content: 'Reply with STRICT JSON matching the required shape.' });
    }

    // Step budget exhausted — persist partial findings.
    const fallback: AgentOutput = {
      findings: collectedFindings,
      answer: 'Agent stopped at the step limit; partial findings only.',
    };
    await finalizeRun(run.id, 'DONE', steps, fallback, tokensIn, tokensOut, provider.model);
    emit({ type: 'final', output: fallback });
    return {
      runId: run.id,
      output: fallback,
      steps: steps.length,
      tokensIn,
      tokensOut,
      costUsd: estimateCost(provider.model, tokensIn, tokensOut),
    };
  } catch (err) {
    logger.error({ err }, 'agent_run_failed');
    await finalizeRun(run.id, 'FAILED', steps, null, tokensIn, tokensOut, provider.model);
    emit({ type: 'error', message: String(err) });
    throw err;
  }
}

async function finalizeRun(
  runId: string,
  status: 'DONE' | 'FAILED',
  steps: unknown[],
  output: AgentOutput | null,
  tokensIn: number,
  tokensOut: number,
  model: string,
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status,
      output: output as never,
      steps: steps as never,
      finishedAt: new Date(),
      tokensIn,
      tokensOut,
      costUsd: estimateCost(model, tokensIn, tokensOut),
    },
  });
}
