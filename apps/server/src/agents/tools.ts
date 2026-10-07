import { z } from 'zod';
import { env, features } from '../config/env.js';
import { cacheService, contentHash } from '../services/cache.service.js';
import { fetchPageText } from '../services/fetch-url.service.js';

/**
 * Agent tool registry (Factory pattern). Each tool declares a JSON-Schema
 * (for native OpenAI function-calling) plus a typed zod schema for runtime
 * validation of the model-produced arguments. Web tools are env-gated and
 * results are cached — agents stay cheap and bounded.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  zodSchema: z.ZodTypeAny;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

// ── web_search ───────────────────────────────────────────────────────────────
const WebSearchArgs = z.object({ query: z.string().min(2).max(300) });

async function tavilySearch(query: string): Promise<unknown> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results: 5 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  return res.json();
}

async function serperSearch(query: string): Promise<unknown> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 5 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  return res.json();
}

const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the public web for current information about a company or role.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search query' } },
    required: ['query'],
  },
  zodSchema: WebSearchArgs,
  async execute(args) {
    const { query } = WebSearchArgs.parse(args);
    if (!features.webSearch) {
      return { error: 'web_search is not configured (set WEB_SEARCH_PROVIDER and its API key)' };
    }
    return cacheService.wrap(`websearch:${contentHash(query)}`, async () => {
      if (env.WEB_SEARCH_PROVIDER === 'tavily') return tavilySearch(query);
      return serperSearch(query);
    });
  },
};

// ── fetch_page ───────────────────────────────────────────────────────────────
const FetchPageArgs = z.object({ url: z.string().url() });

const fetchPageTool: ToolDefinition = {
  name: 'fetch_page',
  description: 'Fetch a web page and return its main readable text (SSRF-guarded).',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
    required: ['url'],
  },
  zodSchema: FetchPageArgs,
  async execute(args) {
    const { url } = FetchPageArgs.parse(args);
    return cacheService.wrap(`fetchpage:${contentHash(url)}`, () => fetchPageText(url));
  },
};

// ── company_lookup (platform-internal, cached) ──────────────────────────────
const CompanyLookupArgs = z.object({ company: z.string().min(1).max(120) });

const companyLookupTool: ToolDefinition = {
  name: 'company_lookup',
  description: 'Look up saved jobs for a company in this platform (internal data).',
  parameters: {
    type: 'object',
    properties: { company: { type: 'string' } },
    required: ['company'],
  },
  zodSchema: CompanyLookupArgs,
  execute: async (args) => {
    const { company } = CompanyLookupArgs.parse(args);
    const { prisma } = await import('../lib/prisma.js');    const jobs = await prisma.job.findMany({
      where: { company: { contains: company, mode: 'insensitive' } },
      select: { company: true, title: true, location: true, status: true, createdAt: true },
      take: 10,
    });
    return { jobs };
  },
};

// ── save_finding ─────────────────────────────────────────────────────────────
const SaveFindingArgs = z.object({
  topic: z.string().min(1).max(200),
  claim: z.string().min(1).max(1000),
  sourceUrl: z.string().url().nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
});

const saveFindingTool: ToolDefinition = {
  name: 'save_finding',
  description: 'Persist one research finding for the current agent run.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      claim: { type: 'string' },
      sourceUrl: { type: 'string', nullable: true },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['topic', 'claim'],
  },
  zodSchema: SaveFindingArgs,
  execute: async (args) => {
    SaveFindingArgs.parse(args);
    // Findings are returned to the runner (persisted with the run);
    // kept tool-side simple and side-effect free.
    return { saved: true };
  },
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  webSearchTool,
  fetchPageTool,
  companyLookupTool,
  saveFindingTool,
];

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
