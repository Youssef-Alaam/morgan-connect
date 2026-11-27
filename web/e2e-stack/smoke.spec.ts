import { expect, test } from '@playwright/test';

// Same pair as test/e2e/stack.ts, which creates the account.
const EMAIL = 'smoke@example.test';
const PASSWORD = 'smoke test password 1';

test('sign in, send a message, and the reply streams in', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const box = page.getByRole('textbox', { name: 'Message Morgan' });
  await box.fill('ping');
  await box.press('Enter');
  const log = page.getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.bubble-user')).toContainText('ping');
  // No engine is set, so Morgan echoes the message back.
  await expect(log.locator('.bubble-morgan')).toContainText('ping');
});
