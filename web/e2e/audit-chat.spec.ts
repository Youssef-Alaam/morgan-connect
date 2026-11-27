import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin opens a member's chat from the audit log, against a scripted API.
const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-01T10:00:00.000Z';

const person = (id: string, email: string, role: string) => ({
  id,
  email,
  role,
  status: 'active',
  createdAt: DAY,
  devices: [],
});

/** Returns the reasons the admin gave; the answer to each open is a two-line chat. */
async function script(page: Page, status = 200): Promise<string[]> {
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role: 'admin' } } }));
  await page.route('**/api/admin/people', (route) =>
    route.fulfill({
      json: {
        people: [
          person(ADMIN, 'admin@example.test', 'admin'),
          person(MEMBER, 'sara@example.test', 'member'),
        ],
      },
    }),
  );
  await page.route('**/api/admin/audit?*', (route) =>
    route.fulfill({ json: { rows: [], more: false, actions: [] } }),
  );
  const reasons: string[] = [];
  await page.route(`**/api/admin/people/${MEMBER}/chat`, async (route) => {
    reasons.push((route.request().postDataJSON() as { reason: string }).reason);
    await route.fulfill(
      status === 200
        ? {
            json: {
              messages: [
                { id: '1', role: 'user', text: 'Remind me about the dentist', createdAt: DAY },
                { id: '2', role: 'assistant', text: 'Done, on Tuesday.', createdAt: DAY },
              ],
            },
          }
        : { status, json: { error: 'not_found' } },
    );
  });
  return reasons;
}

async function openDialog(page: Page, query: string): Promise<void> {
  await open(page, query);
  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('button', { name: /^Read/ })).toHaveCount(0);
  await page.getByLabel('Person').selectOption({ label: 'sara@example.test' });
  await page.getByRole('button', { name: "Read sara@example.test's chat" }).click();
}

test('the admin gives a reason first, then reads the chat, and the log is reloaded', async ({
  page,
}, info) => {
  const reasons = await script(page);
  await openDialog(page, queryOf(info.project.metadata));
  const dialog = page.getByRole('dialog', { name: 'Chat of sara@example.test' });
  await expect(dialog.getByRole('button', { name: 'Open chat' })).toBeDisabled();
  expect(reasons).toEqual([]);
  await dialog.getByLabel('Why are you reading it?').fill('support ticket 12');
  let reloaded = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/audit?')) reloaded += 1;
  });
  await dialog.getByRole('button', { name: 'Open chat' }).click();
  await expect(dialog.getByText('Remind me about the dentist')).toBeVisible();
  expect(reasons).toEqual(['support ticket 12']);
  await expect.poll(() => reloaded).toBe(1);
  await expect(dialog).toHaveScreenshot('audit-chat.png');
  await noViolations(page);
});

test('a refused read shows the refusal and no messages', async ({ page }, info) => {
  await script(page, 404);
  await openDialog(page, queryOf(info.project.metadata));
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why are you reading it?').fill('curious');
  await dialog.getByRole('button', { name: 'Open chat' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already gone');
  await expect(dialog.getByRole('log')).toHaveCount(0);
});
