import { expect, test, type Browser } from '@playwright/test';
import { consoleAudit } from '../../test/e2e/audit.ts';

// Same pair as test/e2e/stack.ts, which creates the admin account.
const EMAIL = 'smoke@example.test';
const PASSWORD = 'smoke test password 1';
const JOINER = { email: 'joined@example.test', password: 'a long password of mine' };

/** A new browser (no cookies) opens an invite link and fills in the join form. */
async function openJoin(browser: Browser, link: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel('Email').fill(JOINER.email);
  await page.getByLabel('New password').fill(JOINER.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  return page;
}

test('the admin runs the People page for real, and each action is in the audit log', async ({
  page,
  browser,
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

  // A revoked invite no longer joins anyone.
  const link = page.getByRole('textbox', { name: 'Invite link' });
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(link).toHaveValue(/\/join#token=/);
  const revoked = await link.inputValue();
  await page.getByRole('button', { name: /^Revoke/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('No open invites.')).toBeVisible();
  const late = await openJoin(browser, revoked);
  await expect(late.getByRole('alert')).toContainText('expired or was already used');

  // A live one joins a new person, who lands in the chat.
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(link).not.toHaveValue(revoked);
  const joined = await openJoin(browser, await link.inputValue());
  await expect(joined.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();

  await page.getByRole('button', { name: /^Unlink telegram chat/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Unlink/ })).toHaveCount(0);

  // Reading a member's chat from the audit log writes its own row before the chat is shown.
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.getByRole('button', { name: 'Audit' }).click();
  await page.getByLabel('Person').selectOption({ label: JOINER.email });
  await page.getByRole('button', { name: `Read ${JOINER.email}'s chat` }).click();
  await page.getByLabel('Why are you reading it?').fill('stack check');
  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByRole('log', { name: `Chat of ${JOINER.email}` })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('row', { name: /admin\.read stack check/ })).toBeVisible();

  expect((await consoleAudit()).map((row) => `${row.tool} ${row.outcome}`)).toEqual([
    'admin.account.create ok',
    'admin.invite.create ok',
    'admin.invite.revoke ok',
    'admin.invite.create ok',
    'device.unlink ok',
    'admin.read.chat ok',
  ]);
});
