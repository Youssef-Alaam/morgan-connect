import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The passkeys on the security page, against a scripted API.
const LAPTOP = { id: 'p1', name: 'Laptop', createdAt: '2026-11-01T09:00:00Z', lastUsedAt: null };
const PHONE = {
  id: 'p2',
  name: 'Phone',
  createdAt: '2026-11-10T09:00:00Z',
  lastUsedAt: '2026-11-25T18:30:00Z',
};

/** `/passkeys` answers each list in turn (the last repeats); `/two-factor` says it is off. */
async function script(page: Page, lists: object[][]): Promise<void> {
  await signedIn(page);
  await page.route('**/api/two-factor', (route) =>
    route.fulfill({ json: { available: true, enabled: false } }),
  );
  await page.route('**/api/passkeys', (route) =>
    route.fulfill({ json: lists.length > 1 ? lists.shift() : lists[0] }),
  );
}

async function openSecurity(page: Page, info: { project: { metadata: unknown } }): Promise<void> {
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
}

test('the passkeys are listed with when they were added and last used', async ({ page }, info) => {
  await script(page, [[LAPTOP, PHONE]]);
  await openSecurity(page, info);
  const table = page.getByRole('table', { name: 'Your passkeys' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table).toContainText('Phone');
  await expect(table).toContainText('2026-11-25');
  await expect(page.locator('main')).toHaveScreenshot('security-passkeys.png');
  await noViolations(page);
});

test('a passkey is removed and the list refreshes; none left says so', async ({ page }, info) => {
  await script(page, [[LAPTOP], []]);
  let removed = '';
  await page.route('**/api/passkeys/p1', async (route) => {
    removed = route.request().method();
    await route.fulfill({ status: 204 });
  });
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Remove Laptop' }).click();
  await expect(page.getByText('No passkeys yet.')).toBeVisible();
  expect(removed).toBe('DELETE');
});

test('the last way to sign in cannot be removed, in words', async ({ page }, info) => {
  await script(page, [[LAPTOP]]);
  await page.route('**/api/passkeys/p1', (route) =>
    route.fulfill({ status: 409, json: { error: 'last_sign_in_method' } }),
  );
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Remove Laptop' }).click();
  await expect(page.getByRole('alert')).toContainText('only way to sign in');
  await expect(page.getByRole('table', { name: 'Your passkeys' })).toContainText('Laptop');
});

test('a list that cannot be read shows the error and no longer says loading', async ({
  page,
}, info) => {
  await script(page, [[]]);
  await page.route('**/api/passkeys', (route) => route.abort());
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be reached');
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await expect(page.getByText('Loading.')).toHaveCount(0);
});
