// AC14: the desktop app in fixture mode, driven through Playwright `_electron`. Each test launches
// the built app (`electron .` from the repo root) with a temp user-data folder and a temp settings
// file, so it never touches the real %APPDATA%\sellscout. Fixture mode blocks every outbound
// request, and shell.openExternal is stubbed, so nothing leaves the machine.
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutRunAsNode } from '../desktop/helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_URL = 'sellscout://app/';

interface Launched {
  app: ElectronApplication;
  page: Page;
}

let tempDir = '';
let launched: ElectronApplication[] = [];

test.beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sellscout-desktop-e2e-'));
  launched = [];
});

test.afterEach(async () => {
  const testInfo = test.info();
  for (const app of launched) {
    if (testInfo.status !== testInfo.expectedStatus) {
      await app
        .context()
        .tracing.stop({ path: testInfo.outputPath(`trace-${launched.indexOf(app)}.zip`) })
        .catch(() => undefined);
    }
    await app.close().catch(() => undefined);
  }
  launched = [];
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const userDataDir = () => join(tempDir, 'user-data');
const settingsFile = () => join(tempDir, 'settings', 'settings.json');

/** The test's environment: no ELECTRON_RUN_AS_NODE, fixture mode, temp folders. */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(withoutRunAsNode(process.env))) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    SELLSCOUT_FIXTURES: '1',
    SELLSCOUT_USER_DATA_DIR: userDataDir(),
    SELLSCOUT_SETTINGS_FILE: settingsFile(),
  };
}

async function launch(): Promise<Launched> {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: appEnv() });
  launched.push(app);
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  // Belt and braces next to fixture mode: the window may only reach its own server.
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(sellscout:\/\/app\/|http:\/\/127\.0\.0\.1:\d+\/|devtools:|data:|blob:)/.test(details.url);
      callback({ cancel: !allowed });
    });
  });
  // shell.openExternal is stubbed in the main process: it records the URL and opens nothing.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __sellscoutOpened: string[] }).__sellscoutOpened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const page = await app.firstWindow();
  await page.waitForURL(APP_URL);
  return { app, page };
}

const opened = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __sellscoutOpened: string[] }).__sellscoutOpened);
const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

async function search(page: Page, item: string, location?: string): Promise<void> {
  await page.getByLabel('What are you selling?').fill(item);
  if (location !== undefined) await page.getByLabel('Location (optional)').fill(location);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
}

test('AC14: the window opens on sellscout://app/ with the title "sellscout"', async () => {
  const { app, page } = await launch();
  expect(page.url()).toBe(APP_URL);
  await expect(page).toHaveTitle('sellscout');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe('sellscout');
  expect(await windowCount(app)).toBe(1);
});

test('AC14: searching "mechanical keyboard" shows Where to post it with r/mechmarket and Claude: fixture', async () => {
  const { page } = await launch();
  await expect(page.locator('header .chip').filter({ hasText: 'Claude: fixture' })).toBeVisible();
  await search(page, 'mechanical keyboard');
  await expect(page.getByRole('listitem').filter({ hasText: 'r/mechmarket' }).first()).toBeVisible();
});

test('AC14: the location survives a relaunch with the same user-data folder', async () => {
  const first = await launch();
  await search(first.page, 'desk', 'Seattle');
  await first.app.close();
  launched = launched.filter((app) => app !== first.app);

  const second = await launch();
  await expect(second.page.getByLabel('Location (optional)')).toHaveValue('Seattle');
});

test('AC14: an external link calls shell.openExternal and opens no new window', async () => {
  const { app, page } = await launch();
  await search(page, 'mechanical keyboard');
  const link = page
    .getByRole('listitem')
    .filter({ hasText: 'r/mechmarket' })
    .first()
    .getByRole('link', { name: 'Open board' });
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^https:\/\//);
  await link.click();
  await expect.poll(() => opened(app)).toEqual([href]);
  expect(await windowCount(app)).toBe(1);
  expect(page.url()).toBe(APP_URL);
});

test('AC14: navigating the window away is blocked; an https target opens in the default browser', async () => {
  const { app, page } = await launch();
  await page.evaluate(() => {
    window.location.href = 'https://example.invalid/away';
  });
  await expect.poll(() => opened(app)).toEqual(['https://example.invalid/away']);
  await page.evaluate(() => {
    window.location.href = 'file:///';
  });
  // Give a navigation that wrongly went through the time to happen.
  await page.waitForTimeout(500);
  expect(page.url()).toBe(APP_URL);
  expect(await opened(app)).toEqual(['https://example.invalid/away']);
  expect(await windowCount(app)).toBe(1);
});

test('AC14: nodeIntegration is off', async () => {
  const { page } = await launch();
  expect(await page.evaluate(() => typeof require)).toBe('undefined');
  expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
});

test('AC14: the page reaches its server through sellscout://app (the 404 for other hosts is a unit test)', async () => {
  const { page } = await launch();
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/status');
    return { url: res.url, body: (await res.json()) as unknown };
  });
  expect(status.url).toBe('sellscout://app/api/status');
  expect(status.body).toMatchObject({ fixtures: true, claude: false });
});

test('AC14: Settings saves to the temp file @needs-settings-api @needs-settings-ui', async () => {
  const { page } = await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Settings' }) });
  await expect(panel.getByText(`Keys are saved on this computer only, in ${settingsFile()}.`)).toBeVisible();
  await panel.getByLabel('Anthropic API key').fill('SENTINEL-SECRET-123');
  await panel.getByLabel('Claude model').fill('claude-test-model');
  await panel.getByRole('button', { name: 'Save settings' }).click();
  await expect(panel.getByRole('status')).toContainText('Saved. New searches use these keys.');

  expect(existsSync(settingsFile())).toBe(true);
  const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')) as { version: number; values: Record<string, string> };
  expect(saved).toEqual({
    version: 1,
    values: { ANTHROPIC_API_KEY: 'SENTINEL-SECRET-123', SELLSCOUT_CLAUDE_MODEL: 'claude-test-model' },
  });
  // The secret never comes back to the page.
  expect(await page.content()).not.toContain('SENTINEL-SECRET-123');
});
