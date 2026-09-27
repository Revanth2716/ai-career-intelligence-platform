-- Initial schema (generated to match prisma/schema.prisma)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "EntityStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "JobSource" AS ENUM ('URL', 'MANUAL', 'SEED');
CREATE TYPE "ScoreSource" AS ENUM ('DETERMINISTIC', 'LLM_EXPLAINED');
CREATE TYPE "AgentKind" AS ENUM ('RESEARCH_JOB', 'VERIFY_COMPANY');
CREATE TYPE "AgentStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');
CREATE TYPE "LlmPurpose" AS ENUM ('PARSE', 'MATCH', 'EMBED', 'AGENT', 'GUARDRAIL');
CREATE TYPE "CallStatus" AS ENUM ('OK', 'ERROR');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsedJson" JSONB,
    "status" "EntityStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "url" TEXT,
    "source" "JobSource" NOT NULL DEFAULT 'MANUAL',
    "rawText" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'PENDING',
    "requirementsJson" JSONB,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "employmentType" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobEmbedding" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "vector" vector(1536),
    "model" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    CONSTRAINT "JobEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "scoreSource" "ScoreSource" NOT NULL DEFAULT 'DETERMINISTIC',
    "matchedSkills" JSONB NOT NULL,
    "missingSkills" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "citedChunkIdx" JSONB,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "kind" "AgentKind" NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" "LlmPurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "ip" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Uniques
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "RefreshToken_userId_tokenHash_key" ON "RefreshToken"("userId", "tokenHash");
CREATE UNIQUE INDEX "Job_userId_url_key" ON "Job"("userId", "url");
CREATE UNIQUE INDEX "JobEmbedding_jobId_chunkIndex_key" ON "JobEmbedding"("jobId", "chunkIndex");
CREATE UNIQUE INDEX "MatchReport_resumeId_jobId_key" ON "MatchReport"("resumeId", "jobId");

-- FKs
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobEmbedding" ADD CONSTRAINT "JobEmbedding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Performance indexes
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "user_email_lower_idx" ON "User"(lower("email"));
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
CREATE INDEX "Resume_userId_createdAt_idx" ON "Resume"("userId", "createdAt");
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");
CREATE INDEX "Job_company_idx" ON "Job"("company");
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "MatchReport_userId_createdAt_idx" ON "MatchReport"("userId", "createdAt");
CREATE INDEX "AgentRun_userId_startedAt_idx" ON "AgentRun"("userId", "startedAt");
CREATE INDEX "LlmCall_purpose_createdAt_idx" ON "LlmCall"("purpose", "createdAt");
CREATE INDEX "LlmCall_userId_createdAt_idx" ON "LlmCall"("userId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CHECK constraint: match score bounds
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_score_check" CHECK ("score" >= 0 AND "score" <= 100);
