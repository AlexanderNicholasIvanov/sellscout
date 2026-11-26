import { expect, test } from '@playwright/test';
import type { StatusResponse } from '../server/types.ts';

test('the page shows the sellscout heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'sellscout' })).toBeVisible();
});

test('GET /api/status returns the package version', async ({ request }) => {
  const res = await request.get('/api/status');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as StatusResponse;
  expect(body).toEqual({ version: '0.1.0', redditAuth: false, fixtures: true, ebay: false });
});
