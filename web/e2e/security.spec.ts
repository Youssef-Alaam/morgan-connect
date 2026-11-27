import { expect, test, type Page } from '@playwright/test';
import { monoReady, noViolations, open, queryOf, signedIn } from './support.ts';

// The account's security page against a scripted API: each test says what the server answers.
const SECRET = 'JBSWY3DPEHPK3PXP';
const CODES = ['aaaa-1111-bbbb', 'cccc-2222-dddd', 'eeee-3333-ffff'];

interface Status {
  available: boolean;
  enabled: boolean;
}

/** `/two-factor` answers each status in turn (the last one repeats); returns what was posted. */
async function script(page: Page, statuses: Status[]): Promise<string[]> {
  await signedIn(page);
  await page.route('**/api/passkeys', (route) => route.fulfill({ json: [] }));
  const posted: string[] = [];
  await page.route('**/api/two-factor', (route) =>
    route.fulfill({ json: statuses.length > 1 ? statuses.shift() : statuses[0] }),
  );
  await page.route('**/api/two-factor/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    posted.push(`${path.slice('/api/two-factor/'.length)} ${route.request().postData() ?? ''}`);
    if (path.endsWith('/setup')) {
      await route.fulfill({
        json: { secret: SECRET, uri: `otpauth://totp/Morgan?secret=${SECRET}` },
      });
    } else if (path.endsWith('/confirm')) {
      await route.fulfill({ json: { backupCodes: CODES } });
    } else await route.fulfill({ json: { ok: true } });
  });
  return posted;
}

async function openSecurity(page: Page, info: { project: { metadata: unknown } }): Promise<void> {
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
}

test('the authenticator is turned on with its first code, and the backup codes show once', async ({
  page,
}, info) => {
  const off = { available: true, enabled: false };
  const posted = await script(page, [off, { available: true, enabled: true }]);
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(SECRET)).toBeVisible();
  await monoReady(page);
  await expect(page.locator('main')).toHaveScreenshot('security-setup.png');
  await noViolations(page);
  await page.getByLabel('First code').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  const codes = page.getByLabel('Your backup codes');
  await expect(codes).toContainText(CODES.join('\n'));
  await monoReady(page);
  await expect(page.locator('main')).toHaveScreenshot('security-backup-codes.png');
  await noViolations(page);
  await page.getByRole('button', { name: 'I saved them' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await expect(codes).toHaveCount(0);
  await expect(page.locator('main')).toHaveScreenshot('security-on.png');
  expect(posted).toEqual(['setup {}', `confirm ${JSON.stringify({ code: '123456' })}`]);
});

test('a reload right after confirming does not bring the backup codes back', async ({
  page,
}, info) => {
  await script(page, [
    { available: true, enabled: false },
    { available: true, enabled: true },
  ]);
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByLabel('First code').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByLabel('Your backup codes')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your backup codes')).toHaveCount(0);
  await expect(page.getByText(CODES[0] ?? '')).toHaveCount(0);
});

test('a status that cannot be read shows only the error', async ({ page }, info) => {
  await script(page, [{ available: true, enabled: false }]);
  await page.route('**/api/two-factor', (route) => route.abort());
  await openSecurity(page, info);
  await expect(page.getByRole('alert')).toContainText('cannot be reached');
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
});

test('a wrong first code is refused in words and the setup stays', async ({ page }, info) => {
  await script(page, [{ available: true, enabled: false }]);
  await page.route('**/api/two-factor/confirm', (route) =>
    route.fulfill({ status: 401, json: { error: 'invalid_code' } }),
  );
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByLabel('First code').fill('000000');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('alert')).toContainText('That code is not right.');
  await expect(page.getByText(SECRET)).toBeVisible();
});

test('turning it off needs a code, and Cancel leaves it on', async ({ page }, info) => {
  const on = { available: true, enabled: true };
  const posted = await script(page, [on, { available: true, enabled: false }]);
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByLabel('Authenticator or backup code').fill('aaaa-1111-bbbb');
  await page.getByRole('button', { name: 'Turn off' }).last().click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  expect(posted).toEqual([`disable ${JSON.stringify({ code: 'aaaa-1111-bbbb' })}`]);
});

test('an install without a key says so, and Back returns to the chat', async ({ page }, info) => {
  await script(page, [{ available: false, enabled: false }]);
  await openSecurity(page, info);
  await expect(page.getByText('not available on this install')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
});
