import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin's people page against a scripted API.
const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const DAY = '2026-11-01T10:00:00.000Z';

const people = () => [
  {
    id: ADMIN,
    role: 'admin',
    email: 'admin@example.test',
    status: 'active',
    createdAt: DAY,
    devices: [],
  },
  {
    id: MEMBER,
    role: 'member',
    email: 'sara@example.test',
    status: 'temporary_password',
    createdAt: DAY,
    devices: [{ id: CHAT, channel: 'telegram', createdAt: DAY }],
  },
];

/** Signed in as `role`; `/admin/people` answers with the list until a chat is unlinked. Returns the unlinked ids. */
async function script(page: Page, role: string): Promise<string[]> {
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role } } }));
  await page.route('**/api/admin/invites', (route) => route.fulfill({ json: { invites: [] } }));
  const unlinked: string[] = [];
  await page.route('**/api/admin/people', (route) =>
    route.fulfill(
      role === 'admin'
        ? {
            json: {
              people: people().map((person) => ({
                ...person,
                devices: person.devices.filter((device) => !unlinked.includes(device.id)),
              })),
            },
          }
        : { status: 403, json: { error: 'forbidden' } },
    ),
  );
  await page.route('**/api/devices/*', async (route) => {
    unlinked.push(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    await route.fulfill({ status: 204 });
  });
  return unlinked;
}

test('the admin sees everyone with role, status and chats, and unlinks a chat', async ({
  page,
}, info) => {
  const unlinked = await script(page, 'admin');
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'sara@example.test', exact: true })).toBeVisible();
  await expect(page.getByText('Temporary password', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Everyone in your workspace' })).toHaveScreenshot(
    'users-list.png',
  );
  await noViolations(page);
  await page.getByRole('button', { name: 'Unlink telegram chat of sara@example.test' }).click();
  const ask = page.getByRole('dialog', { name: 'Unlink this chat?' });
  await expect(ask).toContainText('The telegram chat of sara@example.test stops reaching Morgan');
  expect(unlinked).toEqual([]);
  await ask.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('button', { name: /^Unlink/ })).toHaveCount(0);
  expect(unlinked).toEqual([CHAT]);
});

test('cancelling or pressing Escape leaves the chat linked and sends nothing', async ({
  page,
}, info) => {
  const unlinked = await script(page, 'admin');
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'People' }).click();
  const unlink = page.getByRole('button', { name: 'Unlink telegram chat of sara@example.test' });
  const ask = page.getByRole('dialog', { name: 'Unlink this chat?' });
  await unlink.click();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await unlink.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(unlink).toBeVisible();
  expect(unlinked).toEqual([]);
});

test('a member is not offered the page', async ({ page }, info) => {
  await script(page, 'member');
  let asked = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/me')) asked += 1;
  });
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('button', { name: 'Security' })).toBeVisible();
  // Once to decide the screen, once for the role: only then is the absence meaningful.
  await expect.poll(() => asked).toBe(2);
  await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0);
});

test('a refused list shows the refusal and no table', async ({ page }, info) => {
  await script(page, 'member');
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role: 'admin' } } }));
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('alert')).toContainText('Only the admin');
  await expect(page.getByRole('table')).toHaveCount(0);
});
