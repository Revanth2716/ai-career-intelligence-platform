# Architecture

## System overview

```
React SPA (Vite build / nginx)
        │  HTTPS / JSON, Bearer JWT
        ▼
Express API (/api/v1) ──► background worker (in-process queue)
        │                        │
        ▼                        ▼
  PostgreSQL 16 + pgvector (entities + vectors + audit + LLM cost ledger)
```

## Layers (server)

- **HTTP**: routes + zod validation middleware; no business logic.
- **Services**: domain logic (jobs, resumes, matching, search); ownership checks here.
- **Lib/algorithms**: pure DSA (BM25, heap, RRF, LRU, token bucket) — no I/O, unit-tested.
- **AI**: provider ports (LLM/embeddings), pipelines, RAG, agents, guardrails, tracking.
- **Jobs**: FIFO queue with bounded concurrency, retries, dead-letter → entity FAILED.
- **Observability**: requestId correlation, pino JSON logs, Prometheus metrics.

## Request lifecycle

1. `helmet` → CORS allowlist → JSON body limit → `requestContext` (requestId) →
   metrics middleware → token-bucket rate limit.
2. Router → `validate(zod)` → `requireAuth` (HS256, alg pinned) → handler.
3. Handler throws domain errors → single global error handler → uniform envelope
   `{ error, code, details?, requestId }`.
4. `res.on('finish')` records route/method/status histogram.

## Deterministic-first matching

1. Deterministic scorer: weighted skill coverage with alias normalisation + partial
   credit; evidence extracted from resume lines (no LLM).
2. RAG: top-3 posting chunks via pgvector cosine (HNSW).
3. LLM explanation (only if configured): evidence phrasing + gap suggestions, strictly
   schema-validated. Failure ⇒ report is still produced (score-only, flagged
   `DETERMINISTIC`).

## Scaling path (documented, not built)

- Stateless API → horizontal scale behind a load balancer.
- Queue interface → swap in BullMQ/Redis without touching call sites.
- Cache interface → swap LRU for Redis.
- pgvector scales to millions of vectors with HNSW; at larger N, move to a dedicated
  vector service behind the same `retrieveChunks` interface.
