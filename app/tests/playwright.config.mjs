import { defineConfig, devices } from '@playwright/test';

const PORT = 3997;

// This config lives under tests/ on purpose: tests/ is dockerignored, so
// nothing here ships in the deploy zip — and the key-logscan compliance gate
// (AC-6.2) scans everything that does.
export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results/e2e',
  // The demo deliberation is paced with deliberate sleeps between stages, so
  // the whole journey takes several seconds before the table card appears.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Started with an empty key so the app serves its pre-recorded example
    // deliberation: the e2e run is deterministic and spends nothing.
    command: 'node server.js',
    cwd: '..',
    env: { PORT: String(PORT), ANTHROPIC_API_KEY: '' },
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
