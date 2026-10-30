import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { configured: true, user: null } }),
  );
});
test('dark is default even with a light OS preference; switching survives reload and navigation', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('signed-out visitors cannot choose a resume or create a profile', async ({ page }) => {
  let profileRequests = 0;
  await page.route('**/api/v1/profiles/**', (route) => {
    profileRequests++;
    return route.fulfill({ json: null });
  });
  await page.goto('/resume');
  await expect(page.getByRole('heading', { name: 'Sign in to build your profile.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
    'href',
    '/sign-in',
  );
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Skill', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyze resume' })).toHaveCount(0);
  expect(profileRequests).toBe(0);
});
test('Google sign-in redirects, displays cancellation and permits retry', async ({ page }) => {
  let attempted = 0;
  await page.route('**/api/v1/auth/google', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-gitorbit']).toBe('1');
    attempted++;
    await route.fulfill({ json: { url: '/sign-in?error=sign_in_failed' } });
  });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect(attempted).toBe(1);
  await expect(page.getByRole('link', { name: 'Continue as a guest' })).toHaveAttribute(
    'href',
    '/explore',
  );
});
test('a disabled provider reports a useful error without navigating away', async ({ page }) => {
  await page.route('**/api/v1/auth/google', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'GOOGLE_NOT_CONFIGURED',
          message: 'Google sign-in is not available yet. You can continue as a guest.',
        },
      },
    }),
  );
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('continue as a guest');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});
test('signed-in identity and sign-out work without exposing credentials', async ({ page }) => {
  let loggedIn = true;
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: {
        configured: true,
        user: loggedIn ? { id: 'user-id', name: 'Taylor', email: 'taylor@example.com' } : null,
      },
    }),
  );
  await page.route('**/api/v1/auth/sign-out', (route) => {
    loggedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Taylor/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
});
test('sign-in is accessible in both themes and fits a mobile viewport', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  for (const theme of ['dark', 'light']) {
    if (theme === 'light')
      await page.getByRole('button', { name: 'Switch to light theme' }).click();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `tmp/screenshots/sign-in-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/screenshots/sign-in-mobile.png', fullPage: true });
});
