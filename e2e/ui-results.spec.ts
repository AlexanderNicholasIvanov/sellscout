import { expect, test } from '@playwright/test';
import { loadFixture, mockSearch } from './fixtures/mock.ts';

test.describe('search results', () => {
  test('AC18: "mechanical keyboard" shows the plan, the venues and the links', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByText(/^Understood as: .+ · via built-in catalog$/)).toHaveText(
      'Understood as: Mechanical keyboards · via built-in catalog',
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();

    const rows = page.locator('ol.venues > li');
    await expect(rows).toHaveCount(5);
    const first = rows.first();
    await expect(first.getByRole('heading', { name: 'r/mechmarket' })).toBeVisible();
    await expect(first.getByText('subreddit', { exact: true })).toBeVisible();
    await expect(first.getByText(/^Why: /)).toHaveText('Why: mechanical keyboard, keyboard');
    await expect(first.getByText(/PayPal Goods & Services/)).toBeVisible();

    const details = first.locator('details');
    await expect(details.locator('summary')).toHaveText('Posting tips');
    await expect(details).not.toHaveAttribute('open');
    await expect(details.getByText(/timestamp photo/)).toBeHidden();
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details.getByRole('listitem')).toHaveCount(2);

    await expect(first.getByRole('link', { name: 'Open board' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/mechmarket/',
    );
    await expect(first.getByRole('link', { name: "Search for 'mechanical keyboard' there" })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/mechmarket/search/?q=mechanical%20keyboard&restrict_sr=1',
    );

    // A venue without searchUrl has only the "Open board" link; kind badges use readable labels.
    const craigslist = rows.filter({ has: page.getByRole('heading', { name: 'Craigslist' }) });
    await expect(craigslist.getByRole('link')).toHaveCount(1);
    await expect(craigslist.getByText('local classifieds', { exact: true })).toBeVisible();

    // No notices for this search.
    await expect(page.getByRole('status')).toHaveText('');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].contentType).toMatch(/^application\/json/);
    expect(calls[0].body).toEqual({ item: 'mechanical keyboard', delivery: 'both', window: 30 });
    expect(calls[0].body).not.toHaveProperty('location');
  });

  test('a non-blank location and delivery choice are sent in the body', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByLabel('Location (optional)').fill('  Seattle  ');
    await page.getByLabel('Ship it').check();
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
    expect(calls[0].body).toEqual({ item: 'mechanical keyboard', location: 'Seattle', delivery: 'ship', window: 30 });
  });

  test('AC21: the no-match fixture shows its notice and "general item"', async ({ page }) => {
    await mockSearch(page, 'no-match');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('asdfgh');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('status')).toContainText(
      'No specialist boards matched "asdfgh". Try more specific words (brand, model, type).',
    );
    await expect(page.getByText('Understood as: general item · via built-in catalog')).toBeVisible();
  });

  test('AC21: the location fixture shows the location notice before the results', async ({ page }) => {
    await mockSearch(page, 'location-notice');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByLabel('Location (optional)').fill('Nowhereville');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const status = page.getByRole('status');
    await expect(status.getByRole('listitem')).toHaveText([
      `Couldn't match "Nowhereville" to a city; local links are generic.`,
    ]);
    // Notices come first in the results area.
    const order = await page.locator('section.results').evaluate((section) => {
      const notice = section.querySelector('[role="status"] li');
      const heading = section.querySelector('h2');
      return notice && heading ? notice.compareDocumentPosition(heading) : 0;
    });
    expect(order & 4).toBe(4); // Node.DOCUMENT_POSITION_FOLLOWING
  });

  test('an identical notice on a repeat search is cleared while searching and shown again', async ({
    page,
  }) => {
    let gate: Promise<void> = Promise.resolve();
    let release: () => void = () => {};
    const { calls } = await mockSearch(page, async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: loadFixture('no-match') });
    });
    await page.goto('/');

    const notice = 'No specialist boards matched "asdfgh". Try more specific words (brand, model, type).';
    const status = page.getByRole('status');
    await page.getByLabel('What are you selling?').fill('asdfgh');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(status.getByRole('listitem')).toHaveText([notice]);

    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Searching...' })).toBeDisabled();
    await expect(status.getByRole('listitem')).toHaveCount(0);
    await expect(status).toHaveText('');
    // The busy cue does not dim the previous results (they keep full contrast).
    const results = page.locator('section.results');
    await expect(results).toHaveAttribute('aria-busy', 'true');
    expect(await results.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.locator('ol.venues').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

    release();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
    await expect(status.getByRole('listitem')).toHaveText([notice]);
    expect(calls).toHaveLength(2);
  });

  test('AC22: every external link opens safely in a new tab', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();

    const links = page.locator('section.results a');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator('section.results a[target="_blank"]')).toHaveCount(count);
    for (let i = 0; i < count; i++) {
      const rel = ((await links.nth(i).getAttribute('rel')) ?? '').split(/\s+/);
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
  });

  test('the layout fits a 375 px wide screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
