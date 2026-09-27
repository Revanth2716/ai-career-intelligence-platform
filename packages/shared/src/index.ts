import { z } from 'zod';

// ─── Shared enums (mirror Prisma enums; kept as string unions for the client) ──
export const RoleSchema = z.enum(['USER', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const EntityStatusSchema = z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

export const JobSourceSchema = z.enum(['URL', 'MANUAL', 'SEED']);
export type JobSource = z.infer<typeof JobSourceSchema>;

export const AgentKindSchema = z.enum(['RESEARCH_JOB', 'VERIFY_COMPANY']);
export type AgentKind = z.infer<typeof AgentKindSchema>;

export const AgentStatusSchema = z.enum(['RUNNING', 'DONE', 'FAILED']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────
export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(10, 'password must be at least 10 characters')
    .max(128)
    .regex(/[a-z]/, 'must contain a lowercase letter')
    .regex(/[A-Z]/, 'must contain an uppercase letter')
    .regex(/[0-9]/, 'must contain a digit'),
  name: z.string().trim().min(1).max(120),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

// ─── Resumes ─────────────────────────────────────────────────────────────────
export const ResumeDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: EntityStatusSchema,
  rawText: z.string().optional(),
  parsedJson: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type ResumeDto = z.infer<typeof ResumeDtoSchema>;

export const ParsedResumeSchema = z.object({
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      bullets: z.array(z.string()).default([]),
    }),
  ),
  education: z.array(
    z.object({
      degree: z.string(),
      institution: z.string().optional(),
      year: z.string().optional(),
    }),
  ),
  summary: z.string().default(''),
});
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

// ─── Jobs ────────────────────────────────────────────────────────────────────
export const JobCreateSchema = z.object({
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).default(''),
  url: z.string().url().max(2048).optional(),
  rawText: z.string().trim().min(30, 'job description too short').max(50_000),
  salaryMin: z.number().int().positive().optional(),
  salaryMax: z.number().int().positive().optional(),
  employmentType: z.string().trim().max(60).optional(),
  postedAt: z.string().datetime().optional(),
});
export type JobCreateInput = z.infer<typeof JobCreateSchema>;

export const JobFromUrlSchema = z.object({
  url: z.string().url().max(2048),
});
export type JobFromUrlInput = z.infer<typeof JobFromUrlSchema>;

export const JobDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string().nullable(),
  source: JobSourceSchema,
  status: EntityStatusSchema,
  requirementsJson: z.unknown().nullable().optional(),
  salaryMin: z.number().int().nullable().optional(),
  salaryMax: z.number().int().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  rawText: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type JobDto = z.infer<typeof JobDtoSchema>;

export const ParsedJobSchema = z.object({
  title: z.string(),
  company: z.string().default(''),
  location: z.string().default(''),
  summary: z.string().default(''),
  requirements: z.array(
    z.object({
      skill: z.string(),
      importance: z.number().min(0).max(1),
      years: z.number().min(0).max(15).optional(),
      category: z.string().default('general'),
    }),
  ),
});
export type ParsedJob = z.infer<typeof ParsedJobSchema>;

// ─── Semantic search ─────────────────────────────────────────────────────────
export const JobSearchHitSchema = z.object({
  jobId: z.string().uuid(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  score: z.number(), // cosine similarity 0..1 (higher = closer)
  snippet: z.string(),
  lexicalRank: z.number().int().nullable().optional(),
  vectorRank: z.number().int().nullable().optional(),
});
export type JobSearchHit = z.infer<typeof JobSearchHitSchema>;

// ─── Matching ────────────────────────────────────────────────────────────────
export const MatchedSkillSchema = z.object({
  skill: z.string(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
});
export type MatchedSkill = z.infer<typeof MatchedSkillSchema>;

export const MissingSkillSchema = z.object({
  skill: z.string(),
  importance: z.number().min(0).max(1),
  suggestion: z.string(),
});
export type MissingSkill = z.infer<typeof MissingSkillSchema>;

export const MatchReportDtoSchema = z.object({
  id: z.string().uuid(),
  resumeId: z.string().uuid(),
  jobId: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  scoreSource: z.enum(['DETERMINISTIC', 'LLM_EXPLAINED']),
  matchedSkills: z.array(MatchedSkillSchema),
  missingSkills: z.array(MissingSkillSchema),
  summary: z.string(),
  model: z.string().nullable().optional(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costUsd: z.number(),
  latencyMs: z.number().int(),
  createdAt: z.string().datetime(),
});
export type MatchReportDto = z.infer<typeof MatchReportDtoSchema>;

export const CreateMatchSchema = z.object({
  resumeId: z.string().uuid(),
  jobId: z.string().uuid(),
});
export type CreateMatchInput = z.infer<typeof CreateMatchSchema>;

// Deterministic scorer output (shared by server scorer and tests)
export const DeterministicScoreSchema = z.object({
  score: z.number().min(0).max(100),
  coverage: z.number().min(0).max(1),
  weightedCovered: z.number(),
  weightedTotal: z.number(),
  perSkill: z.array(
    z.object({
      skill: z.string(),
      importance: z.number(),
      covered: z.boolean(),
      partial: z.boolean(),
      evidence: z.string(),
    }),
  ),
});
export type DeterministicScore = z.infer<typeof DeterministicScoreSchema>;

// ─── Agents ──────────────────────────────────────────────────────────────────
export const AgentRunDtoSchema = z.object({
  id: z.string().uuid(),
  kind: AgentKindSchema,
  status: AgentStatusSchema,
  input: z.unknown(),
  output: z.unknown().nullable().optional(),
  steps: z.array(z.unknown()),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costUsd: z.number(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable().optional(),
});
export type AgentRunDto = z.infer<typeof AgentRunDtoSchema>;

export const CreateAgentRunSchema = z.object({
  kind: AgentKindSchema,
  jobId: z.string().uuid().optional(),
  question: z.string().trim().min(5).max(500).optional(),
});
export type CreateAgentRunInput = z.infer<typeof CreateAgentRunSchema>;

// ─── Cost tracking ───────────────────────────────────────────────────────────
export const CostSummarySchema = z.object({
  totalCalls: z.number().int(),
  totalTokensIn: z.number().int(),
  totalTokensOut: z.number().int(),
  totalCostUsd: z.number(),
  byPurpose: z.array(
    z.object({
      purpose: z.string(),
      calls: z.number().int(),
      tokensIn: z.number().int(),
      tokensOut: z.number().int(),
      costUsd: z.number(),
    }),
  ),
});
export type CostSummary = z.infer<typeof CostSummarySchema>;

// ─── API error envelope ──────────────────────────────────────────────────────
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
