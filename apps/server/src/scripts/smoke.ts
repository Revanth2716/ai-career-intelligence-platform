import { createApp } from '../app.js';
import { env } from '../config/env.js';

/**
 * Smoke test (no network): boots the app against the dev DB, exercises the
 * core flows with MOCK_LLM=true. Run: pnpm --filter @career/server smoke
 */
async function main(): Promise<void> {
  if (!env.MOCK_LLM) {
    console.error('Set MOCK_LLM=true for the smoke test (no external calls).');
    process.exit(1);
  }
  const { default: request } = await import('supertest');
  const app = createApp();

  const email = `smoke-${Date.now()}@example.com`;
  const password = 'SmokeTest123x';

  const register = await request(app).post('/api/v1/auth/register').send({ email, password, name: 'Smoke' });
  if (register.status !== 201) throw new Error(`register failed: ${register.text}`);
  const { accessToken } = register.body;

  const authed = request(app).set('Authorization', `Bearer ${accessToken}`);

  // Job CRUD + parse (LLM is mocked).
  const job = await authed.post('/api/v1/jobs').send({
    title: 'Junior Software Engineer',
    company: 'Booking Holdings',
    location: 'Bengaluru',
    rawText: 'Junior Software Engineer at Booking Holdings.\n\nRequirements: python, java, javascript, sql, rest apis, docker, testing. Required: strong CS fundamentals. Nice to have: react.',
  });
  if (job.status !== 201) throw new Error(`job create failed: ${job.text}`);

  // Resume with inline text (client can also upload a file).
  const resume = await authed.post('/api/v1/resumes').attach(
    'file',
    Buffer.from(
      'Alex Candidate\nSkills: python, javascript, sql, node, react, rest apis, testing\nExperience: Software Intern at Example Corp\n- Built REST APIs with node and postgresql\nEducation: B.Tech CSE, Example University, 2024',
      'utf8',
    ),
  ).field('title', 'Smoke resume');

  console.log('SMOKE RESULT', {
    register: register.status,
    job: job.status,
    resume: resume.status,
  });

  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
