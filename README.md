# AI Career Intelligence Platform

Full-stack, production-style career platform: manage resumes and job postings, parse
requirements with LLMs (or a deterministic fallback), find jobs semantically
(pgvector + BM25 hybrid ranked by Reciprocal Rank Fusion), generate explainable
resume↔job match reports, and run tool-calling research agents — with token/cost
tracking, guardrails, observability and CI.

Built as a pnpm monorepo:

```
apps/server     Express + TypeScript REST API (port 4000)
apps/client     React 19 + Vite SPA (port 5173 dev / 8080 prod)
packages/shared Zod schemas + TypeScript contracts shared by both apps
db/             Postgres init SQL + synthetic seed data (db/seed)
docker/         Dockerfiles + nginx config
docs/           Architecture, API, AI design and decision records
```

> **Runs fully offline by default.** `MOCK_LLM=true` ships a deterministic mock
> LLM + embedding provider, so every feature works with no API key and zero cost.

## Key features

- **Resume manager** — upload PDF/DOCX/TXT/MD; text extraction and parsing run in a
  background worker with status tracking.
- **Job ingestion** — paste a posting, or fetch one from a URL (SSRF-guarded
  server-side fetch + main-content extraction).
- **AI parsing with fallback** — LLM structured output (zod-enforced, retried on
  invalid output); deterministic keyword parser as fallback, so parsing never
  hard-fails.
- **Explainable matching** — deterministic weighted skill-coverage score (alias
  normalisation + partial credit) computed in code, then an LLM explanation pass with
  per-skill evidence quotes and gap suggestions. Degrades to score-only without an LLM.
- **Hybrid semantic search** — pgvector cosine (HNSW) + hand-built BM25 inverted
  index, fused via Reciprocal Rank Fusion.
- **Research agents** — bounded tool-calling loop (web_search, fetch_page,
  company_lookup, save_finding) streamed to the UI over SSE; also exposed via a
  JSON-RPC **MCP stdio server** (`pnpm mcp`).
- **Guardrails** — prompt-injection scanner on untrusted content, PII masking before
  provider calls, schema-validated outputs, per-user AI rate limits.
- **Observability** — requestId-correlated JSON logs, `/health`, `/ready`,
  Prometheus `/metrics` (HTTP latency, cache hit-rate, queue depth, LLM tokens/cost).
- **Cost tracking** — every provider call lands in a `LlmCall` ledger →
  `/costs/summary` + UI dashboard. Mock calls are recorded as $0.

## Architecture

```
React SPA (Vite / nginx)
        │  REST /api/v1 (Bearer JWT)
        ▼
Express API ──► in-process background worker (FIFO queue, retries, dead-letter)
        │                 │
        ▼                 ▼
PostgreSQL 16 + pgvector (entities, vectors, audit log, LLM cost ledger)
```

Two-stage matching design: **compute the score deterministically in code, use the LLM
only to explain it** — cheap, testable, no hallucinated scores, graceful degradation.
Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), API contract in
[docs/API.md](docs/API.md), AI design in [docs/AI_DESIGN.md](docs/AI_DESIGN.md), and
trade-offs in [docs/DECISIONS.md](docs/DECISIONS.md).

## Technology stack

| Layer | Choices |
|---|---|
| Frontend | React 19, Vite, React Router, TanStack Query, axios, Vitest + Testing Library |
| Backend | Node.js 22, Express, TypeScript (ESM), Zod, pino, prom-client |
| Data | PostgreSQL 16 + pgvector (HNSW), Prisma ORM |
| Auth | bcrypt (cost 12), HS256 access JWTs, rotating refresh tokens with reuse detection |
| AI | OpenAI-compatible chat/embeddings SDK, deterministic mock provider, MCP stdio server |
| Ops | Docker Compose, nginx, GitHub Actions CI, pnpm workspaces |

## Traditional software-engineering concepts demonstrated

- **DSA**: BM25 ranking over a hand-built inverted index; binary min-heap for bounded
  top-k; Reciprocal Rank Fusion; LRU+TTL cache (Map insertion-order trick); token-bucket
  rate limiter; FIFO task queue with concurrency pool and exponential backoff.
- **OOP / clean architecture**: ports & adapters (LlmProvider, EmbeddingProvider,
  CacheStore, TaskQueue), manual DI container, Strategy/Factory/Template patterns,
  layered routes → services → data access.
- **DBMS**: 3NF schema with FK cascades, composite unique constraints, CHECK
  constraint, functional index on `lower(email)`, HNSW vector index, multi-statement
  transactions (`$transaction`) for match+audit and parse+index flows.
- **REST design**: versioned `/api/v1`, resource nouns, correct status codes
  (201/202/204/401/403/404/409/422/429), uniform error envelope, `X-Total-Count`
  pagination, idempotent match creation via DB constraint.
- **AuthN/AuthZ**: bcrypt hashing, alg-pinned JWT verification, refresh-token rotation
  with family-wide replay revocation, role gates, per-row ownership checks returning
  404 (no existence leak).
- **Validation & errors**: shared zod contracts used by client forms *and* server
  middleware; declarative `validate()` middleware; single global error handler.
- **Concurrency**: background worker with bounded parallelism, atomic dead-letter
  handling, graceful SIGTERM drain.
- **Caching**: cache-aside service with TTL/LRU, prefix invalidation on re-parse,
  hit-rate exposed as a metric.
- **Rate limiting**: token bucket per IP (global) and per user (AI endpoints),
  `429` + `Retry-After`.
- **Security**: SSRF-safe fetching (scheme allowlist, DNS-resolution IP checks,
  redirect re-validation, size/time caps), helmet, CORS allowlist, magic-byte-checked
  multipart uploads, parameterised SQL only.
- **Observability**: requestId correlation, structured logs, Prometheus histograms,
  health/readiness probes.
- **Testing**: unit (pure algorithms + guardrails + scorer), API integration
  (Supertest against a real Postgres), client component tests, live E2E script.
- **CI/CD**: GitHub Actions pipeline (lint → typecheck → unit → integration with a
  pgvector service container → builds → docker build → opt-in AI evals).

## AI-engineering concepts demonstrated

- **LLM provider abstraction** with three swappable adapters: OpenAI-compatible,
  deterministic **mock** (offline/$0), and any `OPENAI_BASE_URL` endpoint (Ollama etc.).
- **Structured outputs**: every pipeline declares a zod schema; invalid model output is
  retried with the validation error appended; usage tracked across attempts.
- **Embeddings + pgvector**: batched embedding, content-hash caching, HNSW cosine index.
- **RAG**: chunking (target-size invariant + overlap), vector retrieval grounding the
  match-explanation prompt.
- **Hybrid search + RRF** instead of naive score mixing.
- **Agents & tool calling**: bounded loop, zod-validated tool arguments, native OpenAI
  tool-call protocol, SSE event streaming, per-run token ceilings.
- **MCP**: same tools exposed over JSON-RPC stdio (`pnpm mcp`) for external MCP clients.
- **Prompt-injection protection**: heuristic scanner + structural defence (untrusted
  content wrapped as delimited data, never instructions).
- **PII protection**: emails/phones/URLs masked before provider calls and logs.
- **AI evaluation**: YAML case set with expected score bands and skill-F1 thresholds
  (`pnpm evals`), wired into CI as an opt-in job.
- **Token/cost tracking**: purpose-tagged ledger per call, surfaced in metrics + UI.

## Local setup

```bash
cp .env.example .env          # dev-safe defaults; MOCK_LLM=true
pnpm install
docker compose up -d db       # Postgres 16 + pgvector on host port 5433
cp .env apps/server/.env      # Prisma/tsx read env from the package dir
pnpm db:migrate               # or: prisma migrate deploy
pnpm seed                     # synthetic demo data → demo@career.local / Demo1234!x
pnpm dev                      # API :4000 + client :5173
```

Open http://localhost:5173 and sign in with the demo account.

## Docker setup

```bash
cp .env.example .env
docker compose up --build     # db + server :4000 + client :8080 (nginx)
```

## Environment configuration

All configuration lives in `.env` (see [.env.example](.env.example), every var
documented). Highlights:

- `MOCK_LLM=true` (default) — offline deterministic provider; **no API key, no cost**.
- To use a real model: `MOCK_LLM=false`, set `OPENAI_API_KEY`, and optionally point
  `OPENAI_BASE_URL` at a free proxy or local Ollama (`http://localhost:11434/v1`).
- `DATABASE_URL` defaults to the compose container on `localhost:5433`.
- Change `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` for anything beyond local dev.
- `JOB_SKILL_DIR` — optional private local folder for real seed data (git-ignored).

## Testing

```bash
pnpm test:unit                # fast, pure, no DB (algorithms, guardrails, scorer)
pnpm test:integration         # API tests against the compose Postgres
pnpm --filter @career/client test
pnpm --filter @career/server e2e   # live end-to-end checks (server must be running)
pnpm evals                    # AI evaluation suite (uses mock provider by default)
pnpm smoke                    # in-process smoke test
```

## Screenshots / demo

> _Placeholder — pending screenshots._
>
> - [ ] Login & dashboard
> - [ ] Job board with parsed skill chips and semantic search
> - [ ] Explainable match report (score ring, evidence chips, gap suggestions)
> - [ ] Agent console with live SSE timeline
> - [ ] Cost dashboard

## Security notes

- `.env` files, uploads, logs and the private `job-skill/` folder are git-ignored;
  seed data in `db/seed` is synthetic.
- Refresh tokens are stored hashed; replay revokes the whole token family.
- The URL-fetch service is the only place user-supplied URLs are fetched, and it
  applies SSRF defences (private-range blocking, redirect re-validation, size caps).
- Uploads are magic-byte-checked, size-capped and stored outside version control.
- The platform never sends secrets to LLM providers; PII is masked before calls.
- For deployment: set strong JWT secrets, use HTTPS, and restrict CORS to real origins.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE)
