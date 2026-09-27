import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment schema — validated once at boot. The process fails fast with a
 * readable message instead of misbehaving later (12-factor config).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // PORT=0 is valid (ephemeral port); empty strings are filtered below.
  PORT: z.coerce.number().int().min(0).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  MOCK_LLM: z.coerce.boolean().default(true),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(900),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AI_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(2),

  WEB_SEARCH_PROVIDER: z.enum(['none', 'tavily', 'serper']).default('none'),
  TAVILY_API_KEY: z.string().default(''),
  SERPER_API_KEY: z.string().default(''),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(6),
  AGENT_TOKEN_CEILING: z.coerce.number().int().positive().default(20_000),
  MCP_CLIENT_URL: z.string().url().or(z.literal('')).default(''),

  JOB_SKILL_DIR: z.string().default('../../job-skill'),
});

// Empty-string env vars (common in shells/CI: PORT="") must not override
// schema defaults — drop them before validation.
const rawEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && value !== '') rawEnv[key] = value;
}

const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

/** Feature flags derived from env (kept central so modules never read raw env). */
export const features = {
  useRealLlm: !env.MOCK_LLM && env.OPENAI_API_KEY.length > 0,
  webSearch: env.WEB_SEARCH_PROVIDER !== 'none',
  mcpClient: env.MCP_CLIENT_URL.length > 0,
} as const;
