import { expect, test } from '@playwright/test';
import { consoleAudit } from '../../test/e2e/audit.ts';

// Same pair as test/e2e/stack.ts, which creates the admin account.
const EMAIL = 'smoke@example.test';
const PASSWORD = 'smoke test password 1';

test('the admin runs the People page for real, and each action is in the audit log', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('cell', { name: EMAIL, exact: true })).toBeVisible();

  await page.getByLabel('Email').fill('new@example.test');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByLabel('Temporary password', { exact: true })).not.toHaveValue('');
  await expect(page.getByRole('cell', { name: 'new@example.test', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toHaveValue(/\/join#token=/);
  await page.getByRole('button', { name: /^Revoke/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('No open invites.')).toBeVisible();

  await page.getByRole('button', { name: /^Unlink telegram chat/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Unlink/ })).toHaveCount(0);

  expect(await consoleAudit()).toEqual([
    { tool: 'admin.account.create', outcome: 'ok' },
    { tool: 'admin.invite.create', outcome: 'ok' },
    { tool: 'admin.invite.revoke', outcome: 'ok' },
    { tool: 'device.unlink', outcome: 'ok' },
  ]);
});
