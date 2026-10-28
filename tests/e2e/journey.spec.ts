import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { opportunity, profile } from '../fixtures';
const savedProfile = {
  ...profile,
  id: '33333333-3333-4333-8333-333333333333',
  experienceInferred: false,
  experienceSummary: [],
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
test.beforeEach(async ({ page }) => {
  let activeProfile = false;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/config'))
      return route.fulfill({
        json: { aiConfigured: true, aiProvider: 'Test AI provider', profileTtlHours: 24 },
      });
    if (path.endsWith('/opportunities/facets'))
      return route.fulfill({
        json: {
          languages: ['TypeScript', 'Python'],
          skills: ['React'],
          programs: [],
          repositories: [opportunity.repository],
          total: 1,
          lastSyncedAt: opportunity.lastSyncedAt,
        },
      });
    if (path.includes('/profiles')) {
      if (request.method() === 'POST' || request.method() === 'PATCH') {
        activeProfile = true;
        return route.fulfill({
          json: { ...savedProfile, ...request.postDataJSON() },
          status: request.method() === 'POST' ? 201 : 200,
        });
      }
      if (request.method() === 'DELETE') {
        activeProfile = false;
        return route.fulfill({ status: 204 });
      }
      return activeProfile
        ? route.fulfill({ json: savedProfile })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'PROFILE_REQUIRED', message: 'Create your profile.' } },
          });
    }
    if (path.includes('/resumes/analyze')) {
      activeProfile = true;
      return route.fulfill({
        status: 201,
        json: {
          ...savedProfile,
          experienceInferred: true,
          skills: profile.skills.map((s) => ({ ...s, source: 'extracted' })),
        },
      });
    }
    if (path.endsWith('/recommendations') && !activeProfile)
      return route.fulfill({
        status: 401,
        json: { error: { code: 'PROFILE_REQUIRED', message: 'Create your profile.' } },
      });
    if (path.endsWith('/opportunities') || path.endsWith('/recommendations')) {
      const filtered =
        url.searchParams.get('language') === 'Python' ||
        url.searchParams.get('q') === 'nonexistent';
      return route.fulfill({
        json: {
          items: filtered
            ? []
            : [
                {
                  ...opportunity,
                  ...(path.endsWith('/recommendations')
                    ? {
                        match: {
                          score: 100,
                          matchingSkills: ['React', 'TypeScript'],
                          explanation:
                            'React and TypeScript are mentioned in this issue and your profile.',
                          skillScore: 100,
                          difficultyScore: 100,
                          activityScore: 100,
                          interestScore: 100,
                          uncertainPrerequisites: [],
                          activitySummary: 'Recent repository activity',
                        },
                      }
                    : {}),
                },
              ],
          total: filtered ? 0 : 1,
          page: 1,
          pages: 1,
          limit: 12,
        },
      });
    }
    if (path.includes('/opportunities/')) return route.fulfill({ json: opportunity });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found' } },
    });
  });
});
test('landing, discovery, filters, reset, details and source navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your skills/ })).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/landing-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Explore opportunities', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: opportunity.title })).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/explore-desktop.png', fullPage: true });
  await page.getByLabel('Programming language').selectOption('Python');
  await expect(
    page.getByRole('heading', { name: 'A different search could be the start.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('heading', { name: opportunity.title }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'About this issue' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open issue on GitHub' })).toHaveAttribute(
    'href',
    opportunity.sourceUrl,
  );
  await expect(page.getByText('Repository created', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/detail-desktop.png', fullPage: true });
});
test('manual profile creation, skill editing, recommendations and deletion', async ({ page }) => {
  await page.goto('/recommendations');
  await page.getByRole('link', { name: 'Build my profile' }).click();
  await page.getByRole('textbox', { name: 'Skill', exact: true }).fill('React');
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('frameworks');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove React' })).toBeVisible();
  await page.getByRole('textbox', { name: /^Interests/ }).fill('accessibility');
  await page.screenshot({ path: 'tmp/screenshots/profile-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Find my opportunities' }).click();
  await expect(page.getByText('100% match')).toBeVisible();
  await page.getByRole('link', { name: 'Your profile', exact: true }).click();
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click();
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click();
  await expect(page.getByText('Your active profile has been deleted.')).toBeVisible();
});
test('resume upload requires consent, then exposes editable extracted skills', async ({ page }) => {
  await page.goto('/resume');
  await page.getByLabel('Choose PDF resume').setInputFiles({
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 test fixture'),
  });
  await expect(page.getByRole('button', { name: 'Analyze resume' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I agree to send/ }).check();
  await page.getByRole('button', { name: 'Analyze resume' }).click();
  await expect(page.getByRole('button', { name: 'Remove TypeScript' })).toBeVisible();
  await expect(page.getByText('From resume', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove TypeScript' }).click();
  await expect(page.getByRole('button', { name: 'Remove TypeScript' })).toHaveCount(0);
});
test('API outages show a retryable error, never a fabricated catalog', async ({ page }) => {
  await page.route('**/api/v1/opportunities?*', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { message: 'Database temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' },
      },
    }),
  );
  await page.goto('/explore');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Database temporarily unavailable',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('heading', { name: opportunity.title })).toHaveCount(0);
});
test('public and workspace screens satisfy WCAG AA automated checks', async ({ page }) => {
  for (const path of ['/', '/explore', '/resume', `/opportunities/${opportunity.id}`]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    if (path === '/explore')
      await expect(page.getByRole('heading', { name: opportunity.title })).toBeVisible();
    if (path === '/resume')
      await expect(page.getByRole('heading', { name: 'Start with your resume' })).toBeVisible();
    if (path.startsWith('/opportunities/'))
      await expect(page.getByRole('heading', { name: 'About this issue' })).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect
      .soft(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
        path,
      )
      .toEqual([]);
  }
});
test('mobile routes fit the viewport and filters work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/explore', '/resume', `/opportunities/${opportunity.id}`]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `tmp/screenshots/mobile-${path === '/' ? 'landing' : path.split('/')[1]}.png`,
      fullPage: true,
    });
  }
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Programming language').selectOption('Python');
  await expect(
    page.getByRole('heading', { name: 'A different search could be the start.' }),
  ).toBeVisible();
});
