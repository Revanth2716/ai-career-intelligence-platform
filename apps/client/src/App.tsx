import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './auth/auth-context';
import { LoginPage } from './pages/login';
import { JobsPage } from './pages/jobs';
import { ResumesPage } from './pages/resumes';
import { AgentsPage } from './pages/agents';
import { CostsPage } from './pages/costs';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user !== null ? <>{children}</> : <Navigate to="/login" replace />;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user === null ? <>{children}</> : <Navigate to="/jobs" replace />;
}

function Nav() {
  const { user, logout } = useAuth();
  if (user === null) return null;
  return (
    <nav className="nav">
      <span className="nav-brand">AI Career Intelligence</span>
      <Link to="/jobs">Jobs</Link>
      <Link to="/resumes">Resumes</Link>
      <Link to="/agents">Agents</Link>
      <Link to="/costs">Costs</Link>
      <span className="nav-spacer" />
      <span className="muted">{user.email}</span>
      <button className="btn btn-ghost" onClick={logout}>
        Sign out
      </button>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Nav />
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/jobs"
            element={
              <RequireAuth>
                <JobsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/resumes"
            element={
              <RequireAuth>
                <ResumesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/agents"
            element={
              <RequireAuth>
                <AgentsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/costs"
            element={
              <RequireAuth>
                <CostsPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
