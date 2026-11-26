import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockSearch } from './fixtures/mock.ts';

const KEY = 'sellscout.location.v1';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test.describe('location memory', () => {
  test('AC23: the last location survives a reload', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await expect(page.getByLabel('Location (optional)')).toHaveValue('');
    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByLabel('Location (optional)').fill('Seattle');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Location (optional)')).toHaveValue('Seattle');

    // A later search with a blank location keeps the last non-blank one.
    await page.getByLabel('Location (optional)').fill('');
    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Location (optional)')).toHaveValue('Seattle');
    expect(calls).toHaveLength(2);
  });

  const corruptValues: [string, string][] = [
    ['an object', '{"city":"Seattle"}'],
    ['a 500-char string', JSON.stringify('x'.repeat(500))],
    ['invalid JSON', '{not json'],
    ['a number', '42'],
  ];

  for (const [label, value] of corruptValues) {
    test(`AC23: a corrupt stored value (${label}) is ignored`, async ({ page }) => {
      const errors = collectErrors(page);
      await mockSearch(page, 'mechanical-keyboard');
      await page.addInitScript(
        ([key, v]) => {
          window.localStorage.setItem(key, v);
        },
        [KEY, value],
      );
      await page.goto('/');

      await expect(page.getByRole('heading', { level: 1, name: 'sellscout' })).toBeVisible();
      await expect(page.getByLabel('Location (optional)')).toHaveValue('');
      expect(errors).toEqual([]);
    });
  }

  test('AC23: a throwing localStorage does not crash the page or the search', async ({ page }) => {
    const errors = collectErrors(page);
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError: storage disabled');
        },
      });
    });
    await page.goto('/');

    await expect(page.getByLabel('Location (optional)')).toHaveValue('');
    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByLabel('Location (optional)').fill('Seattle');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
