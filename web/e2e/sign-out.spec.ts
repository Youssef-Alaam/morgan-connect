import { expect, test, type Page } from '@playwright/test';

// The Sign out button against a scripted API: the first /me says signed in, the next ones signed out.
async function signedInOnce(page: Page, query: string): Promise<void> {
  let asked = 0;
  await page.route('**/api/me', (route) =>
    asked++ === 0
      ? route.fulfill({ status: 200, json: {} })
      : route.fulfill({ status: 401, json: { error: 'unauthorized' } }),
  );
  await page.route('**/api/chat/events', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' }),
  );
  await page.goto(`/${query}`);
}

const queryOf = (metadata: unknown): string =>
  typeof metadata === 'object' && metadata !== null && 'query' in metadata
    ? String(metadata.query)
    : '';

test('Sign out ends the session and shows sign-in', async ({ page }, info) => {
  let called = false;
  await page.route('**/api/sign-out', async (route) => {
    called = route.request().method() === 'POST';
    await route.fulfill({ status: 204 });
  });
  await signedInOnce(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(called).toBe(true);
});

test('Sign out is disabled while it is on its way', async ({ page }, info) => {
  await page.route('**/api/sign-out', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 204 });
  });
  await signedInOnce(page, queryOf(info.project.metadata));
  const button = page.getByRole('button', { name: 'Sign out' });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('Sign out that cannot reach the server says so and stays signed in', async ({
  page,
}, info) => {
  await page.route('**/api/sign-out', (route) => route.abort());
  await signedInOnce(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be reached');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
});
