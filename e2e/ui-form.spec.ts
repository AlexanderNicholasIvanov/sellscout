import { expect, test } from '@playwright/test';
import { loadFixture, mockSearch } from './fixtures/mock.ts';

test.describe('search form', () => {
  test('AC17: an empty item shows an inline error, focuses the field and sends nothing', async ({ page }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const item = page.getByLabel('What are you selling?');
    await page.getByLabel('Location (optional)').focus();
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const error = page.getByText("Describe what you're selling");
    await expect(error).toBeVisible();
    await expect(item).toBeFocused();
    await expect(item).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await item.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText("Describe what you're selling");

    // Whitespace only counts as empty too.
    await item.fill('   ');
    await item.press('Enter');
    await expect(error).toBeVisible();

    await page.waitForTimeout(300);
    expect(calls).toHaveLength(0);
  });

  test('AC17: Enter in the empty item field announces the error as an alert and sends nothing', async ({
    page,
  }) => {
    const { calls } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const item = page.getByLabel('What are you selling?');
    await item.focus();
    await item.press('Enter');

    const alert = page.getByRole('alert').filter({ hasText: "Describe what you're selling" });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute('id', 'item-error');
    await expect(item).toBeFocused();
    await expect(item).toHaveAttribute('aria-describedby', 'item-error');
    await expect(item).toHaveAttribute('aria-invalid', 'true');

    // A second Enter re-mounts the alert so assistive tech announces it again.
    const first = await alert.elementHandle();
    await item.press('Enter');
    await expect(alert).toBeVisible();
    expect(await first?.evaluate((el) => el.isConnected)).toBe(false);

    await page.waitForTimeout(300);
    expect(calls).toHaveLength(0);
  });

  test('the form fields have their documented attributes', async ({ page }) => {
    await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const item = page.getByLabel('What are you selling?');
    await expect(item).toHaveAttribute('maxlength', '200');
    await expect(item).toHaveAttribute('placeholder', 'e.g. Sony A7 III body, low shutter count');
    await expect(item).toHaveAttribute('required', '');

    const location = page.getByLabel('Location (optional)');
    await expect(location).toHaveAttribute('maxlength', '100');
    await expect(location).toHaveAccessibleDescription('City or ZIP (US)');

    await expect(page.getByRole('group', { name: 'Delivery' })).toBeVisible();
    await expect(page.getByLabel('Both')).toBeChecked();
  });

  test('AC19: while searching the button is disabled and reads "Searching..."', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockSearch(page, async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: loadFixture('mechanical-keyboard') });
    });
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const busy = page.getByRole('button', { name: 'Searching...' });
    await expect(busy).toBeDisabled();
    await expect(page.locator('section.results')).toHaveAttribute('aria-busy', 'true');
    await page.waitForTimeout(1000);
    await expect(busy).toBeDisabled();

    release();
    const button = page.getByRole('button', { name: 'Search', exact: true });
    await expect(button).toBeEnabled();
    await expect(page.locator('section.results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('heading', { name: 'Where to post it' })).toBeVisible();
  });

  test('AC20: a 500 shows the server error and re-enables the button', async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal error' } }),
    );
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('alert')).toHaveText('Search failed: Internal error');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  });

  test('AC20: a non-JSON error falls back to the HTTP status text', async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'down' }),
    );
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('alert')).toHaveText(/^Search failed: \S/);
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  });

  test('AC20: an aborted request shows "Search failed: ..." and re-enables the button', async ({ page }) => {
    await mockSearch(page, (route) => route.abort('failed'));
    await page.goto('/');

    await page.getByLabel('What are you selling?').fill('mechanical keyboard');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('alert')).toHaveText(/^Search failed: \S/);
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
  });

  test('AC28: requests to any other host are aborted', async ({ page }) => {
    const { blocked } = await mockSearch(page, 'mechanical-keyboard');
    await page.goto('/');

    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/');
        return 'reached';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
    expect(blocked).toContain('https://example.com/');
  });
});
