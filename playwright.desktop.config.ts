// The desktop app's end-to-end tests (Playwright `_electron`). Needs `npm run build` and
// `npm run desktop:bundle` first; the global setup stops early with a clear message otherwise.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-desktop',
  outputDir: 'test-results/desktop',
  globalSetup: './e2e-desktop/global-setup.ts',
  // One Electron app at a time: each test launches and closes its own.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
});
