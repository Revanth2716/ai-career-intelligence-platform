/**
 * End-to-end verification against a LIVE server (no in-process boot).
 *
 * Usage:  npx tsx src/scripts/e2e.ts          (server on :4000, MOCK_LLM=true)
 * Env:    E2E_BASE_URL to target another instance.
 *
 * Verifies: health/ready, auth, job create → background parse (mock LLM) →
 * requirements, semantic search (mock embeddings + pgvector), resume upload →
 * background parse, match (deterministic + LLM-explained), agent run (SSE),
 * cost summary, Prometheus metrics. No paid API calls.
 */
const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:4000';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  // ── 1. observability endpoints ──
  const health = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ status: string }>);
  check('GET /health', health.status === 'ok');

  const ready = await fetch(`${BASE}/ready`).then((r) => r.json() as Promise<{ status: string }>);
  check('GET /ready (DB ping)', ready.status === 'ready');

  // ── 2. auth ──
  const email = `e2e-${Date.now()}@test.local`;
  const register = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'E2eTest123x', name: 'E2E Runner' }),
  });
  check('POST /auth/register', register.status === 201);
  const { accessToken } = (await register.json()) as { accessToken: string };
  const auth = { Authorization: `Bearer ${accessToken}` };

  // ── 3. job create → background parse (mock LLM) ──
  const job = await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Backend Engineer',
      company: 'E2E Corp',
      location: 'Bengaluru',
      rawText:
        'Backend Engineer at E2E Corp.\n\nRequired: strong python and sql experience. ' +
        'Experience building rest apis is required. Nice to have: docker and kubernetes. ' +
        'We build scalable data platforms.',
    }),
  });
  check('POST /jobs (201)', job.status === 201);
  const { id: jobId } = (await job.json()) as { id: string };

  // Wait for the background worker to parse (poll status).
  let jobStatus = 'PENDING';
  for (let i = 0; i < 20 && jobStatus !== 'DONE'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const j = await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: auth }).then(
      (r) => r.json() as Promise<{ status: string; requirementsJson: { requirements?: unknown[] } | null }>,
    );
    jobStatus = j.status;
    if (jobStatus === 'DONE') {
      const reqCount = j.requirementsJson?.requirements?.length ?? 0;
      check('job parsed by background worker (mock LLM)', reqCount > 0, `${reqCount} requirements`);
    }
  }
  if (jobStatus !== 'DONE') check('job parsed by background worker', false, 'timeout');

  // ── 4. semantic search (mock embeddings + pgvector) ──
  const search = await fetch(`${BASE}/api/v1/jobs/search?q=python%20rest%20apis&k=5`, { headers: auth });
  const hits = (await search.json()) as { hits: Array<{ jobId: string; score: number }> };
  check('GET /jobs/search (hybrid)', search.status === 200 && hits.hits.some((h) => h.jobId === jobId));

  // ── 5. resume upload → background parse ──
  const resumeText =
    'Alex Candidate\nSkills: python, javascript, sql, node, react, rest, testing\n' +
    'Experience: Software Intern at Example Corp\n- Built REST APIs with node and postgresql\n' +
    'Education: B.Tech CSE, Example University, 2024';
  const form = new FormData();
  form.append('file', new Blob([resumeText], { type: 'text/plain' }), 'resume.txt');
  form.append('title', 'E2E Resume');
  const resume = await fetch(`${BASE}/api/v1/resumes`, { method: 'POST', headers: auth, body: form });
  check('POST /resumes (upload)', resume.status === 201);
  const { id: resumeId } = (await resume.json()) as { id: string };

  let resumeStatus = 'PENDING';
  for (let i = 0; i < 20 && resumeStatus !== 'DONE'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await fetch(`${BASE}/api/v1/resumes/${resumeId}`, { headers: auth }).then(
      (res) => res.json() as Promise<{ status: string; parsedJson: { skills?: string[] } | null }>,
    );
    resumeStatus = r.status;
    if (resumeStatus === 'DONE') {
      check('resume parsed (mock LLM)', (r.parsedJson?.skills?.length ?? 0) > 0, `${r.parsedJson?.skills?.length ?? 0} skills`);
    }
  }
  if (resumeStatus !== 'DONE') check('resume parsed', false, 'timeout');

  // ── 6. match (deterministic + mock LLM explanation) ──
  const match = await fetch(`${BASE}/api/v1/matches`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId, jobId }),
  });
  const report = (await match.json()) as {
    score: number;
    scoreSource: string;
    matchedSkills: Array<{ skill: string }>;
    missingSkills: Array<{ skill: string }>;
    summary: string;
    tokensIn: number;
  };
  check('POST /matches (201)', match.status === 201, `score ${report.score}`);
  check(
    'match is LLM-explained with evidence',
    report.scoreSource === 'LLM_EXPLAINED' && report.matchedSkills.length > 0 && report.summary.length > 0,
    `${report.matchedSkills.length} matched, ${report.missingSkills.length} missing`,
  );
  check('match token tracking recorded', report.tokensIn > 0, `${report.tokensIn} tokens in`);

  // Idempotency: same pair returns existing report.
  const rematch = await fetch(`${BASE}/api/v1/matches`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId, jobId }),
  });
  check('POST /matches idempotent', rematch.status === 200 || rematch.status === 201);

  // ── 7. agent run over SSE ──
  const agentRes = await fetch(`${BASE}/api/v1/agents/runs`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'RESEARCH_JOB', jobId }),
  });
  const body = await agentRes.text();
  const events = body
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '')
    .filter((s) => s.length > 0)
    .map((s) => JSON.parse(s) as { type: string });
  check('POST /agents/runs (SSE stream)', agentRes.ok && events.some((e) => e.type === 'run_started'));
  check('agent reached final answer', events.some((e) => e.type === 'final'));

  // ── 8. cost summary + metrics ──
  const costs = (await fetch(`${BASE}/api/v1/costs/summary`, { headers: auth }).then((r) => r.json())) as {
    totalCalls: number;
    totalCostUsd: number;
  };
  check('GET /costs/summary', costs.totalCalls > 0, `${costs.totalCalls} calls, $${costs.totalCostUsd.toFixed(5)}`);
  check('LLM spend is $0 (mock)', costs.totalCostUsd === 0);

  const metrics = await fetch(`${BASE}/metrics`).then((r) => r.text());
  check(
    'GET /metrics (prometheus)',
    metrics.includes('career_http_requests_total') && metrics.includes('career_llm_tokens_total'),
  );

  console.log(`\n${failures === 0 ? '✅ ALL E2E CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`} — base: ${BASE}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
