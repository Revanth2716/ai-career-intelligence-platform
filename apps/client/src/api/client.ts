import axios, { AxiosError } from 'axios';

/**
 * API client: baseURL from env (compose sets it), Bearer token injection,
 * single-flight refresh on 401 with request replay.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

const baseURL = import.meta.env['VITE_API_URL'] ?? '/api/v1';

export const api = axios.create({ baseURL });

let tokens: Tokens | null = null;
let onLogout: (() => void) | null = null;

export function setTokens(t: Tokens | null): void {
  tokens = t;
}

export function setOnLogout(fn: () => void): void {
  onLogout = fn;
}

api.interceptors.request.use((config) => {
  if (tokens !== null) {
    config.headers.set?.('Authorization', `Bearer ${tokens.accessToken}`);
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    if (error.response?.status === 401 && original !== undefined && !original._retried && tokens !== null) {
      original._retried = true;
      refreshPromise = refreshPromise ?? refresh();
      const newAccess = await refreshPromise;
      refreshPromise = null;
      if (newAccess !== null) {
        tokens = { ...tokens, accessToken: newAccess };
        return api(original);
      }
      tokens = null;
      onLogout?.();
    }
    return Promise.reject(error);
  },
);

async function refresh(): Promise<string | null> {
  if (tokens === null) return null;
  try {
    const res = await axios.post(`${baseURL}/auth/refresh`, { refreshToken: tokens.refreshToken });
    const data = res.data as Tokens;
    tokens = { ...tokens, ...data };
    // Rotation invalidates the old refresh token server-side — persist the
    // new pair or the next reload will present a revoked token (replay =>
    // family revoked => forced logout).
    localStorage.setItem('career.tokens', JSON.stringify(tokens));
    return data.accessToken;
  } catch {
    return null;
  }
}

/** Normalized API error for UI display. */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; details?: unknown } | undefined;
    if (data?.error !== undefined) return data.error;
    return err.message;
  }
  return String(err);
}
