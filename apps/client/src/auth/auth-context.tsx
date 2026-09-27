import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@career/shared';
import { api, setTokens, setOnLogout, type Tokens } from '../api/client';

interface AuthState {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const persist = useCallback(async (tokens: Tokens) => {
    setTokens(tokens);
    localStorage.setItem('career.tokens', JSON.stringify(tokens));
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me.data);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<Tokens>('/auth/login', { email, password });
      await persist(res.data);
    },
    [persist],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const res = await api.post<Tokens>('/auth/register', { email, password, name });
      await persist(res.data);
    },
    [persist],
  );

  const logout = useCallback(() => {
    setTokens(null);
    localStorage.removeItem('career.tokens');
    setUser(null);
  }, []);

  // Restore session on mount (effect, not render-phase side effect).
  useEffect(() => {
    const saved = localStorage.getItem('career.tokens');
    if (saved !== null) {
      try {
        void persist(JSON.parse(saved) as Tokens);
      } catch {
        localStorage.removeItem('career.tokens');
      }
    }
  }, [persist]);

  useEffect(() => {
    setOnLogout(logout);
  }, [logout]);

  const value = useMemo(() => ({ user, login, register, logout }), [user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
