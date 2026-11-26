// The settings file the Playwright fixture server saves to (SELLSCOUT_SETTINGS_FILE). It lives
// under node_modules/.tmp, not test-results/, which Playwright cleans before a run.
import { fileURLToPath } from 'node:url';

export const E2E_SETTINGS_FILE = fileURLToPath(new URL('../../node_modules/.tmp/e2e-settings.json', import.meta.url));
