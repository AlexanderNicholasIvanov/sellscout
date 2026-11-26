// "People looking for it" with mocked /api/search and /api/status (AC20 disabled, AC21, AC22, AC24).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadFixture, mockSearch, mockStatus } from './fixtures/mock.ts';
import type { FixtureName } from './fixtures/mock.ts';

// The buyers-ok fixture's post times are relative to this instant.
const NOW = new Date('2026-11-25T12:00:00Z');
const README_REDDIT = 'https://github.com/AlexanderNicholasIvanov/sellscout#reddit';
const LOOK_LINKS = ['Search Reddit for buyers', 'Search r/mechmarket', "Craigslist 'wanted' (pick your city)"];

async function searchFor(page: Page, fixture: FixtureName, item = 'mechanical keyboard') {
  const mocked = await mockSearch(page, fixture);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
  return mocked;
}

function buyersSection(page: Page) {
  return page.locator('section.results .buyers');
}

test.describe('people looking for it', () => {
  test('AC20: a disabled result explains how to add keys and still shows the look-yourself links', async ({
    page,
  }) => {
    await searchFor(page, 'mechanical-keyboard');
    const buyers = buyersSection(page);

    await expect(buyers.getByText(/^Searched Reddit for/)).toHaveText(
      'Searched Reddit for "mechanical keyboard" (last 30 days)',
    );
    await expect(buyers.getByText(/^Add Reddit app keys/)).toHaveText(
      "Add Reddit app keys to see live posts here. See the README's Reddit section.",
    );
    await expect(buyers.getByRole('link', { name: "README's Reddit section" })).toHaveAttribute(
      'href',
      README_REDDIT,
    );
    await expect(buyers.getByRole('heading', { level: 3, name: 'Look yourself' })).toBeVisible();
    await expect(buyers.locator('.look-links a')).toHaveText(LOOK_LINKS);
    await expect(buyers.getByRole('link', { name: 'Search r/mechmarket' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/mechmarket/search/?q=mechanical%20keyboard&restrict_sr=1&sort=new&t=month',
    );
    await expect(buyers.locator('ol.posts')).toHaveCount(0);

    // The buyers section comes after "Where to post it".
    const order = await page.locator('section.results').evaluate((section) => {
      const [venues, buyersHeading] = Array.from(section.querySelectorAll('h2'));
      return venues && buyersHeading ? venues.compareDocumentPosition(buyersHeading) : 0;
    });
    expect(order & 4).toBe(4); // Node.DOCUMENT_POSITION_FOLLOWING
  });

  test('ok with posts: each post shows its link, meta, stats and snippet', async ({ page }) => {
    await searchFor(page, 'buyers-ok');
    const buyers = buyersSection(page);
    const posts = buyers.locator('ol.posts > li');
    await expect(posts).toHaveCount(4);

    const first = posts.nth(0);
    await expect(first.getByRole('link', { name: 'WTB a 65% mechanical keyboard' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/mechmarket/comments/p1/wtb_a_65_mechanical_keyboard/',
    );
    await expect(first.locator('.post-meta')).toHaveText('r/mechmarket · u/keeb_buyer · 5 hours ago');
    await expect(first.locator('.post-stats')).toHaveText('12 points · 3 comments');
    await expect(first.locator('.post-snippet')).toHaveText('Looking for a hot-swap board, budget around $150.');

    // Singular forms; an empty snippet renders nothing.
    const second = posts.nth(1);
    await expect(second.locator('.post-meta')).toHaveText(
      'r/MechanicalKeyboards · u/first_keeb · 1 minute ago',
    );
    await expect(second.locator('.post-stats')).toHaveText('1 point · 1 comment');
    await expect(second.locator('.post-snippet')).toHaveCount(0);
    await expect(second.locator('p')).toHaveCount(3);

    await expect(posts.nth(2).locator('.post-meta')).toHaveText('r/mechmarket · u/sneaky · 1 day ago');
    await expect(posts.nth(2).locator('.post-stats')).toHaveText('0 points · 0 comments');
    await expect(posts.nth(3).locator('.post-meta')).toHaveText('r/mechmarket · u/old_keeb · 3 days ago');
    await expect(posts.nth(3).locator('.post-stats')).toHaveText('2 points · 5 comments');

    await expect(buyers.getByText(/^Add Reddit app keys/)).toHaveCount(0);
    await expect(buyers.getByRole('heading', { level: 3, name: 'Look yourself' })).toBeVisible();
  });

  test('ok with no posts says no one is asking in the window', async ({ page }) => {
    await searchFor(page, 'buyers-none');
    const buyers = buyersSection(page);
    await expect(buyers.getByText(/^Searched Reddit for/)).toHaveText(
      'Searched Reddit for "mechanical keyboard" (last 7 days)',
    );
    await expect(buyers.getByText('No one is asking for this on Reddit in the last 7 days.')).toBeVisible();
    await expect(buyers.locator('ol.posts')).toHaveCount(0);
    await expect(buyers.locator('.look-links a')).toHaveText(LOOK_LINKS);
  });

  test('unavailable shows the reason, the venues and the look-yourself links', async ({ page }) => {
    await searchFor(page, 'buyers-unavailable');
    const buyers = buyersSection(page);
    await expect(
      buyers.getByText('Reddit search unavailable: Reddit blocked the request (HTTP 403)'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
    await expect(page.locator('ol.venues > li')).toHaveCount(1);
    await expect(buyers.locator('.look-links a')).toHaveText(LOOK_LINKS);
  });

  test('AC24: buyer links open safely in a new tab; non-http(s) urls are not links', async ({ page }) => {
    await searchFor(page, 'buyers-ok');
    const buyers = buyersSection(page);

    const links = buyers.locator('a');
    const count = await links.count();
    expect(count).toBe(3 + LOOK_LINKS.length); // 3 safe post links + the safe look-yourself links
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(await link.getAttribute('href')).toMatch(/^https:\/\//);
    }

    // The javascript: post keeps its title as plain text.
    const unsafe = buyers.locator('ol.posts > li').nth(2);
    await expect(unsafe.locator('.post-title')).toHaveText('Looking for a mechanical keyboard (unsafe link)');
    await expect(unsafe.locator('a')).toHaveCount(0);
    // The javascript: look-yourself link is not rendered as a link.
    await expect(buyers.getByRole('link', { name: 'Unsafe look-yourself link' })).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  test('AC24: when no look-yourself link is http(s), no empty list is rendered', async ({ page }) => {
    const fixture = loadFixture('buyers-none');
    fixture.buyers.links = [
      { label: 'Script link', url: 'javascript:alert(1)' },
      { label: 'Data link', url: 'data:text/html,hi' },
      { label: 'Relative link', url: '/r/mechmarket' },
    ];
    await mockSearch(page, (route) => route.fulfill({ status: 200, json: fixture }));
    await page.goto('/');
    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const buyers = buyersSection(page);
    await expect(buyers.getByRole('heading', { level: 3, name: 'Look yourself' })).toBeVisible();
    await expect(buyers.locator('.look-links')).toHaveCount(0);
    await expect(buyers.locator('ul')).toHaveCount(0);
    await expect(buyers.getByRole('link')).toHaveCount(0);
  });

  test('AC24: the disabled-state README link opens safely in a new tab', async ({ page }) => {
    await searchFor(page, 'mechanical-keyboard');
    const readme = buyersSection(page).getByRole('link', { name: "README's Reddit section" });
    await expect(readme).toHaveAttribute('target', '_blank');
    await expect(readme).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

test.describe('buyer window', () => {
  test('AC21: the select defaults to 30 days and sends the chosen window as a number', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const select = page.getByLabel('Buyer posts from the last');
    await expect(select).toHaveValue('30');
    await expect(select.locator('option')).toHaveText(['7 days', '30 days', '90 days']);

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'People looking for it' })).toBeVisible();
    expect(calls[0].body.window).toBe(30);

    await select.selectOption({ label: '7 days' });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1].body).toEqual({ item: 'mechanical keyboard', delivery: 'both', window: 7 });

    await select.selectOption({ label: '90 days' });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => calls.length).toBe(3);
    expect(calls[2].body.window).toBe(90);
  });
});

test.describe('header status chips', () => {
  const chips = (page: Page) => page.locator('header .chip');

  test('AC22: no keys and no fixtures gives "Reddit: off (no keys)"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: false });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: off (no keys)', 'eBay: off (no keys)', 'Claude: off (no key)']);
  });

  test('AC22: Reddit keys give "Reddit: on"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: true, fixtures: false });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: on', 'eBay: off (no keys)', 'Claude: off (no key)']);
  });

  test('AC22: fixture mode gives "Reddit: fixture" and "Fixture data"', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await mockStatus(page, { redditAuth: false, fixtures: true });
    await page.goto('/');
    await expect(chips(page)).toHaveText(['Reddit: fixture', 'eBay: fixture', 'Claude: fixture', 'Fixture data']);
  });

  for (const [label, respond] of [
    ['a 500', 500],
    ['a malformed body', { redditAuth: 'yes', fixtures: false }],
  ] as const) {
    test(`AC22: ${label} from /api/status shows no chips and search still works`, async ({ page }) => {
      const { calls } = await mockSearch(page, 'mechanical-keyboard');
      let statusCalls = 0;
      await page.route('**/api/status', (route) => {
        statusCalls++;
        return typeof respond === 'number'
          ? route.fulfill({ status: respond, json: { error: 'Internal error' } })
          : route.fulfill({ status: 200, json: { version: '0.1.0', ...respond } });
      });
      await page.goto('/');

      await expect.poll(() => statusCalls).toBeGreaterThan(0);
      await page.getByLabel('What are you selling?').fill('mechanical keyboard');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'People looking for it' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
      await expect(page.locator('header .chips')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveText('');
      expect(calls).toHaveLength(1);
    });
  }
});
