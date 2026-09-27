# Decisions

Concise ADR-style notes for the choices a reviewer will question.

## D1 — Deterministic-first matching
The match score is computed in code (weighted skill coverage, alias normalisation,
partial credit, evidence from resume lines). The LLM only explains and suggests.
Why: $0 core product without an API key, deterministic tests/evals, no hallucinated
scores, graceful degradation, and a clean separation between scoring (algorithmic) and
explanation (generative).

## D2 — Hybrid lexical + vector search with RRF
Vectors alone miss exact keywords ("kubernetes"); BM25 alone misses paraphrase.
Reciprocal Rank Fusion merges the ranked lists without score-scale hacks. The BM25
index is hand-built (inverted index + bounded min-heap top-k) to demonstrate the data
structures; production swaps in Postgres FTS behind the same interface.

## D3 — pgvector over a dedicated vector DB
One database for entities + vectors: fewer services, transactions across relational and
vector data, HNSW suffices at this scale. Qdrant would add ops cost without a
compelling need (kept as a documented future swap behind `retrieveChunks`).

## D4 — Mock-first LLM provider
`MOCK_LLM=true` default: the whole product (including agents with tools) runs offline.
Deterministic outputs make evals stable and CI free. Real providers are one env change
(`OPENAI_BASE_URL` also accepts local Ollama).

## D5 — In-process queue over Redis/BullMQ
Background work (parsing, embedding) is bursty but low-volume here. The FIFO pool with
retries and dead-letter status marking covers it; entity status in Postgres is the
durable source of truth. `enqueue()` is the seam for BullMQ when durability across
restarts matters.

## D6 — Manual DI container
Explicit construction (factory function) instead of a DI framework: inspectable,
zero magic, easy test overrides via `setContainer`.

## D7 — LRU cache by Map insertion order
JS Maps iterate in insertion order, so re-inserting on access reproduces LRU semantics
in O(1) without a hand-rolled doubly-linked list. TTL + stats + interface
(`CacheStore`) retained for a Redis swap.

## D8 — Token-bucket rate limiting (hand-rolled)
Burst-tolerant, tiny, per-key (IP or user), metrics-friendly. Per-user AI buckets are
stricter than the global per-IP bucket. 429 + Retry-After.

## D9 — JSONB only for schema-validated LLM output
Scalar attributes stay normalised (3NF). LLM outputs live in JSONB because their shape
is versioned prompt output, not a relational entity; every write passes a zod schema
first. Trade-off documented; `parsedJson`/`requirementsJson` are the only cases.

## D10 — Skill taxonomy: alias Map, not a trie
Canonicalisation needs exact alias lookup — a Map gives O(1) with ~30 entries. A trie
would pay off only with fuzzy prefix search over thousands of skills.

## D11 — SSRF defences in the fetch service
User-supplied URLs are resolved via DNS and every resulting IP is checked against
private/loopback/link-local ranges before connecting; redirects are followed manually
and re-validated; body size and time capped. The service is the only place in the code
base allowed to fetch user-supplied URLs.

## D12 — Ownership checks return 404, not 403
Non-owners probing ids get 404 (no existence leak). Role gates (`requireRole`) exist
for admin surfaces; per-row checks live in services where the data is.

## D13 — SSE over WebSockets for agent streams
One-directional progress events fit SSE; no extra dependency, works through the nginx
proxy (`proxy_buffering off`), auto-reconnect semantics for free.

## D14 — MCP as an integration surface, not a dependency
The platform's agent calls tool functions in-process. `pnpm mcp` exposes the same
tools over JSON-RPC stdio so external MCP clients (e.g. Claude Desktop) can use them —
demonstrating MCP without adding a runtime requirement.
