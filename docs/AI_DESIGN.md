# AI design

## Provider abstraction

`LlmProvider` / `EmbeddingProvider` ports; adapters:

- `OpenAiCompatProvider` — any OpenAI-compatible endpoint (`OPENAI_BASE_URL`):
  OpenAI, free-tier proxies, Ollama, LM Studio.
- `MockLlmProvider` — deterministic offline provider: full product behaviour at $0,
  stable tests/evals, no network.
- Selection at container wiring from env (`MOCK_LLM`, key presence).

Every chat call supports `responseJsonSchema` (JSON mode) and native `tools`.

## Structured outputs

`getStructuredOutput`: prompt → JSON reply → zod validate → on failure retry with the
validation error appended (max 2). Everything persisted from an LLM passed a schema.

## Pipelines

| Pipeline | Input → output | Fallback |
|---|---|---|
| parse-job | raw posting → title/company/location + weighted requirements | deterministic keyword parser |
| parse-resume | resume text → skills/experience/education | raw-text stub (status DONE, score-only matching) |
| match-explain | deterministic score + RAG chunks → evidence + gaps | score-only report (flagged `DETERMINISTIC`) |

## RAG

Chunking (~800 tokens, overlap) → batched embeddings → `JobEmbedding.vector(1536)`
(HNSW, cosine) → top-k retrieval with cached query embeddings. `/jobs/search` fuses
vector + BM25 rankings via Reciprocal Rank Fusion.

## Agents

Bounded loop (AGENT_MAX_STEPS, default 6): chat with native tool calling → execute
zod-validated tool args → scan results for injection → feed back as delimited untrusted
data → final JSON answer, schema-validated. Events stream to the UI over SSE; every
step lands in `AgentRun.steps` with token/cost totals.

Tools: `web_search` (Tavily/Serper, env-gated), `fetch_page` (SSRF-guarded readability),
`company_lookup` (platform data), `save_finding`. The same tool functions are exposed
over MCP stdio (`pnpm mcp`) for external MCP clients.

## Guardrails

1. **Prompt injection** — heuristic scanner (instruction-override patterns) +
   structural defence: untrusted text is always wrapped in `<UNTRUSTED_CONTENT>` with a
   system rule that it is data, never instructions; flagged steps are marked in the UI.
2. **PII** — emails/phones/URLs masked before provider calls and logs.
3. **Output schemas** — invalid model output cannot be persisted.
4. **Blast radius** — AI endpoints rate-limited separately; max tokens capped;
   step budgets bounded.

## Evaluation

`src/ai/evals/cases.yaml` defines match cases (expected score bands) and parse cases
(expected skills → F1). `pnpm evals` grades the active provider (deterministic parser
under MOCK_LLM, LLM otherwise) and exits non-zero on regression. CI runs the job
opt-in when `OPENAI_API_KEY` is configured.

## Cost tracking

`trackCall` wraps every provider call: purpose-tagged tokens/latency/cost (list-price
table) → `LlmCall` table + Prometheus counters → `/costs/summary` + dashboard UI.
Embedding and parse caches make repeated operations free.
