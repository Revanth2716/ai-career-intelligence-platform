import OpenAI from 'openai';
import { env, features } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * LLM provider port (hexagonal architecture). The rest of the codebase
 * depends on this interface only — concrete adapters are OpenAI-compatible
 * (real or mock), so swapping providers is a config change, not a refactor.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseJsonSchema?: Record<string, unknown>; // structured output mode
  tools?: ToolSpec[];
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  text: string | null;
  toolCalls: ToolCall[];
  usage: ChatUsage;
  model: string;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

// ─── OpenAI-compatible adapter ───────────────────────────────────────────────

class OpenAiCompatProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, baseUrl: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.name = `openai-compat(${baseUrl})`;
    this.model = env.LLM_MODEL;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const completion = await this.client.chat.completions.create({
      model: req.model ?? env.LLM_MODEL,
      messages: req.messages,
      max_tokens: req.maxTokens ?? env.LLM_MAX_OUTPUT_TOKENS,
      temperature: req.temperature ?? 0.2,
      ...(req.responseJsonSchema !== undefined
        ? { response_format: { type: 'json_object' as const } }
        : {}),
      ...(req.tools !== undefined && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    });

    const choice = completion.choices[0];
    const usage = completion.usage;
    return {
      text: choice?.message?.content ?? null,
      toolCalls:
        choice?.message?.tool_calls
          ?.filter((tc) => tc.type === 'function')
          .map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            argumentsJson: tc.function.arguments,
          })) ?? [],
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      },
      model: completion.model,
      finishReason:
        choice?.finish_reason === 'tool_calls'
          ? 'tool_calls'
          : choice?.finish_reason === 'length'
            ? 'length'
            : 'stop',
    };
  }
}

// ─── Mock adapter (offline / tests / $0 demos) ───────────────────────────────

export interface MockScenario {
  /** When set, invoked for a JSON-mode chat; return the parsed object. */
  jsonObject?: (messages: ChatMessage[], req: ChatRequest) => Record<string, unknown>;
  /** When set, invoked for tool-mode chats; return tool calls to execute. */
  toolCalls?: (messages: ChatMessage[], req: ChatRequest) => { text?: string; calls: ToolCall[] };
}

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-gpt';
  private calls = 0;

  constructor(private scenario: MockScenario = {}) {}

  get callCount(): number {
    return this.calls;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    // Deterministic usage derived from input size (stable for tests/evals).
    const promptTokens = req.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);

    if (req.tools !== undefined && req.tools.length > 0) {
      const out = this.scenario.toolCalls?.(req.messages, req) ?? defaultToolScenario(req.messages);
      return {
        text: out.text ?? null,
        toolCalls: out.calls,
        usage: { promptTokens, completionTokens: Math.ceil((out.text?.length ?? 10) / 4) },
        model: this.model,
        finishReason: out.calls.length > 0 ? 'tool_calls' : 'stop',
      };
    }

    if (req.responseJsonSchema !== undefined) {
      const obj = this.scenario.jsonObject?.(req.messages, req) ?? defaultJsonScenario(req.messages);
      const text = JSON.stringify(obj);
      return {
        text,
        toolCalls: [],
        usage: { promptTokens, completionTokens: Math.ceil(text.length / 4) },
        model: this.model,
        finishReason: 'stop',
      };
    }

    const text = this.scenario.toolCalls?.(req.messages, req).text ?? 'mock response';
    return {
      text,
      toolCalls: [],
      usage: { promptTokens, completionTokens: Math.ceil(text.length / 4) },
      model: this.model,
      finishReason: 'stop',
    };
  }
}

/**
 * Default offline tool-scenario: skips tool execution (no network in mock
 * mode) and returns a schema-valid final answer derived from the prompt.
 */
function defaultToolScenario(messages: ChatMessage[]): { text: string; calls: ToolCall[] } {
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  const company = user.match(/Company:\s*(.+)/i)?.[1]?.trim() ?? 'the company';
  const text = JSON.stringify({
    findings: [
      {
        topic: 'verification',
        claim: `Offline mock run: no web tools configured, so ${company} could not be verified against live sources.`,
        sourceUrl: null,
        confidence: 'low',
      },
    ],
    answer: `Offline mock agent run for ${company}: configure WEB_SEARCH_PROVIDER + an API key to enable live research. Structure and guardrails verified.`,
  });
  return { text, calls: [] };
}

/**
 * Default offline scenario: returns plausible, schema-valid payloads keyed off
 * the system prompt, so the full parse/match pipelines do real work with
 * MOCK_LLM=true (no API key, no network).
 */
function defaultJsonScenario(messages: ChatMessage[]): Record<string, unknown> {
  const system = messages[0]?.content ?? '';
  if (system.includes('resume parser')) {
    return {
      skills: ['python', 'javascript', 'typescript', 'sql', 'node', 'react', 'rest', 'testing'],
      experience: [
        {
          title: 'Software Intern',
          company: 'Acme',
          bullets: ['Built REST APIs with node and postgresql', 'Wrote integration tests with supertest'],
        },
      ],
      education: [{ degree: 'B.Tech CSE', institution: 'Example University', year: '2024' }],
      summary: 'Backend-leaning full-stack fresher with strong testing habits.',
    };
  }
  if (system.includes('recruitment-data extractor')) {
    // Derive title/company from the posting itself (first line, "X at Y"),
    // so offline parses stay faithful to the source text.
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const firstLine = user.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? 'Software Engineer';
    const atMatch = firstLine.match(/^(.*?)\s+at\s+(.+?)\s*[(.]/i) ?? firstLine.match(/^(.*?)\s+at\s+(.+)$/i);
    return {
      title: (atMatch?.[1] ?? firstLine).slice(0, 150),
      company: (atMatch?.[2] ?? 'Company').slice(0, 100),
      location: 'Bengaluru',
      summary: firstLine.slice(0, 200),
      requirements: [
        { skill: 'python', importance: 0.9, category: 'language' },
        { skill: 'sql', importance: 0.8, category: 'data' },
        { skill: 'rest', importance: 0.7, category: 'api' },
        { skill: 'docker', importance: 0.4, category: 'ops' },
      ],
    };
  }
  if (system.includes('explainable job-match advisor')) {
    // Derive a valid explanation from the deterministic coverage block the
    // pipeline placed in the user message ("- skill (importance X): state").
    const user = messages.map((m) => m.content).join('\n');
    const lines = [...user.matchAll(/^- ([^ ]+(?: [^ (]+)*?) \(importance ([\d.]+)\): (covered|partial|missing)$/gm)];
    const matchedSkills = lines
      .filter((l) => l[3] !== 'missing')
      .map((l) => ({ skill: l[1] ?? '', evidence: `Listed in resume (deterministic: ${l[3]})`, confidence: l[3] === 'covered' ? 0.9 : 0.5 }));
    const missingSkills = lines
      .filter((l) => l[3] === 'missing')
      .map((l) => ({ skill: l[1] ?? '', importance: Number(l[2] ?? 0.5), suggestion: `Build a small project using ${l[1]} and add it to the resume.` }));
    const covered = matchedSkills.length;
    return {
      matchedSkills,
      missingSkills,
      summary: `Offline mock explanation: ${covered} of ${lines.length} requirements evidenced; see per-skill detail.`,
    };
  }
  return {};
}

/** Extract a JSON object from a model reply (tolerates code fences). */
export function parseJsonReply<T>(text: string | null): T | undefined {
  if (text === null) return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) return undefined;
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function makeLlmProvider(): LlmProvider {
  if (features.useRealLlm) {
    logger.info({ baseUrl: env.OPENAI_BASE_URL, model: env.LLM_MODEL }, 'LLM provider: openai-compatible');
    return new OpenAiCompatProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL);
  }
  logger.info('LLM provider: mock (MOCK_LLM=true or no API key)');
  return new MockLlmProvider();
}
