// Run 5, AC11: Settings against the real fixture server, saving to the temp file in
// SELLSCOUT_SETTINGS_FILE (playwright.config.ts). Tagged @needs-settings-api: it needs the
// server's /api/settings.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import type { SettingsUpdate } from '../server/types.ts';
import { SETTING_KEYS } from '../server/settings/keys.ts';
import { blockExternalRequests } from './fixtures/mock.ts';
import { E2E_SETTINGS_FILE } from './fixtures/paths.ts';

const SENTINEL = 'SENTINEL-SECRET-123';
const MODEL = 'claude-e2e-test-model';

/** Clears every key, so a file left over from an earlier run doesn't matter. */
async function clearAll(request: APIRequestContext) {
  const body: SettingsUpdate = { values: Object.fromEntries(SETTING_KEYS.map((key) => [key, null])) };
  const res = await request.put('/api/settings', { data: body });
  expect(res.status()).toBe(200);
}

const panel = (page: Page) => page.locator('section#settings-panel');

async function stateText(field: Locator): Promise<string | null> {
  const id = await field.getAttribute('aria-describedby');
  return id ? field.page().locator(`[id="${id}"]`).textContent() : null;
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel(page).getByLabel('Anthropic API key', { exact: true })).toBeVisible();
}

async function closeSettings(page: Page) {
  await panel(page).getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toHaveCount(0);
}

async function save(page: Page) {
  await panel(page).getByRole('button', { name: 'Save settings' }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Saved. New searches use these keys.');
}

test.describe('live Settings (fixture server, temp settings file)', () => {
  test.beforeEach(async ({ request }) => {
    await clearAll(request);
  });

  test.afterEach(async ({ request }) => {
    await clearAll(request);
  });

  test('AC11: save a fake Anthropic key and a model, reopen, then remove the key @needs-settings-api', async ({
    page,
  }) => {
    const blocked = await blockExternalRequests(page);
    await page.goto('/');
    await expect(page.locator('header .chip', { hasText: 'Claude: fixture' })).toBeVisible();

    await openSettings(page);
    const p = panel(page);
    await expect(p.getByText(`Keys are saved on this computer only, in ${E2E_SETTINGS_FILE}.`)).toBeVisible();
    expect(await stateText(p.getByLabel('Anthropic API key', { exact: true }))).toBe('Not set');
    await expect(p.getByLabel('Claude model', { exact: true })).toHaveValue('');

    await p.getByLabel('Anthropic API key', { exact: true }).fill(SENTINEL);
    await p.getByLabel('Claude model', { exact: true }).fill(MODEL);
    await save(page);
    // Fixture mode keeps every key off: the chips stay on "fixture".
    await expect(page.locator('header .chip', { hasText: 'Claude: fixture' })).toBeVisible();
    await closeSettings(page);

    // Reopen: the key reads as saved (never shown), and the model is back.
    await openSettings(page);
    const key = p.getByLabel('Anthropic API key', { exact: true });
    expect(await stateText(key)).toBe('Saved');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('placeholder', 'Paste to replace');
    await expect(p.getByLabel('Claude model', { exact: true })).toHaveValue(MODEL);
    await expect(page.locator('body')).not.toContainText(SENTINEL);

    // The file holds both values.
    expect(existsSync(E2E_SETTINGS_FILE)).toBe(true);
    const written = JSON.parse(readFileSync(E2E_SETTINGS_FILE, 'utf8')) as { values: Record<string, string> };
    expect(written.values).toEqual({ ANTHROPIC_API_KEY: SENTINEL, SELLSCOUT_CLAUDE_MODEL: MODEL });

    // Remove the key and save: it reads "Not set", also after reopening.
    await p.getByRole('button', { name: 'Remove Anthropic API key' }).click();
    expect(await stateText(key)).toBe('Will be removed when you save');
    await save(page);
    expect(await stateText(key)).toBe('Not set');
    await closeSettings(page);
    await openSettings(page);
    expect(await stateText(p.getByLabel('Anthropic API key', { exact: true }))).toBe('Not set');
    await expect(p.getByLabel('Claude model', { exact: true })).toHaveValue(MODEL);

    expect(blocked).toEqual([]);
  });
});
