// AC7: "New" badges against the real fixture-mode server (SELLSCOUT_FIXTURES=1, set in
// playwright.config.ts). Posts are added through POST /api/__fixtures; only the external-request
// guard is installed. Each test uses its own term and never resets the fixture set, so it is safe
// next to the other specs that share the server.
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { blockExternalRequests } from './fixtures/mock.ts';

async function addPost(request: APIRequestContext, post: { id: string; title: string; subreddit: string }) {
  const res = await request.post('/api/__fixtures', { data: { post } });
  expect(res.status(), `POST /api/__fixtures ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { ok: boolean; posts: number };
  expect(body.ok).toBe(true);
  expect(typeof body.posts).toBe('number');
}

const buyers = (page: Page) => page.locator('section.results .buyers');
const postById = (page: Page, id: string) =>
  buyers(page)
    .locator('ol.posts > li')
    .filter({ has: page.locator(`a[href*="/comments/${id}/"]`) });

test.describe('live saved searches @needs-fixtures-api', () => {
  test('AC7: Run marks only the post added since the last run as "New"', async ({ page, request }, testInfo) => {
    const suffix = `${Date.now().toString(36)}${testInfo.workerIndex}`;
    const term = `zorblax${suffix}`;
    const item = `${term} widget`;
    // Ids must match ^[a-z0-9_]{1,20}$.
    const idA = `a_${suffix}`.slice(0, 20);
    const idB = `b_${suffix}`.slice(0, 20);
    const titleA = `WTB ${term} widget`;
    const titleB = `WTB ${term} widget, second`;

    await blockExternalRequests(page);
    await page.goto('/');

    // 1. Add post A, search for it, save.
    await addPost(request, { id: idA, title: titleA, subreddit: 'mechmarket' });
    await page.getByLabel('What are you selling?').fill(item);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'People looking for it' })).toBeVisible();
    await expect(postById(page, idA)).toHaveCount(1);
    await expect(buyers(page).locator('.badge-new')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(page.locator('.save-row [role="status"]')).toHaveText('Saved');

    // 2. Add post B, then Run: B is new, A is not.
    await addPost(request, { id: idB, title: titleB, subreddit: 'mechmarket' });
    const run = page.getByRole('button', { name: `Run "${item}"` });
    await run.click();
    await expect(buyers(page).locator('.new-count')).toHaveText('1 new since your last run');
    await expect(postById(page, idB)).toHaveCount(1);
    await expect(postById(page, idB).locator('.badge-new')).toHaveText('New');
    await expect(postById(page, idA)).toHaveCount(1);
    await expect(postById(page, idA).locator('.badge-new')).toHaveCount(0);
    await expect(buyers(page).locator('.badge-new')).toHaveCount(1);
    await expect(run).toBeEnabled();

    // 3. Run again: nothing new.
    await run.click();
    await expect(buyers(page).locator('.new-count')).toHaveText('Nothing new since your last run');
    await expect(buyers(page).locator('.badge-new')).toHaveCount(0);
    await expect(run).toBeEnabled();

    // 4. A manual search with the same values: no badges and no line.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
    await expect(postById(page, idA)).toHaveCount(1);
    await expect(postById(page, idB)).toHaveCount(1);
    await expect(buyers(page).locator('.badge-new')).toHaveCount(0);
    await expect(buyers(page).locator('.new-count')).toHaveCount(0);
  });
});
