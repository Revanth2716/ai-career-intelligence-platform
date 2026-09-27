import { defineConfig } from 'vitest/config';

// Integration tests hit a real Postgres (docker compose db service).
// Point DATABASE_URL at the TEST database before running:
//   DATABASE_URL=postgresql://career:career@localhost:5432/career_test
export default defineConfig({
  test: {
    include: ['src/tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run files serially: they share one database.
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
