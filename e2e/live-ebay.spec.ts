// Unmocked eBay checks against the real server in fixture mode (SELLSCOUT_FIXTURES=1, set in
// playwright.config.ts): the in-repo eBay fixture data through the real parsing, the real
// category venue and the real status (run 3 AC13). Only the external-request guard is installed.
// These need the real eBay source (u1); with the disabled stub they fail on eBay assertions.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { blockExternalRequests } from './fixtures/mock.ts';

const ebay = (page: Page) => page.locator('section.results .ebay');
const listings = (page: Page) => ebay(page).locator('ol.listings > li');

async function search(page: Page, item: string) {
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Similar listings on eBay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
}

test.describe('live eBay @needs-ebay-source', () => {
  let blocked: string[] = [];

  test.beforeEach(async ({ page }) => {
    blocked = await blockExternalRequests(page);
    await page.goto('/');
  });

  test.afterEach(() => {
    // Nothing left the machine: no eBay call and no listing image.
    expect(blocked).toEqual([]);
  });

  test('AC13: "mechanical keyboard" shows 6 listings, the range and the category venue', async ({ page }) => {
    await search(page, 'mechanical keyboard');

    await expect(ebay(page).locator('.ebay-searched')).toHaveText(
      'Searched eBay for "mechanical keyboard" (fixed-price listings in US dollars)',
    );
    await expect(ebay(page).locator('.ebay-range')).toHaveText(
      'Asking prices of 6 active listings (not sold prices): $85.00 to $142.50, median $110.00',
    );

    // fx_eb1-fx_eb6 in eBay's order; the GBP item fx_eb7 and the price-less fx_eb8 are skipped.
    await expect(listings(page)).toHaveCount(6);
    const hrefs = await listings(page)
      .locator('.listing-title a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual([1, 2, 3, 4, 5, 6].map((n) => `https://www.ebay.com/itm/fx_eb${n}`));
    await expect(listings(page).locator('.listing-price')).toHaveText([
      '$50.00',
      '$80.00',
      '$100.00',
      '$120.00',
      '$150.00',
      '$400.00',
    ]);
    for (let i = 0; i < 6; i++) {
      const row = listings(page).nth(i);
      await expect(row.locator('.listing-title')).toContainText(/mechanical keyboard/i);
      const link = row.locator('.listing-title a');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // fx_eb3 has an empty condition, so it shows none; every other listing shows one.
      await expect(row.locator('.listing-condition')).toHaveCount(i === 2 ? 0 : 1);
    }
    await expect(ebay(page).getByText(/fx_eb7|fx_eb8/)).toHaveCount(0);
    await expect(ebay(page).locator(`a[href*="fx_eb7"], a[href*="fx_eb8"]`)).toHaveCount(0);

    await expect(ebay(page).getByRole('link', { name: 'Search eBay yourself' })).toHaveAttribute(
      'href',
      'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard',
    );

    // The category venue sits right after the eBay venue.
    const names = await page.locator('ol.venues > li .venue-name').allTextContents();
    const at = names.indexOf('eBay - Keyboards & Keypads');
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe('eBay');
    const category = page.locator('ol.venues > li').nth(at);
    await expect(category.getByRole('link', { name: 'Open board' })).toHaveAttribute(
      'href',
      'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963',
    );
  });

  test('AC13: "desk" shows its listings and no price range', async ({ page }) => {
    await search(page, 'desk');
    await expect(ebay(page).locator('.ebay-range')).toHaveText('Not enough listings for a price range.');
    await expect(listings(page)).toHaveCount(2);
    await expect(ebay(page).getByText(/^Asking prices of/)).toHaveCount(0);
  });

  test('an unmatched term shows no listings', async ({ page }) => {
    await search(page, 'asdfgh');
    await expect(ebay(page).locator('.ebay-message')).toHaveText(
      'No fixed-price eBay listings found for "asdfgh".',
    );
    await expect(listings(page)).toHaveCount(0);
  });

  test('AC13: "ebay-429 widget" shows the reason, and the venues and buyers still show', async ({ page }) => {
    await search(page, 'ebay-429 widget');
    await expect(ebay(page).locator('.ebay-message')).toHaveText(
      'eBay search unavailable: eBay rate limit reached (HTTP 429)',
    );
    await expect(listings(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
    await expect(page.locator('ol.venues > li').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
    await expect(page.locator('section.results .buyers .look-links a').first()).toBeVisible();
    await expect(ebay(page).getByRole('link', { name: 'Search eBay yourself' })).toBeVisible();
    await expect(page.locator('.alert-region')).toHaveText('');
  });

  for (const [item, reason] of [
    ['ebay-401 widget', 'eBay rejected the app keys (HTTP 401)'],
    ['ebay-403 widget', 'eBay refused the request (HTTP 403)'],
    ['ebay-500 widget', 'eBay returned HTTP 500'],
    ['ebay-html widget', 'eBay returned an unexpected response'],
    ['ebay-timeout widget', 'eBay took too long to answer'],
  ] as const) {
    test(`"${item}" shows "${reason}"`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.getByLabel('What are you selling?').fill(item);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      // A timeout may take the real 10 s request timeout to come back.
      await expect(ebay(page).locator('.ebay-message')).toHaveText(`eBay search unavailable: ${reason}`, {
        timeout: 30_000,
      });
    });
  }

  test('the fixture-mode server shows "eBay: fixture" between Reddit and "Fixture data"', async ({ page }) => {
    await expect(page.locator('header .chip')).toHaveText(['Reddit: fixture', 'eBay: fixture', 'Fixture data']);
  });
});
