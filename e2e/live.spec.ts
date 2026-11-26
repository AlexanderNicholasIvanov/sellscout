// Unmocked end-to-end checks: the real server, the real catalog and metro table (AC18, AC21).
// Only the external-request guard is installed, so nothing leaves the machine (AC28).
import { expect, test } from '@playwright/test';
import { blockExternalRequests } from './fixtures/mock.ts';

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await page.goto('/');
});

test('live: mechanical keyboard lists r/mechmarket with why, tips and links', async ({ page }) => {
  await page.getByLabel('What are you selling?').fill('mechanical keyboard');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByText(/^Understood as: .*· via built-in catalog$/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Where to post it' })).toBeVisible();

  const row = page.getByRole('listitem').filter({ hasText: 'r/mechmarket' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Why:');
  const tips = row.locator('details');
  await expect(tips).toHaveCount(1);
  await expect(tips).not.toHaveAttribute('open', /.*/);
  await expect(row.getByRole('link', { name: 'Open board' })).toHaveAttribute('href', /^https:\/\//);
  await expect(row.getByRole('link', { name: "Search for 'mechanical keyboard' there" })).toHaveAttribute(
    'href',
    /mechanical%20keyboard/,
  );
});

test('live: an unmatched item shows the no-match notice and general venues only', async ({ page }) => {
  await page.getByLabel('What are you selling?').fill('asdfgh');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(
    page.getByText('No specialist boards matched "asdfgh". Try more specific words (brand, model, type).'),
  ).toBeVisible();
  await expect(page.getByText('Understood as: general item · via built-in catalog')).toBeVisible();
});

test('live: an unknown location shows the location notice; Seattle gets its Craigslist', async ({ page }) => {
  await page.getByLabel('What are you selling?').fill('desk');
  await page.getByLabel('Location (optional)').fill('Nowhereville');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Couldn\'t match "Nowhereville" to a city; local links are generic.')).toBeVisible();

  await page.getByLabel('Location (optional)').fill('Seattle');
  await page.getByRole('button', { name: 'Search' }).click();
  const craigslist = page.getByRole('listitem').filter({ hasText: 'Craigslist' }).first();
  await expect(craigslist.getByRole('link', { name: 'Open board' })).toHaveAttribute(
    'href',
    'https://seattle.craigslist.org/',
  );
  await expect(page.getByText(/Couldn't match/)).toHaveCount(0);
});
