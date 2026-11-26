// Run 5, AC9: the Settings panel against a mocked /api/settings.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { SettingKey, SettingsResponse, SettingState } from '../server/types.ts';
import { blockExternalRequests, mockSettings, mockStatus } from './fixtures/mock.ts';

const FILE = '/home/someone/.config/sellscout/settings.json';
const SENTINEL = 'SENTINEL-SECRET-123';

const secret = (source: SettingState['source']): SettingState => ({ source, secret: true });
const text = (source: SettingState['source'], value?: string): SettingState =>
  value === undefined ? { source, secret: false } : { source, secret: false, value };

function settingsResponse(
  overrides: Partial<Record<SettingKey, SettingState>> = {},
  editable = true,
  file: string = FILE,
): SettingsResponse {
  return {
    editable,
    file: editable ? file : null,
    settings: {
      ANTHROPIC_API_KEY: secret('none'),
      SELLSCOUT_CLAUDE_MODEL: text('none'),
      EBAY_CLIENT_ID: secret('none'),
      EBAY_CLIENT_SECRET: secret('none'),
      REDDIT_CLIENT_ID: secret('none'),
      REDDIT_CLIENT_SECRET: secret('none'),
      REDDIT_USERNAME: text('none'),
      ...overrides,
    },
  };
}

/** A mixed state: one saved secret, one secret and one text field from the environment, a saved model. */
const MIXED = settingsResponse({
  ANTHROPIC_API_KEY: secret('settings'),
  EBAY_CLIENT_ID: secret('environment'),
  SELLSCOUT_CLAUDE_MODEL: text('settings', 'claude-saved-model'),
  REDDIT_USERNAME: text('environment', 'env-user'),
});

const settingsButton = (page: Page) => page.getByRole('button', { name: 'Settings', exact: true });
const panel = (page: Page) => page.locator('section#settings-panel');

/** The state line linked to a field by aria-describedby. */
async function stateText(field: Locator): Promise<string | null> {
  const id = await field.getAttribute('aria-describedby');
  if (!id) return null;
  return field.page().locator(`[id="${id}"]`).textContent();
}

async function openSettings(page: Page) {
  await settingsButton(page).click();
  await expect(panel(page).getByRole('heading', { name: 'Settings' })).toBeFocused();
}

/** Counts the /api/status requests the page makes. */
function countStatus(page: Page): { count: number } {
  const counter = { count: 0 };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/status') counter.count += 1;
  });
  return counter;
}

test.describe('Settings panel', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
  });

  test('opens from the header, focuses its heading, and Close / Escape return focus', async ({ page }) => {
    const calls = await mockSettings(page, settingsResponse());
    await page.goto('/');
    const button = settingsButton(page);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toHaveAttribute('aria-controls', 'settings-panel');
    await expect(panel(page)).toHaveCount(0);

    await openSettings(page);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // Shown above the search form.
    const panelBox = await panel(page).boundingBox();
    const formBox = await page.getByRole('form', { name: 'Search for boards' }).boundingBox();
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(formBox!.y);
    await expect(panel(page).getByText(`Keys are saved on this computer only, in ${FILE}.`)).toBeVisible();
    await expect(panel(page).locator('legend')).toHaveText(['Anthropic (Claude)', 'eBay', 'Reddit']);

    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    // Escape inside the panel does the same; every open loads the settings again.
    await openSettings(page);
    await panel(page).getByLabel('Claude model', { exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(calls.gets).toBe(2);
  });

  test('shows "Loading settings…" while the settings load', async ({ page }) => {
    let answer: () => void = () => {};
    const ready = new Promise<void>((resolve) => (answer = resolve));
    await mockSettings(page, async (route) => {
      await ready;
      await route.fulfill({ status: 200, json: settingsResponse() });
    });
    await page.goto('/');
    await openSettings(page);
    await expect(panel(page).getByText('Loading settings…')).toBeVisible();
    answer();
    await expect(panel(page).getByLabel('Anthropic API key', { exact: true })).toBeVisible();
    await expect(panel(page).getByText('Loading settings…')).toHaveCount(0);
  });

  test('field states, placeholders and the environment-disabled fields', async ({ page }) => {
    await mockSettings(page, MIXED);
    await page.goto('/');
    await openSettings(page);
    const p = panel(page);

    const anthropic = p.getByLabel('Anthropic API key', { exact: true });
    await expect(anthropic).toHaveAttribute('type', 'password');
    await expect(anthropic).toHaveAttribute('autocomplete', 'off');
    await expect(anthropic).toHaveValue('');
    await expect(anthropic).toHaveAttribute('placeholder', 'Paste to replace');
    await expect(anthropic).toBeEnabled();
    expect(await stateText(anthropic)).toBe('Saved');

    const ebayId = p.getByLabel('eBay App ID (Client ID)', { exact: true });
    await expect(ebayId).toBeDisabled();
    await expect(ebayId).toHaveAttribute('placeholder', 'Paste your key');
    expect(await stateText(ebayId)).toBe('Set in the environment (read-only)');

    for (const label of ['eBay Cert ID (Client Secret)', 'Reddit client ID', 'Reddit client secret']) {
      const field = p.getByLabel(label);
      await expect(field).toHaveAttribute('type', 'password');
      await expect(field).toHaveAttribute('placeholder', 'Paste your key');
      await expect(field).toBeEnabled();
      expect(await stateText(field)).toBe('Not set');
    }

    await expect(p.getByLabel('Claude model', { exact: true })).toHaveValue('claude-saved-model');
    await expect(p.getByLabel('Claude model', { exact: true })).toHaveAttribute('placeholder', 'claude-opus-5-5');
    await expect(p.getByLabel('Claude model', { exact: true })).toBeEnabled();
    await expect(p.getByLabel('Reddit username', { exact: true })).toHaveValue('env-user');
    await expect(p.getByLabel('Reddit username', { exact: true })).toBeDisabled();

    // Only the saved key has a Remove button.
    await expect(p.getByRole('button', { name: /^Remove/ })).toHaveCount(1);
  });

  test('Remove / Keep, only the changes sent, the success message and the chips fetched again', async ({ page }) => {
    const status = countStatus(page);
    const after = settingsResponse({
      ANTHROPIC_API_KEY: secret('none'),
      EBAY_CLIENT_ID: secret('environment'),
      EBAY_CLIENT_SECRET: secret('settings'),
      SELLSCOUT_CLAUDE_MODEL: text('settings', 'claude-new-model'),
      REDDIT_USERNAME: text('environment', 'env-user'),
    });
    const calls = await mockSettings(page, (route, request) =>
      route.fulfill({ status: 200, json: request.method() === 'PUT' ? after : MIXED }),
    );
    await page.goto('/');
    await expect(page.locator('header .chip').first()).toBeVisible();
    const before = status.count;
    await openSettings(page);
    const p = panel(page);

    const anthropic = p.getByLabel('Anthropic API key', { exact: true });
    await p.getByRole('button', { name: 'Remove Anthropic API key' }).click();
    expect(await stateText(anthropic)).toBe('Will be removed when you save');
    const keep = p.getByRole('button', { name: 'Keep Anthropic API key' });
    await expect(keep).toHaveText('Keep');
    await keep.click();
    expect(await stateText(anthropic)).toBe('Saved');
    await p.getByRole('button', { name: 'Remove Anthropic API key' }).click();

    await p.getByLabel('eBay Cert ID (Client Secret)', { exact: true }).fill(SENTINEL);
    await p.getByLabel('Claude model', { exact: true }).fill('claude-new-model');
    // A blank secret is not a change.
    await p.getByLabel('Reddit client ID', { exact: true }).fill('   ');
    // A typed key is never mirrored into the markup (a value attribute, a snapshot).
    expect(await page.content()).not.toContain(SENTINEL);
    await p.getByRole('button', { name: 'Save settings' }).click();

    await expect(p.getByRole('status')).toHaveText('Saved. New searches use these keys.');
    expect(calls.puts).toEqual([
      { values: { ANTHROPIC_API_KEY: null, EBAY_CLIENT_SECRET: SENTINEL, SELLSCOUT_CLAUDE_MODEL: 'claude-new-model' } },
    ]);
    // The secret inputs clear and the states come from the response.
    await expect(p.getByLabel('eBay Cert ID (Client Secret)', { exact: true })).toHaveValue('');
    await expect(p.getByLabel('Reddit client ID', { exact: true })).toHaveValue('');
    expect(await stateText(p.getByLabel('eBay Cert ID (Client Secret)', { exact: true }))).toBe('Saved');
    expect(await stateText(anthropic)).toBe('Not set');
    await expect(anthropic).toHaveAttribute('placeholder', 'Paste your key');
    await expect(p.getByLabel('Claude model', { exact: true })).toHaveValue('claude-new-model');
    // The header chips are fetched again.
    await expect.poll(() => status.count).toBe(before + 1);
    await expect(page.locator('body')).not.toContainText(SENTINEL);
    expect(await page.content()).not.toContain(SENTINEL);
  });

  test('with nothing changed: "Nothing to save." and no request', async ({ page }) => {
    const calls = await mockSettings(page, MIXED);
    await page.goto('/');
    await openSettings(page);
    await panel(page).getByRole('button', { name: 'Save settings' }).click();
    await expect(panel(page).getByRole('status')).toHaveText('Nothing to save.');
    expect(calls.puts).toEqual([]);
  });

  test("an error answer shows the server's message in an alert", async ({ page }) => {
    await mockSettings(page, (route, request) =>
      request.method() === 'PUT'
        ? route.fulfill({ status: 400, json: { error: 'REDDIT_USERNAME must be a single line' } })
        : route.fulfill({ status: 200, json: settingsResponse() }),
    );
    await page.goto('/');
    await openSettings(page);
    await panel(page).getByLabel('Reddit username', { exact: true }).fill('someone');
    await panel(page).getByRole('button', { name: 'Save settings' }).click();
    await expect(panel(page).getByRole('alert')).toHaveText(
      "Couldn't save settings: REDDIT_USERNAME must be a single line",
    );
    await expect(panel(page).getByLabel('Reddit username', { exact: true })).toHaveValue('someone');
  });

  for (const mode of ['a network failure', 'bad JSON'] as const) {
    test(`${mode} shows "no answer from the server"`, async ({ page }) => {
      const calls = await mockSettings(page, (route, request) => {
        if (request.method() !== 'PUT') return route.fulfill({ status: 200, json: settingsResponse() });
        return mode === 'a network failure'
          ? route.abort('failed')
          : route.fulfill({ status: 200, contentType: 'application/json', body: '{"editable":' });
      });
      await page.goto('/');
      await openSettings(page);
      await panel(page).getByLabel('Reddit username', { exact: true }).fill('someone');
      await panel(page).getByRole('button', { name: 'Save settings' }).click();
      await expect(panel(page).getByRole('alert')).toHaveText("Couldn't save settings: no answer from the server");
      expect(calls.puts).toHaveLength(1);
      await expect(panel(page).getByRole('status')).toHaveText('');
    });
  }

  test('a load failure shows "Couldn\'t load settings." and Retry loads again', async ({ page }) => {
    let fail = true;
    const calls = await mockSettings(page, (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: 'Internal error' } })
        : route.fulfill({ status: 200, json: settingsResponse() }),
    );
    await page.goto('/');
    await openSettings(page);
    await expect(panel(page).getByRole('alert')).toHaveText("Couldn't load settings.");
    await expect(panel(page).getByLabel('Anthropic API key', { exact: true })).toHaveCount(0);
    fail = false;
    await panel(page).getByRole('button', { name: 'Retry' }).click();
    await expect(panel(page).getByLabel('Anthropic API key', { exact: true })).toBeVisible();
    await expect(panel(page).getByText("Couldn't load settings.")).toHaveCount(0);
    expect(calls.gets).toBe(2);
  });

  test('read-only: the intro says so and everything but Close is disabled', async ({ page }) => {
    await mockSettings(page, settingsResponse({ ANTHROPIC_API_KEY: secret('settings') }, false));
    await page.goto('/');
    await openSettings(page);
    const p = panel(page);
    await expect(p.getByText('Settings are read-only here. Set keys in .env or the environment.')).toBeVisible();
    const inputs = p.locator('input');
    await expect(inputs).toHaveCount(7);
    for (const input of await inputs.all()) await expect(input).toBeDisabled();
    const buttons = p.getByRole('button');
    for (const button of await buttons.all()) {
      if ((await button.textContent()) === 'Close') await expect(button).toBeEnabled();
      else await expect(button).toBeDisabled();
    }
    await expect(p.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await expect(p.getByRole('button', { name: 'Remove Anthropic API key' })).toBeDisabled();
    await p.getByRole('button', { name: 'Close' }).click();
    await expect(p).toHaveCount(0);
  });

  test('the panel fits a 390 px wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mockStatus(page, { redditAuth: false, fixtures: true, ebay: false, claude: false });
    // Worst case: a long, unbroken settings path and every kind of field state.
    const longFile = `C:\\Users\\${'SomeoneWithAVeryLongName'.repeat(3)}\\AppData\\Roaming\\sellscout\\settings.json`;
    await mockSettings(
      page,
      settingsResponse(
        {
          ANTHROPIC_API_KEY: secret('settings'),
          EBAY_CLIENT_ID: secret('environment'),
          SELLSCOUT_CLAUDE_MODEL: text('settings', 'claude-a-very-long-model-name-that-keeps-going-20261126'),
          REDDIT_USERNAME: text('environment', 'someone'),
        },
        true,
        longFile,
      ),
    );
    await page.goto('/');
    await expect(page.locator('header .chip')).toHaveCount(4);
    await openSettings(page);
    await panel(page).getByRole('button', { name: 'Remove Anthropic API key' }).click();
    await expect(panel(page).getByText(longFile, { exact: false })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The Settings button and the Save button stay inside the page.
    for (const locator of [settingsButton(page), panel(page).getByRole('button', { name: 'Save settings' })]) {
      const box = await locator.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
  });
});
