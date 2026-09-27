# API contract (`/api/v1`)

All responses: JSON. Errors use the envelope `{ error, code, details?, requestId }`.
Auth: `Authorization: Bearer <accessToken>` (15 min). Refresh: rotating, reuse-detecting.
Pagination: `?limit=&offset=` + `X-Total-Count` header.

## Auth

| Method | Path | Body | Responses |
|---|---|---|---|
| POST | /auth/register | `{email, password, name}` | 201 tokens · 409 duplicate · 422 invalid |
| POST | /auth/login | `{email, password}` | 200 tokens · 401 invalid (same error for unknown email/wrong pw) |
| POST | /auth/refresh | `{refreshToken}` | 200 rotated tokens · 401 (replay ⇒ family revoked) |
| POST | /auth/logout | `{refreshToken}` | 204 (idempotent) |
| GET | /auth/me | — | 200 `{id,email,name,role,createdAt}` · 401 |

## Resumes

| Method | Path | Notes |
|---|---|---|
| POST | /resumes | multipart `file` (pdf/docx/txt/md ≤2MB) + optional `title` → 201, parse enqueued |
| GET | /resumes | list (owner-scoped) |
| GET | /resumes/:id | includes rawText + parsedJson (when DONE) |
| POST | /resumes/:id/parse | 202 re-parse (AI rate limit) |
| DELETE | /resumes/:id | 204 |

## Jobs

| Method | Path | Notes |
|---|---|---|
| POST | /jobs | `{title, company, location?, rawText, ...}` → 201, parse enqueued |
| POST | /jobs/from-url | `{url}` → server fetches (SSRF-guarded) → 201; 409 duplicate URL |
| GET | /jobs | `?limit&offset&company&status` + X-Total-Count |
| GET | /jobs/:id | includes parsed requirements when DONE |
| PUT | /jobs/:id | partial update → status reset to PENDING (re-parse required) |
| DELETE | /jobs/:id | 204 |
| POST | /jobs/:id/parse | 202 |
| GET | /jobs/search?q=&k= | hybrid pgvector + BM25 (RRF), AI rate limit; `{hits:[{jobId,title,company,score,snippet,...}]}` |

## Matches

| Method | Path | Notes |
|---|---|---|
| POST | /matches | `{resumeId, jobId}` → 201 report (idempotent per pair); 400 if entities unparsed |
| GET | /matches?resumeId= | recent reports |
| GET | /matches/:id | full report |

Report shape: `{score 0-100, scoreSource DETERMINISTIC|LLM_EXPLAINED, matchedSkills[{skill,evidence,confidence}], missingSkills[{skill,importance,suggestion}], summary, model?, tokensIn, tokensOut, costUsd, latencyMs}`

## Agents (SSE)

| Method | Path | Notes |
|---|---|---|
| POST | /agents/runs | `{kind: RESEARCH_JOB|VERIFY_COMPANY, jobId?, question?}` → **SSE stream** of events: `run_started`, `step`, `tool_result` (with injectionFlag), `final`, `error` |
| GET | /agents/runs | recent runs with steps + token/cost totals |
| GET | /agents/runs/:id | one run |

## Costs / observability

| Method | Path | Notes |
|---|---|---|
| GET | /costs/summary | own spend (admins: all users); cached 60s |
| GET | /health | liveness |
| GET | /ready | DB ping |
| GET | /metrics | Prometheus text format |
