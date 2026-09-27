import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobDto, JobSearchHit, MatchReportDto } from '@career/shared';
import { api, apiErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorNote, Field, ScoreRing, SkillChip, Spinner, TextArea } from '../components/ui';

type JobList = { items: JobDto[]; total: number };

export function JobsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<JobSearchHit[] | null>(null);
  const [error, setError] = useState('');

  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get<JobList>('/jobs')).data,
  });

  const addManual = useMutation({
    mutationFn: async (payload: { title: string; company: string; location: string; rawText: string }) =>
      (await api.post('/jobs', payload)).data,
    onSuccess: () => {
      setShowAdd(false);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const addFromUrl = useMutation({
    mutationFn: async (url: string) => (await api.post('/jobs/from-url', { url })).data,
    onSuccess: () => {
      setShowAdd(false);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function runSearch(e: FormEvent) {
    e.preventDefault();
    setError('');
    api
      .get<{ hits: JobSearchHit[] }>('/jobs/search', { params: { q: query } })
      .then((r) => setSearchResults(r.data.hits))
      .catch((err) => setError(apiErrorMessage(err)));
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Jobs</h2>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Close' : '+ Add job'}</Button>
      </div>

      {showAdd && (
        <AddJobCard
          manual={(payload) => addManual.mutate(payload)}
          fromUrl={(url) => addFromUrl.mutate(url)}
          busy={addManual.isPending || addFromUrl.isPending}
        />
      )}

      <Card className="search-card">
        <form onSubmit={runSearch} className="search-form">
          <input
            placeholder="Semantic search — e.g. “backend python rest apis”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>
        {searchResults !== null && (
          <div className="search-results">
            {searchResults.length === 0 && <p className="muted">No matching jobs yet — parse some jobs first.</p>}
            {searchResults.map((hit) => (
              <div key={hit.jobId} className="search-hit">
                <strong>{hit.title}</strong> <span className="muted">· {hit.company}</span>
                <span className="muted small"> score {hit.score}</span>
                {hit.snippet !== '' && <p className="muted small">{hit.snippet}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {error !== '' && <ErrorNote message={error} />}
      {jobs.isLoading && <Spinner />}
      {jobs.data !== undefined && jobs.data.items.length === 0 && (
        <Card>
          <p className="muted">No jobs yet. Add one manually or paste a job-posting URL.</p>
        </Card>
      )}
      <div className="grid">
        {jobs.data?.items.map((job) => (
          <Card key={job.id} className="job-card">
            <div className="job-head">
              <strong>{job.title}</strong>
              <StatusBadge status={job.status} />
            </div>
            <div className="muted">
              {job.company} · {job.location || '—'}
            </div>
            <JobDetail jobId={job.id} />
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobDto['status'] }) {
  const tone = status === 'DONE' ? 'good' : status === 'FAILED' ? 'bad' : 'warn';
  return <Badge tone={tone}>{status}</Badge>;
}

function AddJobCard({
  manual,
  fromUrl,
  busy,
}: {
  manual: (payload: { title: string; company: string; location: string; rawText: string }) => void;
  fromUrl: (url: string) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<'manual' | 'url'>('manual');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [rawText, setRawText] = useState('');
  const [url, setUrl] = useState('');

  return (
    <Card className="add-card">
      <div className="tabs">
        <button className={tab === 'manual' ? 'tab active' : 'tab'} onClick={() => setTab('manual')}>
          Paste text
        </button>
        <button className={tab === 'url' ? 'tab active' : 'tab'} onClick={() => setTab('url')}>
          From URL
        </button>
      </div>
      {tab === 'manual' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            manual({ title, company, location, rawText });
          }}
        >
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
          <Field label="Company" value={company} onChange={(e) => setCompany(e.target.value)} required />
          <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <TextArea label="Job description" rows={6} value={rawText} onChange={(e) => setRawText(e.target.value)} required minLength={30} />
          <Button type="submit" disabled={busy}>
            Add & parse
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fromUrl(url);
          }}
        >
          <Field label="Posting URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <Button type="submit" disabled={busy}>
            Fetch & parse
          </Button>
          <p className="muted small">The server fetches the page (SSRF-guarded), extracts the text and parses it in the background.</p>
        </form>
      )}
    </Card>
  );
}

function JobDetail({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [resumeId, setResumeId] = useState('');
  const [report, setReport] = useState<MatchReportDto | null>(null);
  const [error, setError] = useState('');

  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => (await api.get<JobDto & { requirementsJson: { requirements?: Array<{ skill: string; importance: number }> } | null }>(`/jobs/${jobId}`)).data,
  });

  const resumes = useQuery({
    queryKey: ['resumes'],
    queryFn: async () => (await api.get<{ items: Array<{ id: string; title: string }> }>('/resumes')).data,
  });

  const match = useMutation({
    mutationFn: async () => (await api.post<MatchReportDto>('/matches', { resumeId, jobId })).data,
    onSuccess: (data) => {
      setReport(data);
      void qc.invalidateQueries({ queryKey: ['job', jobId] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const requirements = job.data?.requirementsJson?.requirements ?? [];

  const reparse = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${jobId}/parse`)).data,
    onSuccess: () => {
      // Poll until the worker finishes, then refresh the card.
      const timer = setInterval(() => {
        void qc.invalidateQueries({ queryKey: ['job', jobId] });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
      }, 1500);
      setTimeout(() => clearInterval(timer), 15_000);
    },
  });

  return (
    <div className="job-detail">
      {requirements.length > 0 && (
        <div className="chips">
          {requirements.slice(0, 8).map((r) => (
            <SkillChip key={r.skill} skill={r.skill} tone={r.importance >= 0.7 ? 'good' : 'warn'} title={`importance ${r.importance}`} />
          ))}
        </div>
      )}
      {job.data?.status !== 'DONE' && (
        <div className="parse-row">
          <Button variant="ghost" onClick={() => reparse.mutate()} disabled={reparse.isPending}>
            {reparse.isPending ? 'Queued…' : 'Parse job'}
          </Button>
        </div>
      )}
      <div className="match-row">
        <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
          <option value="">Choose resume…</option>
          {resumes.data?.items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <Button onClick={() => match.mutate()} disabled={resumeId === '' || match.isPending}>
          {match.isPending ? 'Matching…' : 'Match'}
        </Button>
      </div>
      {error !== '' && <ErrorNote message={error} />}
      {report !== null && <MatchMiniReport report={report} />}
    </div>
  );
}

export function MatchMiniReport({ report }: { report: MatchReportDto }) {
  return (
    <div className="mini-report">
      <ScoreRing score={report.score} />
      <div className="mini-report-body">
        <p>{report.summary}</p>
        <div className="chips">
          {report.matchedSkills.slice(0, 6).map((m) => (
            <SkillChip key={m.skill} skill={`✓ ${m.skill}`} tone="good" title={m.evidence} />
          ))}
          {report.missingSkills.slice(0, 6).map((m) => (
            <SkillChip key={m.skill} skill={`✗ ${m.skill}`} tone="bad" title={m.suggestion} />
          ))}
        </div>
        <p className="muted small">
          {report.scoreSource === 'LLM_EXPLAINED' ? `LLM-explained (${report.model ?? ''})` : 'Deterministic score'} ·{' '}
          {report.tokensIn + report.tokensOut} tokens · ${report.costUsd.toFixed(4)}
        </p>
      </div>
    </div>
  );
}
