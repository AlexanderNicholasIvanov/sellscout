// Run 4 AC13: the Claude planner against the real server in fixture mode (SELLSCOUT_FIXTURES=1,
// set in playwright.config.ts), where it runs on the in-repo stand-in client. Only the
// external-request guard is installed, so nothing leaves the machine.
// These need the real Claude planner (u1); without it every fixture search is "via built-in
// catalog" and has no AI-suggested venue.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { blockExternalRequests } from './fixtures/mock.ts';

async function search(page: Page, item: string) {
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
}

const rows = (page: Page) => page.locator('ol.venues > li');

test.describe('live Claude', () => {
  let blocked: string[] = [];

  test.beforeEach(async ({ page }) => {
    blocked = await blockExternalRequests(page);
    await page.goto('/');
  });

  test.afterEach(() => {
    // Nothing left the machine: no Anthropic, Reddit or eBay call.
    expect(blocked).toEqual([]);
  });

  test('AC13: "mechanical keyboard" is via Claude with the AI-suggested r/MechanicalKeyboards @needs-claude-planner', async ({
    page,
  }) => {
    await search(page, 'mechanical keyboard');
    await expect(page.getByText(/^Understood as: /)).toHaveText('Understood as: Mechanical keyboards · via Claude');

    const names = await rows(page).locator('.venue-name').allTextContents();
    expect(names[0]).toBe('r/mechmarket');
    expect(names.filter((n) => n === 'r/MechanicalKeyboards')).toHaveLength(1);
    // The AI venue comes after the catalog specialists and before the general venues.
    expect(names.indexOf('r/MechanicalKeyboards')).toBeLessThan(names.indexOf('eBay'));

    const ai = rows(page).filter({ has: page.getByRole('heading', { level: 3, name: 'r/MechanicalKeyboards' }) });
    await expect(ai.getByText('AI suggested', { exact: true })).toBeVisible();
    await expect(ai.getByText(/^Why: /)).toHaveText('Why: Suggested by Claude');
    const links = ai.getByRole('link');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText('Open board');
    await expect(links).toHaveAttribute('href', 'https://www.reddit.com/r/MechanicalKeyboards/');
    // Only that one venue carries the badge.
    await expect(page.getByText('AI suggested', { exact: true })).toHaveCount(1);

    // The buyer and eBay terms are the Claude term, so the fixture data is unchanged.
    await expect(page.locator('.buyers')).toContainText('Searched Reddit for "mechanical keyboard"');
    await expect(page.locator('.ebay')).toContainText('Searched eBay for "mechanical keyboard"');
  });

  test('AC13: "claude-refusal" shows the Claude notice and "via built-in catalog" @needs-claude-planner', async ({
    page,
  }) => {
    await search(page, 'claude-refusal');
    await expect(page.locator('.notices[role="status"]')).toContainText(
      "Claude couldn't help with this search (declined); used the built-in catalog.",
    );
    await expect(page.getByText(/^Understood as: /)).toHaveText('Understood as: general item · via built-in catalog');
    await expect(page.getByText('AI suggested', { exact: true })).toHaveCount(0);
  });

  test('AC13: the fixture-mode server shows "Claude: fixture" @needs-claude-planner', async ({ page }) => {
    await expect(page.locator('header .chip')).toHaveText([
      'Reddit: fixture',
      'eBay: fixture',
      'Claude: fixture',
      'Fixture data',
    ]);
  });
});
