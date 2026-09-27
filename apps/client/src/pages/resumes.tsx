import { useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityStatus } from '@career/shared';
import { api, apiErrorMessage } from '../api/client';
import { Badge, Button, Card, ErrorNote, Field, SkillChip, Spinner } from '../components/ui';

interface ResumeItem {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: EntityStatus;
  createdAt: string;
}

interface ParsedShape {
  skills?: string[];
  summary?: string;
}

export function ResumesPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const resumes = useQuery({
    queryKey: ['resumes'],
    queryFn: async () => (await api.get<{ items: ResumeItem[] }>('/resumes')).data,
  });

  const details = useQuery({
    queryKey: ['resume', resumes.data?.items[0]?.id],
    enabled: (resumes.data?.items.length ?? 0) > 0,
    queryFn: async () =>
      (await api.get<ResumeItem & { parsedJson: ParsedShape | null; rawText: string }>(`/resumes/${resumes.data!.items[0]!.id}`)).data,
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function upload() {
    if (file === null) {
      setError('Choose a file first');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (title.trim() !== '') form.append('title', title);
      await api.post('/resumes', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile(null);
      setTitle('');
      await qc.invalidateQueries({ queryKey: ['resumes'] });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Resumes</h2>
      </div>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
        >
          <Field label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={onFile} />
          <Button type="submit" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload & parse'}
          </Button>
        </form>
        {error !== '' && <ErrorNote message={error} />}
      </Card>

      {resumes.isLoading && <Spinner />}
      {resumes.data !== undefined && resumes.data.items.length === 0 && (
        <Card>
          <p className="muted">No resumes yet. Upload a PDF, DOCX or TXT — text extraction and parsing run in the background.</p>
        </Card>
      )}
      <div className="grid">
        {resumes.data?.items.map((r) => (
          <Card key={r.id}>
            <div className="job-head">
              <strong>{r.title}</strong>
              <Badge tone={r.status === 'DONE' ? 'good' : r.status === 'FAILED' ? 'bad' : 'warn'}>{r.status}</Badge>
            </div>
            <div className="muted small">
              {r.fileName || 'inline'} · {(r.sizeBytes / 1024).toFixed(0)} KB · {new Date(r.createdAt).toLocaleDateString()}
            </div>
          </Card>
        ))}
      </div>

      {details.data?.parsedJson?.skills !== undefined && details.data.parsedJson.skills.length > 0 && (
        <Card>
          <h3>Parsed skills — {details.data.title}</h3>
          <div className="chips">
            {details.data.parsedJson.skills.map((s) => (
              <SkillChip key={s} skill={s} tone="good" />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
