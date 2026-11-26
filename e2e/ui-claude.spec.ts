// Run 4 AC12: the Claude UI states with mocked /api/search and /api/status responses - the
// "via Claude" line, the "AI suggested" badge and its board link, the Claude chip and the
// Claude fallback notice. The network guard keeps every request on the local server.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadFixture, mockSearch, mockStatus } from './fixtures/mock.ts';

const AI_NAME = 'r/MechanicalKeyboards';
const AI_URL = 'https://www.reddit.com/r/MechanicalKeyboards/';
const NOTICE = "Claude couldn't help with this search (declined); used the built-in catalog.";

async function search(page: Page, item = 'mechanical keyboard') {
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
}

const rows = (page: Page) => page.locator('ol.venues > li');
const row = (page: Page, name: string) => rows(page).filter({ has: page.getByRole('heading', { level: 3, name }) });

test.describe('Claude picks (mocked)', () => {
  test('a Claude plan reads "via Claude"', async ({ page }) => {
    await mockSearch(page, 'claude-keyboard');
    await page.goto('/');
    await search(page);
    await expect(page.getByText(/^Understood as: /)).toHaveText('Understood as: Mechanical keyboards · via Claude');
    await expect(page.getByText(/via built-in catalog/)).toHaveCount(0);
  });

  test('the AI-suggested venue shows the badge, its why line and only the board link', async ({ page }) => {
    const { blocked } = await mockSearch(page, 'claude-keyboard');
    await page.goto('/');
    await search(page);

    // It sits after the catalog specialists and before the general venues.
    await expect(rows(page).locator('.venue-name')).toHaveText([
      'r/mechmarket',
      'geekhack Classifieds',
      AI_NAME,
      'eBay',
      'Facebook Marketplace',
      'Craigslist',
    ]);

    const ai = row(page, AI_NAME);
    await expect(ai).toHaveCount(1);
    const badge = ai.locator('.venue-head').getByText('AI suggested', { exact: true });
    await expect(badge).toBeVisible();
    expect(await badge.evaluate((el) => el.tagName)).toBe('SPAN');
    expect(await badge.evaluate((el) => el.closest('a, button') === null)).toBe(true);
    await expect(ai.getByText(/^Why: /)).toHaveText('Why: Suggested by Claude');

    const links = ai.getByRole('link');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText('Open board');
    await expect(links).toHaveAttribute('href', AI_URL);
    await expect(links).toHaveAttribute('target', '_blank');
    await expect(links).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(ai.getByRole('link', { name: /^Search for / })).toHaveCount(0);

    // Catalog venues have no badge; r/mechmarket keeps its search link.
    await expect(page.getByText('AI suggested', { exact: true })).toHaveCount(1);
    await expect(row(page, 'r/mechmarket').getByRole('link', { name: "Search for 'mechanical keyboard' there" })).toHaveCount(1);
    expect(blocked).toEqual([]);
  });

  test('an AI venue never gets a search link, even if the server sent one', async ({ page }) => {
    const body = loadFixture('claude-keyboard');
    body.venues = body.venues.map((v) => (v.aiSuggested ? { ...v, searchUrl: `${AI_URL}search/?q=x` } : v));
    await mockSearch(page, (route) => route.fulfill({ status: 200, json: body }));
    await page.goto('/');
    await search(page);
    await expect(row(page, AI_NAME).getByRole('link')).toHaveCount(1);
  });

  test('the Claude fallback notice shows in the notices region with "via built-in catalog"', async ({ page }) => {
    await mockSearch(page, 'claude-fallback');
    await page.goto('/');
    await search(page);
    await expect(page.locator('.notices[role="status"]')).toHaveText(NOTICE);
    await expect(page.getByText(/^Understood as: /)).toHaveText(
      'Understood as: Mechanical keyboards · via built-in catalog',
    );
    await expect(page.getByText('AI suggested', { exact: true })).toHaveCount(0);
  });

  test('a venue row with the badge fits a 390 px wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    // Worst case: the longest subreddit name Reddit allows (21 characters).
    const body = loadFixture('claude-keyboard');
    body.venues = body.venues.map((v) => (v.aiSuggested ? { ...v, name: `r/${'W'.repeat(21)}` } : v));
    await mockSearch(page, (route) => route.fulfill({ status: 200, json: body }));
    await page.goto('/');
    await search(page);
    await expect(page.getByText('AI suggested', { exact: true })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The badge stays inside its row.
    const ai = rows(page).filter({ hasText: 'AI suggested' });
    const rowBox = await ai.boundingBox();
    const badgeBox = await ai.getByText('AI suggested', { exact: true }).boundingBox();
    expect(rowBox && badgeBox).toBeTruthy();
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
  });
});

test.describe('header status chips: Claude', () => {
  const chips = (page: Page) => page.locator('header .chip');

  test('a Claude key gives "Claude: on", after the eBay chip', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: true, fixtures: false, ebay: true, claude: true });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: on', 'eBay: on', 'Claude: on']);
  });

  test('no key gives "Claude: off (no key)"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: false, ebay: false, claude: false });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: off (no keys)', 'eBay: off (no keys)', 'Claude: off (no key)']);
  });

  test('fixture mode gives "Claude: fixture" before "Fixture data"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: true, ebay: false, claude: false });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: fixture', 'eBay: fixture', 'Claude: fixture', 'Fixture data']);
  });

  test('a status from an older server without "claude" reads as off', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.route('**/api/status', (route) =>
      route.fulfill({ status: 200, json: { version: '0.1.0', redditAuth: false, fixtures: false, ebay: false } }),
    );
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: off (no keys)', 'eBay: off (no keys)', 'Claude: off (no key)']);
  });

  test('a non-boolean "claude" in /api/status shows no chips, and search still works', async ({ page }) => {
    const { calls } = await mockSearch(page, 'claude-keyboard');
    let statusCalls = 0;
    await page.route('**/api/status', (route) => {
      statusCalls++;
      return route.fulfill({
        status: 200,
        json: { version: '0.1.0', redditAuth: false, fixtures: false, ebay: false, claude: 'yes' },
      });
    });
    await page.goto('/');
    await expect.poll(() => statusCalls).toBeGreaterThan(0);
    await search(page);
    await expect(page.locator('header .chips')).toHaveCount(0);
    expect(calls).toHaveLength(1);
  });
});
