import { defineConfig } from '@playwright/test';

const port = 4174;

// The real-stack smoke test: the built web page, a real backend and a real Postgres (see
// ../test/e2e/stack.ts). One browser, one test file; the screenshot suite is playwright.config.ts.
export default defineConfig({
  testDir: 'e2e-stack',
  outputDir: 'test-results-stack',
  reporter: process.env['CI'] === undefined ? 'list' : 'github',
  globalSetup: '../test/e2e/stack.ts',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${String(port)}` },
  webServer: {
    command: `npx vite preview --port ${String(port)} --strictPort`,
    port,
    reuseExistingServer: false,
    // The backend's port, the same number as API_PORT in ../test/e2e/stack.ts.
    env: { API_PORT: '4310' },
  },
});
