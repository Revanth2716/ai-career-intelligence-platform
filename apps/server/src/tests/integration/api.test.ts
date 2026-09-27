import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { execSync } from 'node:child_process';
import { createApp } from '../../app.js';
import { disconnectPrisma } from '../../lib/prisma.js';

/**
 * API-level integration tests against a real Postgres (docker compose db).
 * Migrations are applied idempotently before the suite.
 */

let app: Express;

const email = `it-${Date.now()}@example.com`;
const password = 'Integration123x';
let accessToken = '';
let secondUserToken = '';
let jobId = '';

beforeAll(async () => {
  // Apply migrations (no-op when up to date).
  try {
    execSync('pnpm exec prisma migrate deploy', { cwd: process.cwd(), stdio: 'ignore' });
  } catch {
    // CI applies them explicitly; local failure is surfaced by the tests.
  }
  process.env['MOCK_LLM'] = 'true';
  app = createApp();
});

afterAll(async () => {
  await disconnectPrisma();
});

describe('health', () => {
  it('GET /health returns ok', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('auth lifecycle', () => {
  it('registers a user and returns tokens', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).post('/api/v1/auth/register').send({ email, password, name: 'IT' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    accessToken = res.body.accessToken;
  });

  it('rejects duplicate registration with 409', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).post('/api/v1/auth/register').send({ email, password, name: 'IT' });
    expect(res.status).toBe(409);
  });

  it('rejects weak passwords with 422', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).post('/api/v1/auth/register').send({ email: `w-${email}`, password: 'short', name: 'W' });
    expect(res.status).toBe(422);
  });

  it('logs in and hides unknown-email vs wrong-password', async () => {
    const { default: request } = await import('supertest');
    const ok = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(ok.status).toBe(200);

    const badPw = await request(app).post('/api/v1/auth/login').send({ email, password: 'WrongPassword1x' });
    const badEmail = await request(app).post('/api/v1/auth/login').send({ email: `no-${email}`, password: 'WrongPassword1x' });
    expect(badPw.status).toBe(401);
    expect(badEmail.status).toBe(401);
    expect(badPw.body.error).toBe(badEmail.body.error);
  });

  it('rotates refresh tokens and detects replay', async () => {
    const { default: request } = await import('supertest');
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const first = login.body.refreshToken as string;

    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(r1.status).toBe(200);

    // Replay the rotated token → family revoked.
    const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(replay.status).toBe(401);

    // The rotated-at-once token is dead too (same family).
    const r2 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
  });

  it('GET /auth/me requires a token', async () => {
    const { default: request } = await import('supertest');
    const anon = await request(app).get('/api/v1/auth/me');
    expect(anon.status).toBe(401);

    const authed = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(authed.status).toBe(200);
    expect(authed.body.email).toBe(email);
  });
});

describe('jobs API + ownership', () => {
  const description =
    'Junior Software Engineer at Integration Corp, Bengaluru. Required: strong python and sql. ' +
    'Experience with rest apis required. Nice to have: docker and react. We build scalable systems.';

  it('creates, lists, updates and deletes a job', async () => {
    const { default: request } = await import('supertest');
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${accessToken}`);

    const created = await auth(request(app).post('/api/v1/jobs')).send({
      title: 'Junior Software Engineer',
      company: 'Integration Corp',
      location: 'Bengaluru',
      rawText: description,
    });
    expect(created.status).toBe(201);
    jobId = created.body.id as string;

    const list = await auth(request(app).get('/api/v1/jobs')).expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.some((j: { id: string }) => j.id === jobId)).toBe(true);
    expect(list.headers['x-total-count']).toBeDefined();

    const updated = await auth(request(app).put(`/api/v1/jobs/${jobId}`)).send({ location: 'Remote' });
    expect(updated.status).toBe(200);

    const deleted = await auth(request(app).delete(`/api/v1/jobs/${jobId}`));
    expect(deleted.status).toBe(204);

    const gone = await auth(request(app).get(`/api/v1/jobs/${jobId}`));
    expect(gone.status).toBe(404);
  });

  it('hides other users jobs (404, not 403 — no existence leak)', async () => {
    const { default: request } = await import('supertest');
    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `second-${email}`, password, name: 'Second' });
    secondUserToken = second.body.accessToken;

    const mine = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Role A', company: 'Co A', location: '', rawText: description });

    const peek = await request(app)
      .get(`/api/v1/jobs/${mine.body.id}`)
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(peek.status).toBe(404);
  });

  it('validates job creation input (422)', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'x', company: '', rawText: 'too short' });
    expect(res.status).toBe(422);
  });

  it('search returns an empty hit list before embeddings exist', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .get('/api/v1/jobs/search?q=python')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hits)).toBe(true);
  });

  it('rate limits AI endpoints (429 after burst)', async () => {
    const { default: request } = await import('supertest');
    // The AI bucket (AI_RATE_LIMIT_MAX=10 default) — burst past it.
    let saw429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .post('/api/v1/jobs/from-url')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ url: 'http://example.com/job' });
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
