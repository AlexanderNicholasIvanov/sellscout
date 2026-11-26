// "Similar listings on eBay" with mocked /api/search and /api/status (run 3 AC12), and the mocked
// eBay category venue in "Where to post it".
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadFixture, mockSearch, mockStatus } from './fixtures/mock.ts';
import type { FixtureName } from './fixtures/mock.ts';

const README_EBAY = 'https://github.com/AlexanderNicholasIvanov/sellscout#ebay';
const SEARCH_URL = 'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard';
const SEARCHED = 'Searched eBay for "mechanical keyboard" (fixed-price listings in US dollars)';

async function submit(page: Page, item = 'mechanical keyboard') {
  await page.goto('/');
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

async function searchFor(page: Page, fixture: FixtureName) {
  const mocked = await mockSearch(page, fixture);
  await submit(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Similar listings on eBay' })).toBeVisible();
  return mocked;
}

const ebaySection = (page: Page) => page.locator('section.results .ebay');
const listings = (page: Page) => ebaySection(page).locator('ol.listings > li');

/** "Search eBay yourself" is the section's last line, in every status. */
async function expectSearchYourself(page: Page) {
  const link = ebaySection(page).getByRole('link', { name: 'Search eBay yourself' });
  await expect(link).toHaveAttribute('href', SEARCH_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(await ebaySection(page).evaluate((el) => el.lastElementChild?.textContent)).toBe('Search eBay yourself');
}

test.describe('similar listings on eBay (AC12)', () => {
  test('ok with a range: the range line, then each listing with its price and condition', async ({ page }) => {
    const { blocked } = await searchFor(page, 'ebay-ok');
    const ebay = ebaySection(page);

    await expect(ebay.locator('.ebay-searched')).toHaveText(SEARCHED);
    await expect(ebay.locator('.ebay-range')).toHaveText(
      'Asking prices of 5 active listings (not sold prices): $85.00 to $142.50, median $110.00',
    );
    await expect(ebay.getByText('Not enough listings for a price range.')).toHaveCount(0);

    await expect(listings(page)).toHaveCount(5);
    await expect(listings(page).locator('.listing-title')).toHaveText([
      'Keychron Q1 Pro mechanical keyboard, fully assembled',
      '65% mechanical keyboard, hot-swap',
      'Mechanical keyboard (unsafe link)',
      'Mechanical keyboard, brown switches',
      'TKL mechanical keyboard',
    ]);
    // Money is formatted with Intl.NumberFormat en-US / USD.
    await expect(listings(page).locator('.listing-price')).toHaveText([
      '$1,234.56',
      '$85.00',
      '$110.00',
      '$142.50',
      '$60.00',
    ]);

    const first = listings(page).nth(0);
    await expect(first.getByRole('link', { name: 'Keychron Q1 Pro mechanical keyboard, fully assembled' })).toHaveAttribute(
      'href',
      'https://www.ebay.com/itm/111111111111',
    );
    await expect(first.locator('.listing-condition')).toHaveText('Pre-owned');

    // An empty condition renders nothing: only the title and the price.
    const second = listings(page).nth(1);
    await expect(second.locator('.listing-condition')).toHaveCount(0);
    await expect(second.locator('p')).toHaveText(['65% mechanical keyboard, hot-swap', '$85.00']);

    await expectSearchYourself(page);
    // No images are loaded, and nothing left the machine.
    await expect(ebay.locator('img')).toHaveCount(0);
    expect(blocked).toEqual([]);
  });

  test('listing links open safely in a new tab; a javascript: url is not a link', async ({ page }) => {
    await searchFor(page, 'ebay-ok');
    const ebay = ebaySection(page);

    const links = ebay.locator('a');
    const count = await links.count();
    expect(count).toBe(4 + 1); // 4 safe listing links + "Search eBay yourself"
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(await link.getAttribute('href')).toMatch(/^https:\/\/www\.ebay\.com\//);
    }

    const unsafe = listings(page).nth(2);
    await expect(unsafe.locator('.listing-title')).toHaveText('Mechanical keyboard (unsafe link)');
    await expect(unsafe.locator('a')).toHaveCount(0);
    await expect(unsafe.locator('.listing-price')).toHaveText('$110.00');
    await expect(unsafe.locator('.listing-condition')).toHaveText('New');
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  test('ok with listings but no range says there are not enough listings', async ({ page }) => {
    await searchFor(page, 'ebay-no-range');
    const ebay = ebaySection(page);
    await expect(ebay.locator('.ebay-searched')).toHaveText(SEARCHED);
    await expect(ebay.locator('.ebay-range')).toHaveText('Not enough listings for a price range.');
    await expect(ebay.getByText(/^Asking prices of/)).toHaveCount(0);
    await expect(listings(page)).toHaveCount(2);
    await expect(listings(page).locator('.listing-price')).toHaveText(['$249.99', '$39.50']);
    await expect(listings(page).nth(1).locator('.listing-condition')).toHaveCount(0);
    await expectSearchYourself(page);
  });

  test('ok with no listings says none were found', async ({ page }) => {
    await searchFor(page, 'ebay-none');
    const ebay = ebaySection(page);
    await expect(ebay.locator('.ebay-searched')).toHaveText(SEARCHED);
    await expect(ebay.locator('.ebay-message')).toHaveText(
      'No fixed-price eBay listings found for "mechanical keyboard".',
    );
    await expect(ebay.locator('ol.listings')).toHaveCount(0);
    await expect(ebay.getByText(/^Asking prices of/)).toHaveCount(0);
    await expect(ebay.getByText('Not enough listings for a price range.')).toHaveCount(0);
    await expectSearchYourself(page);
  });

  test('unavailable shows the reason; the venues and buyers still show', async ({ page }) => {
    await searchFor(page, 'ebay-unavailable');
    const ebay = ebaySection(page);
    await expect(ebay.locator('.ebay-message')).toHaveText(
      'eBay search unavailable: eBay rate limit reached (HTTP 429)',
    );
    await expect(ebay.locator('ol.listings')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
    await expect(page.locator('ol.venues > li')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
    await expectSearchYourself(page);
  });

  test('disabled explains how to add keys and links the README eBay section', async ({ page }) => {
    await searchFor(page, 'ebay-disabled');
    const ebay = ebaySection(page);
    await expect(ebay.locator('.ebay-searched')).toHaveText(SEARCHED);
    await expect(ebay.locator('.ebay-message')).toHaveText(
      "Add eBay app keys in Settings to see similar listings and asking prices. See the README's eBay section.",
    );
    const readme = ebay.getByRole('link', { name: "README's eBay section" });
    await expect(readme).toHaveAttribute('href', README_EBAY);
    await expect(readme).toHaveAttribute('target', '_blank');
    await expect(readme).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(ebay.locator('ol.listings')).toHaveCount(0);
    await expectSearchYourself(page);
  });

  test('the existing fixtures (eBay disabled) show the section with its own term', async ({ page }) => {
    await mockSearch(page, 'no-match');
    await submit(page, 'asdfgh');
    const ebay = ebaySection(page);
    await expect(ebay.locator('.ebay-searched')).toHaveText(
      'Searched eBay for "asdfgh" (fixed-price listings in US dollars)',
    );
    await expect(ebay.getByRole('link', { name: 'Search eBay yourself' })).toHaveAttribute(
      'href',
      'https://www.ebay.com/sch/i.html?_nkw=asdfgh',
    );
  });

  test('the eBay section comes after "People looking for it"', async ({ page }) => {
    await searchFor(page, 'ebay-ok');
    const headings = await page.locator('section.results h2').allTextContents();
    expect(headings).toEqual(['Where to post it', 'People looking for it', 'Similar listings on eBay']);
  });

  test('a non-http(s) searchUrl is not rendered as a link', async ({ page }) => {
    const fixture = loadFixture('ebay-none');
    fixture.ebay.searchUrl = 'javascript:alert(3)';
    await mockSearch(page, (route) => route.fulfill({ status: 200, json: fixture }));
    await submit(page);
    const ebay = ebaySection(page);
    await expect(ebay.locator('.ebay-message')).toBeVisible();
    await expect(ebay.getByRole('link')).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  const badResponses: [string, (body: Record<string, unknown>) => void][] = [
    ['without ebay', (body) => delete body.ebay],
    ['with a null ebay', (body) => (body.ebay = null)],
    ['with an unknown ebay status', (body) => ((body.ebay as Record<string, unknown>).status = 'maybe')],
    [
      'with a string listing price',
      (body) => {
        const ebay = body.ebay as { listings: Record<string, unknown>[] };
        ebay.listings[0].price = '$1,234.56';
      },
    ],
    [
      'with a priceRange missing its median',
      (body) => delete (body.ebay as { priceRange: Record<string, unknown> }).priceRange.median,
    ],
  ];
  for (const [label, breakIt] of badResponses) {
    test(`a response ${label} shows the bad-response error`, async ({ page }) => {
      const body = loadFixture('ebay-ok') as unknown as Record<string, unknown>;
      breakIt(body);
      await mockSearch(page, (route) => route.fulfill({ status: 200, json: body }));
      await submit(page);
      await expect(page.locator('.alert-region')).toHaveText('Search failed: Unexpected response from server');
      await expect(page.getByRole('heading', { name: 'Similar listings on eBay' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Where to post it' })).toHaveCount(0);
    });
  }
});

test.describe('the eBay category venue', () => {
  test('a mocked ebay-category venue renders like any venue, right after eBay', async ({ page }) => {
    await searchFor(page, 'ebay-ok');
    const rows = page.locator('ol.venues > li');
    await expect(rows.locator('.venue-name')).toHaveText(['eBay', 'eBay - Keyboards & Keypads']);

    const category = rows.nth(1);
    await expect(category.getByRole('heading', { level: 3, name: 'eBay - Keyboards & Keypads' })).toBeVisible();
    await expect(category.getByText('marketplace', { exact: true })).toBeVisible();
    await expect(category.locator('.venue-why')).toHaveText('Why: eBay category for "mechanical keyboard"');
    // No tips and no search url: no "Posting tips" and only the "Open board" link.
    await expect(category.locator('details')).toHaveCount(0);
    await expect(category.getByRole('link')).toHaveCount(1);
    const open = category.getByRole('link', { name: 'Open board' });
    await expect(open).toHaveAttribute(
      'href',
      'https://www.ebay.com/sch/i.html?_nkw=mechanical%20keyboard&_sacat=33963',
    );
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

test.describe('header status chips: eBay (AC12)', () => {
  const chips = (page: Page) => page.locator('header .chip');

  test('eBay keys give "eBay: on", after the Reddit chip', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: false, ebay: true });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: off (no keys)', 'eBay: on', 'Claude: off (no key)']);
  });

  test('Reddit and eBay keys give "Reddit: on" and "eBay: on"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: true, fixtures: false, ebay: true });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: on', 'eBay: on', 'Claude: off (no key)']);
  });

  test('no eBay keys give "eBay: off (no keys)"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: false, ebay: false });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: off (no keys)', 'eBay: off (no keys)', 'Claude: off (no key)']);
  });

  test('fixture mode gives "eBay: fixture" before "Fixture data"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: true, ebay: false });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: fixture', 'eBay: fixture', 'Claude: fixture', 'Fixture data']);
  });

  for (const [label, ebay] of [
    ['a missing', undefined],
    ['a string', 'true'],
  ] as const) {
    test(`${label} ebay field in /api/status shows no chips`, async ({ page }) => {
      await mockSearch(page, 'mechanical-keyboard');
      let statusCalls = 0;
      await page.route('**/api/status', (route) => {
        statusCalls++;
        return route.fulfill({ status: 200, json: { version: '0.1.0', redditAuth: true, fixtures: false, ebay } });
      });
      await page.goto('/');
      await expect.poll(() => statusCalls).toBeGreaterThan(0);
      await page.getByLabel('What are you selling?').fill('mechanical keyboard');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Similar listings on eBay' })).toBeVisible();
      await expect(page.locator('header .chips')).toHaveCount(0);
    });
  }
});
