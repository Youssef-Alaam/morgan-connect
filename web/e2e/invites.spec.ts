import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin's invite links and temporary-password accounts, against a scripted API.
const INVITE = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
const EXPIRES = '2026-12-01T10:00:00.000Z';

interface Scripted {
  made: unknown[];
  revoked: string[];
  accounts: unknown[];
}

/** An admin; invites list as the server would (one appears once made, goes once revoked). */
async function script(page: Page): Promise<Scripted> {
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role: 'admin' } } }));
  await page.route('**/api/admin/people', (route) => route.fulfill({ json: { people: [] } }));
  const seen: Scripted = { made: [], revoked: [], accounts: [] };
  await page.route('**/api/admin/invites', (route) =>
    route.fulfill({
      json: {
        invites:
          seen.made.length === 0 || seen.revoked.length > 0
            ? []
            : [{ id: INVITE, monthlyLimitUsd: 5, createdAt: EXPIRES, expiresAt: EXPIRES }],
      },
    }),
  );
  await page.route('**/api/admin/invites/*', async (route) => {
    seen.revoked.push(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/invites', async (route) => {
    seen.made.push(route.request().postDataJSON());
    await route.fulfill({ json: { token: TOKEN, ttlHours: 72 } });
  });
  await page.route('**/api/accounts', async (route) => {
    seen.accounts.push(route.request().postDataJSON());
    const email = (route.request().postDataJSON() as { email: string }).email;
    await (email.startsWith('taken')
      ? route.fulfill({ status: 409, json: { error: 'email_taken' } })
      : route.fulfill({ json: { temporaryPassword: 'a-temporary-password' } }));
  });
  return seen;
}

async function openPeople(page: Page, query: string): Promise<void> {
  await open(page, query);
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByText('No open invites.')).toBeVisible();
}

test('an invite link shows once with a Copy button, and appears in the open list', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seen = await script(page);
  await openPeople(page, queryOf(info.project.metadata));
  await page.getByLabel('Monthly limit (USD)').first().fill('5');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = page.getByRole('textbox', { name: 'Invite link' });
  await expect(link).toHaveValue(new RegExp(`/join#token=${TOKEN}$`));
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(TOKEN);
  expect(seen.made).toEqual([{ monthlyLimitUsd: 5, ttlHours: 72 }]);
  await expect(page.getByRole('table', { name: 'Open invite links' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Invite links' })).toHaveScreenshot(
    'users-invites.png',
  );
  await noViolations(page);
});

test('an open invite is revoked and leaves the list', async ({ page }, info) => {
  const seen = await script(page);
  await openPeople(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await page.getByRole('button', { name: /^Revoke/ }).click();
  const ask = page.getByRole('dialog', { name: 'Revoke this invite?' });
  await expect(ask).toContainText('stops working');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(seen.revoked).toEqual([]);
  await page.getByRole('button', { name: /^Revoke/ }).click();
  await ask.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('No open invites.')).toBeVisible();
  expect(seen.revoked).toEqual([INVITE]);
});

test('an empty or out-of-range number of hours is refused on the page', async ({ page }, info) => {
  const seen = await script(page);
  await openPeople(page, queryOf(info.project.metadata));
  const hours = page.getByLabel('Link lasts (hours)');
  for (const bad of ['', '0', '721', '2.5', 'soon']) {
    await hours.fill(bad);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByText('Enter a whole number of hours, from 1 to 720.')).toBeVisible();
  }
  expect(seen.made).toEqual([]);
  await hours.fill('24');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toBeVisible();
  expect(seen.made).toEqual([{ monthlyLimitUsd: null, ttlHours: 24 }]);
});

test('an account is made with a temporary password shown once', async ({ page }, info) => {
  const seen = await script(page);
  await openPeople(page, queryOf(info.project.metadata));
  await page.getByLabel('Email').fill('new@example.test');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByLabel('Temporary password', { exact: true })).toHaveValue(
    'a-temporary-password',
  );
  expect(seen.accounts).toEqual([{ email: 'new@example.test', monthlyLimitUsd: null }]);
  await page.getByLabel('Email').fill('taken@example.test');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('already has an account');
  await expect(page.getByLabel('Temporary password', { exact: true })).toHaveCount(0);
});
