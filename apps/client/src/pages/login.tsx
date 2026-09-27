import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/auth-context';
import { Button, Card, ErrorNote, Field } from '../components/ui';
import { apiErrorMessage } from '../api/client';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <h1>AI Career Intelligence</h1>
        <p className="muted">Resume ↔ job matching, semantic search and research agents.</p>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required minLength={1} />
          )}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
          />
          {error !== '' && <ErrorNote message={error} />}
          <Button type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
        <p className="muted small">Demo (after seed): demo@career.local / Demo1234!x</p>
      </Card>
    </div>
  );
}
