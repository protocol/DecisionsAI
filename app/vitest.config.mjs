import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns tests/e2e (npm run test:e2e). Without this, vitest
    // collects those specs and fails on test.describe() from a foreign runner.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
