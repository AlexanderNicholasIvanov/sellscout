import { defineConfig, devices } from '@playwright/test';
import { E2E_SETTINGS_FILE } from './e2e/fixtures/paths.ts';

const PORT = 5181;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: `http://127.0.0.1:${PORT}/api/status`,
    // An absolute path inside the repo, so the fixture server's Settings never touch the real file.
    env: { PORT: String(PORT), SELLSCOUT_FIXTURES: '1', SELLSCOUT_SETTINGS_FILE: E2E_SETTINGS_FILE },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
