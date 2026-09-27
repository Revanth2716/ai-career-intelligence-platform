import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorNote, Field, Spinner } from '../components/ui';

interface Step {
  index: number;
  toolName?: string;
  tool?: string;
  note?: string;
  injectionFlag?: boolean;
}

interface AgentRun {
  id: string;
  kind: string;
  status: string;
  steps: Step[];
  output: { answer?: string; findings?: Array<{ topic: string; claim: string; sourceUrl?: string | null; confidence: string }> } | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

type LiveEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'step'; index: number; toolName?: string; note: string }
  | { type: 'tool_result'; index: number; toolName: string; result: unknown; injectionFlag: boolean }
  | { type: 'final'; output: { answer: string; findings: unknown[] } }
  | { type: 'error'; message: string };

export function AgentsPage() {
  const [jobId, setJobId] = useState('');
  const [kind, setKind] = useState<'RESEARCH_JOB' | 'VERIFY_COMPANY'>('RESEARCH_JOB');
  const [question, setQuestion] = useState('');
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get<{ items: Array<{ id: string; title: string; company: string }> }>('/jobs')).data,
  });

  const runs = useQuery({
    queryKey: ['agent-runs'],
    queryFn: async () => (await api.get<{ items: AgentRun[] }>('/agents/runs')).data,
  });

  async function start(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEvents([]);
    setRunning(true);
    try {
      const res = await fetch(`${import.meta.env['VITE_API_URL'] ?? '/api/v1'}/agents/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${JSON.parse(localStorage.getItem('career.tokens') ?? '{}')['accessToken'] ?? ''}`,
        },
        body: JSON.stringify({ kind, jobId: jobId === '' ? undefined : jobId, question: question === '' ? undefined : question }),
      });
      if (!res.ok || res.body === null) throw new Error(`Agent start failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine === undefined) continue;
          try {
            const event = JSON.parse(dataLine.slice(6)) as LiveEvent;
            setEvents((prev) => [...prev, event]);
          } catch {
            // ignore keep-alive/comment lines
          }
        }
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setRunning(false);
      void runs.refetch();
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Research agents</h2>
      </div>

      <Card>
        <form onSubmit={start}>
          <label className="field">
            <span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as 'RESEARCH_JOB' | 'VERIFY_COMPANY')}>
              <option value="RESEARCH_JOB">Research job & company</option>
              <option value="VERIFY_COMPANY">Verify company</option>
            </select>
          </label>
          <label className="field">
            <span>Job (optional)</span>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">None</option>
              {jobs.data?.items.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} — {j.company}
                </option>
              ))}
            </select>
          </label>
          <Field label="Question (optional)" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} />
          <Button type="submit" disabled={running}>
            {running ? 'Running…' : 'Start agent run'}
          </Button>
        </form>
        {error !== '' && <ErrorNote message={error} />}
      </Card>

      {running && <Spinner label="Agent working…" />}

      {events.length > 0 && (
        <Card>
          <h3>Live timeline</h3>
          <ol className="timeline">
            {events.map((ev, i) => (
              <li key={i}>
                {ev.type === 'run_started' && <span className="muted">Run started</span>}
                {ev.type === 'step' && (
                  <span>
                    step {ev.index}: {ev.note}
                  </span>
                )}
                {ev.type === 'tool_result' && (
                  <span>
                    🔧 <strong>{ev.toolName}</strong> {ev.injectionFlag ? <Badge tone="bad">injection flagged</Badge> : null}
                  </span>
                )}
                {ev.type === 'final' && <span>✅ {ev.output.answer}</span>}
                {ev.type === 'error' && <Badge tone="bad">{ev.message}</Badge>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <h3>Past runs</h3>
      {runs.isLoading && <Spinner />}
      {runs.data?.items.map((run) => (
        <Card key={run.id}>
          <div className="job-head">
            <strong>{run.kind}</strong>
            <Badge tone={run.status === 'DONE' ? 'good' : run.status === 'FAILED' ? 'bad' : 'warn'}>{run.status}</Badge>
          </div>
          {run.output?.answer !== undefined && <p>{run.output.answer}</p>}
          <p className="muted small">
            {run.steps.length} steps · {run.tokensIn + run.tokensOut} tokens · ${run.costUsd.toFixed(4)}
          </p>
        </Card>
      ))}
    </div>
  );
}
