import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/unit/**/*.test.ts'],
    environment: 'node',
    // Fast, pure unit tests — no DB, no network. Env validation at import
    // time requires these to be present even though tests never connect.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
      JWT_ACCESS_SECRET: 'unit-test-access-secret-0000000001',
      JWT_REFRESH_SECRET: 'unit-test-refresh-secret-00000001',
      MOCK_LLM: 'true',
    },
    testTimeout: 10_000,
  },
});
