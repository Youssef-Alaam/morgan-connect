import { defineConfig } from '@playwright/test';

const port = 4173;

// Three modes of the component page: light, dark and right-to-left. Dark follows the system
// setting, right-to-left follows the ?dir=rtl switch.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  reporter: process.env['CI'] === undefined ? 'list' : 'github',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  use: { baseURL: `http://localhost:${String(port)}`, viewport: { width: 900, height: 800 } },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
    { name: 'rtl', use: { colorScheme: 'light' }, metadata: { query: '?dir=rtl' } },
  ],
  webServer: {
    command: `npx vite preview --port ${String(port)} --strictPort`,
    port,
    reuseExistingServer: process.env['CI'] === undefined,
  },
});
