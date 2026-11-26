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
    await expect(page.getByRole('combobox', { name: 'Buyer posts from the last' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
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
    const item = page.getByLabel('What are you selling?');
    await expect(item).toBeFocused();
    // The app's own :focus-visible style (styles.css), not Chromium's default `outline: auto`.
    const style = await item.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset };
    });
    expect(style).toEqual({ style: 'solid', width: '3px', offset: '2px' });

    // The same style applies to the window select, the submit button and to result links.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const select = page.getByLabel('Buyer posts from the last');
    await expect(select).toBeFocused();
    expect(await select.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Tab');
    const button = page.getByRole('button', { name: 'Search', exact: true });
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  });
});

test.describe('accessibility: people looking for it', () => {
  test('AC25: keyboard only - choose the window, search, reach a post link and a look-yourself link', async ({
    page,
  }) => {
    const { calls } = await mockSearch(page, 'buyers-ok');
    await page.goto('/');

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
    await page.keyboard.type('mechanical keyboard');

    // Item -> location -> delivery radio -> window select.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Both' })).toBeFocused();
    await page.keyboard.press('Tab');
    const select = page.getByRole('combobox', { name: 'Buyer posts from the last' });
    await expect(select).toBeFocused();
    await expect(select).toHaveValue('30');

    // Arrow keys change a closed select: 30 days -> 7 days.
    await page.keyboard.press('ArrowUp');
    await expect(select).toHaveValue('7');

    // Tab to the submit button; Enter searches.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'People looking for it' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.window).toBe(7);

    const focusedIn = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.closest(sel) !== null;
      }, selector);

    // Tab on through the venues until a post link has focus...
    let reachedPost = false;
    for (let i = 0; i < 30 && !reachedPost; i++) {
      await page.keyboard.press('Tab');
      reachedPost = await focusedIn('ol.posts');
    }
    expect(reachedPost).toBe(true);
    await expect(page.locator('ol.posts a:focus')).toHaveText('WTB a 65% mechanical keyboard');

    // ...and then a look-yourself link.
    let reachedLook = false;
    for (let i = 0; i < 10 && !reachedLook; i++) {
      await page.keyboard.press('Tab');
      reachedLook = await focusedIn('.look-links');
    }
    expect(reachedLook).toBe(true);
    await expect(page.locator('.look-links a:focus')).toHaveText('Search Reddit for buyers');
  });
});

test.describe('accessibility: saved searches', () => {
  test('AC9: keyboard only - save, run a saved search, delete it and accept the confirm', async ({ page }) => {
    const { calls } = await mockSearch(page, 'buyers-ok');
    await page.goto('/');

    const focused = (name: string) =>
      page.evaluate(
        (n) => document.activeElement instanceof HTMLButtonElement && document.activeElement.getAttribute('aria-label') === n,
        name,
      );
    async function tabTo(check: () => Promise<boolean>, max = 30) {
      for (let i = 0; i < max; i++) {
        if (await check()) return true;
        await page.keyboard.press('Tab');
      }
      return check();
    }

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
    await page.keyboard.type('mechanical keyboard');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'People looking for it' })).toBeVisible();
    expect(calls).toHaveLength(1);

    // Tab on to "Save search" and press Enter.
    const save = page.getByRole('button', { name: 'Save search' });
    expect(await tabTo(() => save.evaluate((el) => el === document.activeElement))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('.save-row [role="status"]')).toHaveText('Saved');

    // Tab (wrapping round from the results back to the top) to Run and press Enter.
    const run = page.getByRole('button', { name: 'Run "mechanical keyboard"' });
    expect(await tabTo(() => focused('Run "mechanical keyboard"'), 60)).toBe(true);
    await expect(run).toBeFocused();
    expect(await run.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page.locator('.new-count')).toHaveText('Nothing new since your last run');
    expect(calls).toHaveLength(2);
    await expect(run).toBeEnabled();

    // Tab to Delete, press Enter and accept the confirm.
    const del = page.getByRole('button', { name: 'Delete "mechanical keyboard"' });
    expect(await tabTo(() => focused('Delete "mechanical keyboard"'), 60)).toBe(true);
    await expect(del).toBeFocused();
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Saved searches' })).toHaveCount(0);
    expect(message).toBe('Delete the saved search "mechanical keyboard"?');
    // Focus goes back to the form, not lost on the page.
    await expect(page.getByLabel('What are you selling?')).toBeFocused();
  });
});
