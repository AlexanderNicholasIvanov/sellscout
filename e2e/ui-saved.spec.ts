// Saved searches and "New" badges with mocked /api/search and /api/status (AC6, AC8).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadFixture, mockSearch, mockStatus, readStorage, seedStorage } from './fixtures/mock.ts';

const KEY = 'sellscout.savedSearches.v1';
const BACKUP_KEY = 'sellscout.savedSearches.v1.corrupt';
// The buyers-ok fixture's post times are relative to this instant.
const NOW = new Date('2026-11-25T12:00:00Z');
const HOUR = 3_600_000;
const BUYERS_OK_IDS = ['t3_p1', 't3_p2', 't3_p3', 't3_p4'];

interface Stored {
  id: string;
  item: string;
  location: string;
  delivery: 'ship' | 'local' | 'both';
  window: 7 | 30 | 90;
  savedAt: number;
  lastRunAt: number;
  seenPostIds: string[];
}

function record(extra: Partial<Stored> = {}): Stored {
  return {
    id: 'rec-1',
    item: 'mechanical keyboard',
    location: '',
    delivery: 'both',
    window: 30,
    savedAt: NOW.getTime() - 2 * HOUR,
    lastRunAt: NOW.getTime() - 2 * HOUR,
    seenPostIds: [],
    ...extra,
  };
}

const panel = (page: Page) => page.getByRole('region', { name: 'Saved searches' });
const rows = (page: Page) => panel(page).locator('.saved-row');
const saveStatus = (page: Page) => page.locator('section.results .save-row [role="status"]');

async function stored(page: Page): Promise<Stored[]> {
  return JSON.parse((await readStorage(page, KEY)) ?? 'null') as Stored[];
}

async function searchFor(page: Page, item: string) {
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await mockStatus(page, { redditAuth: false, fixtures: false });
  await page.clock.setFixedTime(NOW);
});

test.describe('saved searches (AC6)', () => {
  test('save, list, duplicate, reload, delete with Cancel and with OK', async ({ page }) => {
    await mockSearch(page, 'buyers-ok');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Saved searches' })).toHaveCount(0);

    await searchFor(page, 'mechanical keyboard');
    // The Save button sits right after the "Understood as" line.
    const next = await page
      .locator('section.results .understood')
      .evaluate((el) => el.nextElementSibling?.querySelector('button')?.textContent);
    expect(next).toBe('Save search');

    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(saveStatus(page)).toHaveText('Saved');

    await expect(panel(page).getByRole('heading', { level: 2, name: 'Saved searches' })).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row).toContainText('mechanical keyboard');
    await expect(row).toContainText('Both · last 30 days');
    await expect(row).toContainText('last run just now');
    await expect(row.getByRole('button', { name: 'Run "mechanical keyboard"' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Delete "mechanical keyboard"' })).toBeVisible();
    // A blank location shows no location line.
    await expect(row.locator('.saved-location')).toHaveCount(0);

    // The panel sits between the form and the results.
    const order = await page.evaluate(() => {
      const form = document.querySelector('form.search-form');
      const saved = document.querySelector('section.saved');
      const results = document.querySelector('section.results');
      if (!form || !saved || !results) return 0;
      return (form.compareDocumentPosition(saved) & 4) && (saved.compareDocumentPosition(results) & 4) ? 1 : 0;
    });
    expect(order).toBe(1);

    const list = await stored(page);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      item: 'mechanical keyboard',
      location: '',
      delivery: 'both',
      window: 30,
      savedAt: NOW.getTime(),
      lastRunAt: NOW.getTime(),
      seenPostIds: BUYERS_OK_IDS,
    });
    expect(list[0].id).toMatch(/^[0-9a-f-]{36}$/);

    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(saveStatus(page)).toHaveText('Already saved');
    expect(await stored(page)).toHaveLength(1);

    // The next search clears the message.
    await searchFor(page, 'mechanical keyboard');
    await expect(saveStatus(page)).toHaveCount(0);

    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('mechanical keyboard');

    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.dismiss();
    });
    await page.getByRole('button', { name: 'Delete "mechanical keyboard"' }).click();
    expect(message).toBe('Delete the saved search "mechanical keyboard"?');
    await expect(rows(page)).toHaveCount(1);
    expect(await stored(page)).toHaveLength(1);

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete "mechanical keyboard"' }).click();
    await expect(page.getByRole('heading', { name: 'Saved searches' })).toHaveCount(0);
    await expect(page.locator('section.saved')).toHaveCount(0);
    expect(await stored(page)).toEqual([]);
  });

  for (const raw of ['"{oops"', '{oops']) {
    test(`the corrupt value ${raw} shows the reset notice and keeps a backup`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await mockSearch(page, 'buyers-ok');
      await seedStorage(page, KEY, raw);
      await page.goto('/');

      await expect(panel(page).getByRole('status')).toHaveText(
        "Saved searches couldn't be read and were reset (a backup was kept).",
      );
      await expect(rows(page)).toHaveCount(0);
      expect(await readStorage(page, BACKUP_KEY)).toBe(raw);
      expect(await readStorage(page, KEY)).toBe('[]');
      expect(errors).toEqual([]);

      // Saving still works afterwards.
      await searchFor(page, 'mechanical keyboard');
      await page.getByRole('button', { name: 'Save search' }).click();
      await expect(saveStatus(page)).toHaveText('Saved');
      await expect(rows(page)).toHaveCount(1);
    });
  }

  test('a failed write keeps the reset notice, and a later write clears only the failure', async ({ page }) => {
    await mockSearch(page, 'buyers-ok');
    await seedStorage(page, KEY, '{oops');
    await page.goto('/');
    const reset = "Saved searches couldn't be read and were reset (a backup was kept).";
    await searchFor(page, 'mechanical keyboard');
    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(saveStatus(page)).toHaveText('Saved');

    // Storage starts refusing writes: Delete fails and both messages show.
    await page.evaluate(() => {
      const w = window as unknown as { __realSetItem?: Storage['setItem'] };
      w.__realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete "mechanical keyboard"' }).click();
    await expect(panel(page).getByRole('status')).toHaveText(
      `${reset} Couldn't save: browser storage is full or blocked`,
    );
    await expect(rows(page)).toHaveCount(1);

    // Writes work again: the failure goes, the reset notice stays.
    await page.evaluate(() => {
      const w = window as unknown as { __realSetItem: Storage['setItem'] };
      Storage.prototype.setItem = w.__realSetItem;
    });
    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(saveStatus(page)).toHaveText('Already saved');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete "mechanical keyboard"' }).click();
    await expect(panel(page).getByRole('status')).toHaveText(reset);
    await expect(rows(page)).toHaveCount(0);
  });

  test('Save stores the searched values, not the edited form', async ({ page }) => {
    const { calls } = await mockSearch(page, 'buyers-ok');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('  mechanical keyboard ');
    await page.getByLabel('Location (optional)').fill('Seattle');
    await page.getByLabel('Ship it').check();
    await page.getByLabel('Buyer posts from the last').selectOption({ label: '7 days' });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
    expect(calls).toHaveLength(1);

    // Edit every field, then save without searching again.
    await page.getByLabel('What are you selling?').fill('desk');
    await page.getByLabel('Location (optional)').fill('Portland');
    await page.getByLabel('Local pickup').check();
    await page.getByLabel('Buyer posts from the last').selectOption({ label: '90 days' });
    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(saveStatus(page)).toHaveText('Saved');

    const [saved] = await stored(page);
    expect(saved).toMatchObject({ item: 'mechanical keyboard', location: 'Seattle', delivery: 'ship', window: 7 });
    const row = rows(page).first();
    await expect(row.locator('.saved-item')).toHaveText('mechanical keyboard');
    await expect(row.locator('.saved-meta')).toHaveText('Ship it · last 7 days');
    await expect(row.locator('.saved-location')).toHaveText('Seattle');
  });
});

test.describe('running a saved search (AC8)', () => {
  test('Run fills the form and searches with the saved values', async ({ page }) => {
    const { calls } = await mockSearch(page, 'buyers-ok');
    await seedStorage(page, KEY, JSON.stringify([record({ location: 'Seattle', delivery: 'local', window: 90 })]));
    await page.goto('/');

    const row = rows(page).first();
    await expect(row.locator('.saved-meta')).toHaveText('Local pickup · last 90 days');
    await expect(row.locator('.saved-location')).toHaveText('Seattle');
    await expect(row.locator('.saved-run')).toHaveText('last run 2 hours ago');

    await page.getByRole('button', { name: 'Run "mechanical keyboard"' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();

    await expect(page.getByLabel('What are you selling?')).toHaveValue('mechanical keyboard');
    await expect(page.getByLabel('Location (optional)')).toHaveValue('Seattle');
    await expect(page.getByRole('radio', { name: 'Local pickup' })).toBeChecked();
    await expect(page.getByLabel('Buyer posts from the last')).toHaveValue('90');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ item: 'mechanical keyboard', location: 'Seattle', delivery: 'local', window: 90 });

    // A successful Run updates the record.
    await expect(row.locator('.saved-run')).toHaveText('last run just now');
    const [saved] = await stored(page);
    expect(saved.lastRunAt).toBe(NOW.getTime());
    expect(saved.seenPostIds).toEqual(BUYERS_OK_IDS);
  });

  test('every Run button is disabled while a search is in flight', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockSearch(page, async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: loadFixture('buyers-ok') });
    });
    await seedStorage(
      page,
      KEY,
      JSON.stringify([record({ id: 'rec-2', item: 'desk' }), record({ id: 'rec-1' })]),
    );
    await page.goto('/');

    const runButtons = panel(page).getByRole('button', { name: /^Run "/ });
    await expect(runButtons).toHaveCount(2);
    await expect(runButtons.nth(0)).toBeEnabled();
    await expect(runButtons.nth(1)).toBeEnabled();

    await page.getByRole('button', { name: 'Run "mechanical keyboard"' }).click();
    await expect(page.getByRole('button', { name: 'Searching...' })).toBeDisabled();
    await expect(runButtons.nth(0)).toBeDisabled();
    await expect(runButtons.nth(1)).toBeDisabled();
    // Delete stays available.
    await expect(page.getByRole('button', { name: 'Delete "desk"' })).toBeEnabled();

    release();
    await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
    await expect(runButtons.nth(0)).toBeEnabled();
    await expect(runButtons.nth(1)).toBeEnabled();
  });

  test('a failed Run (HTTP 500) leaves lastRunAt and seenPostIds unchanged', async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ status: 500, json: { error: 'Internal error' } }));
    const seeded = JSON.stringify([record({ seenPostIds: ['t3_p1'] })]);
    await seedStorage(page, KEY, seeded);
    await page.goto('/');

    await page.getByRole('button', { name: 'Run "mechanical keyboard"' }).click();
    await expect(page.getByRole('alert')).toHaveText('Search failed: Internal error');
    await expect(page.getByRole('button', { name: 'Run "mechanical keyboard"' })).toBeEnabled();
    expect(await readStorage(page, KEY)).toBe(seeded);
    await expect(rows(page).first().locator('.saved-run')).toHaveText('last run 2 hours ago');
  });
});

test.describe('"New" badges', () => {
  test('a Run with one unseen post shows one "New" badge and the count; a manual search shows none', async ({
    page,
  }) => {
    await mockSearch(page, 'buyers-ok');
    await seedStorage(page, KEY, JSON.stringify([record({ seenPostIds: ['t3_p1', 't3_p3', 't3_p4'] })]));
    await page.goto('/');

    await page.getByRole('button', { name: 'Run "mechanical keyboard"' }).click();
    const buyers = page.locator('section.results .buyers');
    const posts = buyers.locator('ol.posts > li');
    await expect(posts).toHaveCount(4);

    await expect(buyers.getByText('New', { exact: true })).toHaveCount(1);
    await expect(buyers.locator('.badge-new')).toHaveCount(1);
    const fresh = posts.nth(1);
    await expect(fresh.locator('.badge-new')).toHaveText('New');
    // The badge comes before the title; the link keeps the title as its name.
    expect(
      await fresh.locator('.post-title').evaluate((p) => p.firstElementChild?.classList.contains('badge-new')),
    ).toBe(true);
    await expect(fresh.getByRole('link', { name: 'ISO mechanical keyboard for a beginner' })).toBeVisible();

    // The count line sits above the post list.
    const count = buyers.locator('.new-count');
    await expect(count).toHaveText('1 new since your last run');
    expect(
      await count.evaluate((el) => {
        const list = el.parentElement?.querySelector('ol.posts');
        return list ? el.compareDocumentPosition(list) & 4 : 0;
      }),
    ).toBe(4);

    // The record now has every id; a second Run shows nothing new.
    const [saved] = await stored(page);
    expect(saved.seenPostIds).toEqual(BUYERS_OK_IDS);
    await page.getByRole('button', { name: 'Run "mechanical keyboard"' }).click();
    await expect(count).toHaveText('Nothing new since your last run');
    await expect(buyers.locator('.badge-new')).toHaveCount(0);

    // A manual search with the same values shows neither badges nor the line.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
    await expect(posts).toHaveCount(4);
    await expect(buyers.locator('.badge-new')).toHaveCount(0);
    await expect(buyers.getByText('New', { exact: true })).toHaveCount(0);
    await expect(buyers.locator('.new-count')).toHaveCount(0);
  });

  test('a manual search with unseen posts never shows badges', async ({ page }) => {
    await mockSearch(page, 'buyers-ok');
    await seedStorage(page, KEY, JSON.stringify([record()]));
    await page.goto('/');

    await searchFor(page, 'mechanical keyboard');
    await expect(page.locator('section.results ol.posts > li')).toHaveCount(4);
    await expect(page.locator('.badge-new')).toHaveCount(0);
    await expect(page.locator('.new-count')).toHaveCount(0);
  });
});

test('the saved panel and the badge fit a 390 px wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockSearch(page, 'buyers-ok');
  const long = 'Sony A7 III body with a very long description that keeps going and going without stopping';
  await seedStorage(
    page,
    KEY,
    JSON.stringify([
      record({ id: 'rec-2', item: long, location: 'Saint Petersburg, Florida, United States of America' }),
      record({ seenPostIds: ['t3_p1'] }),
    ]),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Run "mechanical keyboard"' }).click();
  await expect(page.locator('.badge-new').first()).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
