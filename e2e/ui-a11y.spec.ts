import { expect, test } from '@playwright/test';
import type { SettingKey, SettingsResponse, SettingState } from '../server/types.ts';
import { mockSearch, mockSettings } from './fixtures/mock.ts';

test.describe('accessibility', () => {
  test('AC24: every form control has an accessible name', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await expect(page.getByLabel('What are you selling?')).toBeVisible();
    await expect(page.getByLabel('Location (optional)')).toBeVisible();
    for (const name of ['Ship it', 'Local pickup', 'Both']) {
      await expect(page.getByLabel(name, { exact: true })).toBeVisible();
      await expect(page.getByRole('radio', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'Delivery' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Buyer posts from the last' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  });

  test('AC24: the whole flow works with the keyboard alone', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const item = page.getByLabel('What are you selling?');
    // Run 5: the header's Settings button now comes first in the Tab order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    // Tab from the top of the page to the item field.
    await page.keyboard.press('Tab');
    await expect(item).toBeFocused();
    await page.keyboard.type('mechanical keyboard');

    // Tab past the location field into the delivery radio group (lands on the checked "Both").
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Location (optional)')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Both' })).toBeFocused();

    // Arrow keys move the selection: Both -> Local pickup.
    await page.keyboard.press('ArrowUp');
    const local = page.getByRole('radio', { name: 'Local pickup' });
    await expect(local).toBeFocused();
    await expect(local).toBeChecked();

    // Enter submits the form.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.delivery).toBe('local');

    // Tab keeps going into the results until it reaches a result link.
    let reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.closest('section.results') !== null;
      });
    }
    expect(reached).toBe(true);
    await expect(page.locator('section.results a:focus')).toHaveText('Open board');
  });

  test('focused controls show a visible focus outline', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    // Run 5: the header's Settings button now comes first in the Tab order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const item = page.getByLabel('What are you selling?');
    await expect(item).toBeFocused();
    // The app's own :focus-visible style (styles.css), not Chromium's default `outline: auto`.
    const style = await item.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset };
    });
    expect(style).toEqual({ style: 'solid', width: '3px', offset: '2px' });

    // The same style applies to the window select, the submit button and to result links.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const select = page.getByLabel('Buyer posts from the last');
    await expect(select).toBeFocused();
    expect(await select.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Tab');
    const button = page.getByRole('button', { name: 'Search', exact: true });
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  });
});

test.describe('accessibility: people looking for it', () => {
  test('AC25: keyboard only - choose the window, search, reach a post link and a look-yourself link', async ({
    page,
  }) => {
    const { calls } = await mockSearch(page, 'buyers-ok');
    await page.goto('/');

    // Run 5: the header's Settings button now comes first in the Tab order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
    await page.keyboard.type('mechanical keyboard');

    // Item -> location -> delivery radio -> window select.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Both' })).toBeFocused();
    await page.keyboard.press('Tab');
    const select = page.getByRole('combobox', { name: 'Buyer posts from the last' });
    await expect(select).toBeFocused();
    await expect(select).toHaveValue('30');

    // Arrow keys change a closed select: 30 days -> 7 days.
    await page.keyboard.press('ArrowUp');
    await expect(select).toHaveValue('7');

    // Tab to the submit button; Enter searches.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'People looking for it' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.window).toBe(7);

    const focusedIn = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.closest(sel) !== null;
      }, selector);

    // Tab on through the venues until a post link has focus...
    let reachedPost = false;
    for (let i = 0; i < 30 && !reachedPost; i++) {
      await page.keyboard.press('Tab');
      reachedPost = await focusedIn('ol.posts');
    }
    expect(reachedPost).toBe(true);
    await expect(page.locator('ol.posts a:focus')).toHaveText('WTB a 65% mechanical keyboard');

    // ...and then a look-yourself link.
    let reachedLook = false;
    for (let i = 0; i < 10 && !reachedLook; i++) {
      await page.keyboard.press('Tab');
      reachedLook = await focusedIn('.look-links');
    }
    expect(reachedLook).toBe(true);
    await expect(page.locator('.look-links a:focus')).toHaveText('Search Reddit for buyers');
  });
});

test.describe('accessibility: similar listings on eBay', () => {
  test('AC14: keyboard only - search, reach an eBay listing link and "Search eBay yourself"', async ({ page }) => {
    const { calls } = await mockSearch(page, 'ebay-ok');
    await page.goto('/');

    // Run 5: the header's Settings button now comes first in the Tab order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
    await page.keyboard.type('mechanical keyboard');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Similar listings on eBay' })).toBeVisible();
    expect(calls).toHaveLength(1);

    const focusedIn = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.closest(sel) !== null;
      }, selector);

    // Tab on through the form, the venues and the buyers until an eBay listing link has focus...
    let reachedListing = false;
    for (let i = 0; i < 40 && !reachedListing; i++) {
      await page.keyboard.press('Tab');
      reachedListing = await focusedIn('.ebay ol.listings');
    }
    expect(reachedListing).toBe(true);
    const listing = page.locator('.ebay ol.listings a:focus');
    await expect(listing).toHaveText('Keychron Q1 Pro mechanical keyboard, fully assembled');
    expect(await listing.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

    // ...and then "Search eBay yourself".
    let reachedYourself = false;
    for (let i = 0; i < 10 && !reachedYourself; i++) {
      await page.keyboard.press('Tab');
      reachedYourself = await focusedIn('.ebay-yourself');
    }
    expect(reachedYourself).toBe(true);
    await expect(page.locator('.ebay-yourself a:focus')).toHaveText('Search eBay yourself');
  });
});

test.describe('accessibility: saved searches', () => {
  test('AC9: keyboard only - save, run a saved search, delete it and accept the confirm', async ({ page }) => {
    const { calls } = await mockSearch(page, 'buyers-ok');
    await page.goto('/');

    const focused = (name: string) =>
      page.evaluate(
        (n) => document.activeElement instanceof HTMLButtonElement && document.activeElement.getAttribute('aria-label') === n,
        name,
      );
    async function tabTo(check: () => Promise<boolean>, max = 30) {
      for (let i = 0; i < max; i++) {
        if (await check()) return true;
        await page.keyboard.press('Tab');
      }
      return check();
    }

    // Run 5: the header's Settings button now comes first in the Tab order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
    await page.keyboard.type('mechanical keyboard');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'People looking for it' })).toBeVisible();
    expect(calls).toHaveLength(1);

    // Tab on to "Save search" and press Enter.
    const save = page.getByRole('button', { name: 'Save search' });
    expect(await tabTo(() => save.evaluate((el) => el === document.activeElement))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('.save-row [role="status"]')).toHaveText('Saved');

    // Tab (wrapping round from the results back to the top) to Run and press Enter.
    const run = page.getByRole('button', { name: 'Run "mechanical keyboard"' });
    expect(await tabTo(() => focused('Run "mechanical keyboard"'), 60)).toBe(true);
    await expect(run).toBeFocused();
    expect(await run.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page.locator('.new-count')).toHaveText('Nothing new since your last run');
    expect(calls).toHaveLength(2);
    await expect(run).toBeEnabled();

    // Tab to Delete, press Enter and accept the confirm.
    const del = page.getByRole('button', { name: 'Delete "mechanical keyboard"' });
    expect(await tabTo(() => focused('Delete "mechanical keyboard"'), 60)).toBe(true);
    await expect(del).toBeFocused();
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Saved searches' })).toHaveCount(0);
    expect(message).toBe('Delete the saved search "mechanical keyboard"?');
    // Focus goes back to the form, not lost on the page.
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
  });
});

test.describe('accessibility: Claude picks', () => {
  test('AC14: keyboard only - search and Tab to the AI-suggested board link', async ({ page }) => {
    const { calls } = await mockSearch(page, 'claude-keyboard');
    await page.goto('/');

    // Run 5: the header's Settings button now comes first in the Tab order.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
    await page.keyboard.type('mechanical keyboard');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Understood as: Mechanical keyboards · via Claude')).toBeVisible();
    expect(calls).toHaveLength(1);

    // Tab on through the form and the venues until the AI-suggested venue's link has focus.
    const focusedInAiVenue = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.closest('li.venue')?.querySelector('.badge-ai') != null;
      });
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await focusedInAiVenue();
    }
    expect(reached).toBe(true);
    const link = page.locator('ol.venues a:focus');
    await expect(link).toHaveText('Open board');
    await expect(link).toHaveAttribute('href', 'https://www.reddit.com/r/MechanicalKeyboards/');
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  });
});

test.describe('accessibility: Settings', () => {
  const settingsWith = (source: SettingState['source']): SettingsResponse => {
    const state = (key: SettingKey, value: string): SettingState =>
      key === 'SELLSCOUT_CLAUDE_MODEL' || key === 'REDDIT_USERNAME'
        ? source === 'none'
          ? { source, secret: false }
          : { source, secret: false, value }
        : { source, secret: true };
    return {
      editable: true,
      file: '/tmp/sellscout-e2e/settings.json',
      settings: {
        ANTHROPIC_API_KEY: state('ANTHROPIC_API_KEY', ''),
        SELLSCOUT_CLAUDE_MODEL: state('SELLSCOUT_CLAUDE_MODEL', 'claude-test-model'),
        EBAY_CLIENT_ID: state('EBAY_CLIENT_ID', ''),
        EBAY_CLIENT_SECRET: state('EBAY_CLIENT_SECRET', ''),
        REDDIT_CLIENT_ID: state('REDDIT_CLIENT_ID', ''),
        REDDIT_CLIENT_SECRET: state('REDDIT_CLIENT_SECRET', ''),
        REDDIT_USERNAME: state('REDDIT_USERNAME', 'someone'),
      },
    };
  };

  test('AC10: keyboard only - open Settings, fill every field, save, and Escape returns focus', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    const settings = await mockSettings(page, (route, request) =>
      route.fulfill({ status: 200, json: settingsWith(request.method() === 'PUT' ? 'settings' : 'none') }),
    );
    await page.goto('/');

    // Tab reaches the Settings button first; Enter opens the panel and focus moves to its heading.
    await page.keyboard.press('Tab');
    const button = page.getByRole('button', { name: 'Settings', exact: true });
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('section#settings-panel');
    await expect(panel.getByRole('heading', { name: 'Settings' })).toBeFocused();
    await expect(panel.getByLabel('Anthropic API key', { exact: true })).toBeVisible();

    // Close comes first, then every field in order; each one takes typed text.
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('button', { name: 'Close' })).toBeFocused();
    const fields: [string, string][] = [
      ['Anthropic API key', 'SENTINEL-SECRET-123'],
      ['Claude model', 'claude-test-model'],
      ['eBay App ID (Client ID)', 'SENTINEL-EBAY-ID'],
      ['eBay Cert ID (Client Secret)', 'SENTINEL-EBAY-SECRET'],
      ['Reddit client ID', 'SENTINEL-REDDIT-ID'],
      ['Reddit client secret', 'SENTINEL-REDDIT-SECRET'],
      ['Reddit username', 'someone'],
    ];
    for (const [label, value] of fields) {
      await page.keyboard.press('Tab');
      const input = panel.getByLabel(label, { exact: true });
      await expect(input).toBeFocused();
      expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.keyboard.type(value);
      await expect(input).toHaveValue(value);
    }

    // Tab to "Save settings"; Enter saves.
    await page.keyboard.press('Tab');
    const save = panel.getByRole('button', { name: 'Save settings' });
    await expect(save).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('status')).toHaveText('Saved. New searches use these keys.');
    expect(settings.puts).toEqual([
      {
        values: {
          ANTHROPIC_API_KEY: 'SENTINEL-SECRET-123',
          SELLSCOUT_CLAUDE_MODEL: 'claude-test-model',
          EBAY_CLIENT_ID: 'SENTINEL-EBAY-ID',
          EBAY_CLIENT_SECRET: 'SENTINEL-EBAY-SECRET',
          REDDIT_CLIENT_ID: 'SENTINEL-REDDIT-ID',
          REDDIT_CLIENT_SECRET: 'SENTINEL-REDDIT-SECRET',
          REDDIT_USERNAME: 'someone',
        },
      },
    ]);
    await expect(panel.getByLabel('Anthropic API key', { exact: true })).toHaveValue('');

    // Escape inside the panel closes it and puts focus back on the Settings button.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
