import { expect, test } from '@playwright/test';
import { mockSearch } from './fixtures/mock.ts';

test.describe('accessibility', () => {
  test('AC24: every form control has an accessible name', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await expect(page.getByLabel('What are you selling?')).toBeVisible();
    await expect(page.getByLabel('Location (optional)')).toBeVisible();
    for (const name of ['Ship it', 'Local pickup', 'Both']) {
      await expect(page.getByLabel(name, { exact: true })).toBeVisible();
      await expect(page.getByRole('radio', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'Delivery' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  });

  test('AC24: the whole flow works with the keyboard alone', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const item = page.getByLabel('What are you selling?');
    // Tab from the top of the page to the item field.
    await page.keyboard.press('Tab');
    await expect(item).toBeFocused();
    await page.keyboard.type('mechanical keyboard');

    // Tab past the location field into the delivery radio group (lands on the checked "Both").
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Location (optional)')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Both' })).toBeFocused();

    // Arrow keys move the selection: Both -> Local pickup.
    await page.keyboard.press('ArrowUp');
    const local = page.getByRole('radio', { name: 'Local pickup' });
    await expect(local).toBeFocused();
    await expect(local).toBeChecked();

    // Enter submits the form.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.delivery).toBe('local');

    // Tab keeps going into the results until it reaches a result link.
    let reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.closest('section.results') !== null;
      });
    }
    expect(reached).toBe(true);
    await expect(page.locator('section.results a:focus')).toHaveText('Open board');
  });

  test('focused controls show a visible focus outline', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    await page.keyboard.press('Tab');
    const outline = await page
      .getByLabel('What are you selling?')
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});
