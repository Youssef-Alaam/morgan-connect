import { expect, test } from '@playwright/test';
import { noViolations, queryOf, signedIn } from './support.ts';

// The invite link, against a scripted API.
const LOGIN = { email: 'sara@example.test', password: 'a long password of mine' };

test('an invite link joins with the notice accepted, and lands in the chat', async ({
  page,
}, info) => {
  await signedIn(page);
  let joined = false;
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  const posted: unknown[] = [];
  await page.route('**/api/me', (route) =>
    route.fulfill(joined ? { json: {} } : { status: 401, json: { error: 'unauthorized' } }),
  );
  await page.route('**/api/join', async (route) => {
    posted.push(route.request().postDataJSON());
    joined = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/join${queryOf(info.project.metadata)}#token=tok-join-1`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Join Morgan' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('main')).toHaveScreenshot('join.png');
  await noViolations(page);
  await page.getByLabel('Email').fill(LOGIN.email);
  await page.getByLabel('New password').fill(LOGIN.password);
  const button = page.getByRole('button', { name: 'Join', exact: true });
  await expect(button).toBeDisabled();
  await page.getByRole('checkbox').check();
  await button.click();
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
  expect(posted).toEqual([{ token: 'tok-join-1', ...LOGIN, acceptedNotice: true }]);
  expect(urls.filter((url) => url.includes('tok-join-1'))).toEqual([]);
});

test('a link that is no longer valid says so', async ({ page }, info) => {
  await signedIn(page);
  await page.route('**/api/join', (route) =>
    route.fulfill({ status: 410, json: { error: 'link_invalid' } }),
  );
  await page.goto(`/join${queryOf(info.project.metadata)}#token=old`);
  await page.getByLabel('Email').fill(LOGIN.email);
  await page.getByLabel('New password').fill(LOGIN.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
});

test('a link without its token cannot be used', async ({ page }, info) => {
  await signedIn(page);
  await page.goto(`/join${queryOf(info.project.metadata)}`);
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled();
});
