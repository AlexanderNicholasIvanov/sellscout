// Unmocked buyer checks against the real server in fixture mode (SELLSCOUT_FIXTURES=1, set in
// playwright.config.ts): the fixture Reddit data set, the real classifier and the real status
// (AC19, AC20 fixture cases, AC22 fixture chips). Only the external-request guard is installed.
// These need the real Reddit source (u2); with the disabled stub they fail on buyer assertions.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { blockExternalRequests } from './fixtures/mock.ts';

const MK1_TITLE = '[US-CA] [H] PayPal [W] Mechanical keyboard, 65% layout preferred';
const MK3_TITLE = 'WTB a mechanical keyboard for a beginner';
const ABSENT_30 = {
  fx_mk2: '[US-NY] [H] Mechanical keyboard, Keychron Q1 [W] PayPal',
  fx_mk4: 'WTB mechanical keyboard (nsfw test)',
  fx_mk5: 'Looking for a mechanical keyboard - monthly thread',
  fx_mk6: 'WTB mechanical keyboard, older post',
};

async function search(page: Page, item: string, windowLabel: '7 days' | '30 days' | '90 days') {
  await page.getByLabel('What are you selling?').fill(item);
  await page.getByLabel('Buyer posts from the last').selectOption({ label: windowLabel });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
}

const buyers = (page: Page) => page.locator('section.results .buyers');
const posts = (page: Page) => buyers(page).locator('ol.posts > li');
const postById = (page: Page, id: string): Locator =>
  posts(page).filter({ has: page.locator(`a[href*="/comments/${id}/"]`) });

async function postIds(page: Page): Promise<string[]> {
  return posts(page)
    .locator('.post-title a')
    .evaluateAll((links) =>
      links.map((a) => /\/comments\/([^/]+)\//.exec((a as HTMLAnchorElement).href)?.[1] ?? ''),
    );
}

test.describe('live buyers @needs-reddit-source', () => {
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
  });

  test('AC19: "mechanical keyboard" (30 days) shows the fixture buyer posts, newest first', async ({ page }) => {
    await search(page, 'mechanical keyboard', '30 days');

    await expect(buyers(page).getByText(/^Searched Reddit for/)).toHaveText(
      'Searched Reddit for "mechanical keyboard" (last 30 days)',
    );

    const mk1 = postById(page, 'fx_mk1');
    await expect(mk1).toHaveCount(1);
    const mk1Link = mk1.getByRole('link', { name: MK1_TITLE });
    await expect(mk1Link).toHaveAttribute(
      'href',
      /^https:\/\/www\.reddit\.com\/r\/mechmarket\/comments\/fx_mk1\//,
    );
    await expect(mk1Link).toHaveAttribute('target', '_blank');
    await expect(mk1Link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(mk1.locator('.post-meta')).toHaveText('r/mechmarket · u/keeb_buyer · 5 hours ago');
    await expect(mk1.locator('.post-stats')).toHaveText('12 points · 3 comments');
    await expect(mk1.locator('.post-snippet')).toHaveText('Looking for a hot-swap board. See my wishlist.');

    const mk3 = postById(page, 'fx_mk3');
    await expect(mk3).toHaveCount(1);
    await expect(mk3.getByRole('link', { name: MK3_TITLE })).toHaveAttribute(
      'href',
      /^https:\/\/www\.reddit\.com\/r\/MechanicalKeyboards\/comments\/fx_mk3\//,
    );
    await expect(mk3.locator('.post-meta')).toHaveText('r/MechanicalKeyboards · u/first_keeb · 1 day ago');
    await expect(mk3.locator('.post-stats')).toHaveText('4 points · 9 comments');
    await expect(mk3.locator('.post-snippet')).toHaveCount(0);

    const ids = await postIds(page);
    expect(ids.indexOf('fx_mk1')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('fx_mk1')).toBeLessThan(ids.indexOf('fx_mk3'));

    // The seller, NSFW, stickied and out-of-window posts are not shown.
    for (const [id, title] of Object.entries(ABSENT_30)) {
      expect(ids).not.toContain(id);
      await expect(buyers(page).getByText(title, { exact: true })).toHaveCount(0);
    }
  });

  test('AC19: with 90 days the older fixture post is shown too, last', async ({ page }) => {
    await search(page, 'mechanical keyboard', '90 days');
    await expect(buyers(page).getByText(/^Searched Reddit for/)).toHaveText(
      'Searched Reddit for "mechanical keyboard" (last 90 days)',
    );
    await expect(postById(page, 'fx_mk6')).toHaveCount(1);
    await expect(postById(page, 'fx_mk6').locator('.post-meta')).toHaveText(
      'r/MechanicalKeyboards · u/old_keeb · 40 days ago',
    );
    const ids = await postIds(page);
    expect(ids.indexOf('fx_mk1')).toBeLessThan(ids.indexOf('fx_mk3'));
    expect(ids.at(-1)).toBe('fx_mk6');
    for (const id of ['fx_mk2', 'fx_mk4', 'fx_mk5']) expect(ids).not.toContain(id);
  });

  test('AC20: "desk" with 7 days says no one is asking', async ({ page }) => {
    await search(page, 'desk', '7 days');
    await expect(
      buyers(page).getByText('No one is asking for this on Reddit in the last 7 days.'),
    ).toBeVisible();
    await expect(posts(page)).toHaveCount(0);
    await expect(buyers(page).getByRole('heading', { level: 3, name: 'Look yourself' })).toBeVisible();
  });

  test('AC20: "reddit-403" shows the reason, with venues and look-yourself links', async ({ page }) => {
    await search(page, 'reddit-403', '30 days');
    await expect(
      buyers(page).getByText('Reddit search unavailable: Reddit blocked the request (HTTP 403)'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();
    await expect(page.locator('ol.venues > li').first()).toBeVisible();
    await expect(buyers(page).getByRole('heading', { level: 3, name: 'Look yourself' })).toBeVisible();
    const look = buyers(page).locator('.look-links a');
    await expect(look.first()).toHaveText('Search Reddit for buyers');
    await expect(look.first()).toHaveAttribute('href', /^https:\/\/www\.reddit\.com\/search\/\?q=/);
  });

  test('AC22: the fixture-mode server shows "Reddit: fixture" and "Fixture data"', async ({ page }) => {
    await expect(page.locator('header .chip')).toHaveText(['Reddit: fixture', 'eBay: fixture', 'Fixture data']);
  });
});
