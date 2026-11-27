import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin's access profiles page against a scripted API.
const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const DAY = '2026-11-01T10:00:00.000Z';

const ask = {
  read: 'auto',
  create: 'ask',
  overwrite: 'ask',
  delete: 'ask',
  send: 'ask',
  execute: 'ask',
};
const presets = [
  {
    preset: 'restricted',
    modes: { ...ask, create: 'off', overwrite: 'off', delete: 'off', send: 'off', execute: 'off' },
  },
  { preset: 'standard', modes: ask },
  { preset: 'trusted', modes: { ...ask, create: 'auto' } },
];
const profile = (preset: string) => ({
  preset,
  shellGate: 'risky_only',
  modes: presets.find((row) => row.preset === preset)?.modes,
});

/** An admin with one member who has a Telegram chat; everyone is Standard. */
async function script(page: Page): Promise<void> {
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role: 'admin' } } }));
  await page.route('**/api/admin/invites', (route) => route.fulfill({ json: { invites: [] } }));
  const person = (id: string, email: string, devices: object[]) => ({
    id,
    email,
    role: id === ADMIN ? 'admin' : 'member',
    status: 'active',
    createdAt: DAY,
    devices,
  });
  await page.route('**/api/admin/people', (route) =>
    route.fulfill({
      json: {
        people: [
          person(ADMIN, 'admin@example.test', []),
          person(MEMBER, 'sara@example.test', [{ id: CHAT, channel: 'telegram', createdAt: DAY }]),
        ],
      },
    }),
  );
  await page.route('**/api/admin/profile-presets', (route) => route.fulfill({ json: { presets } }));
  await page.route('**/api/members/*/profiles', (route) => {
    const own = route.request().url().includes(MEMBER);
    return route.fulfill({
      json: {
        person: profile('standard'),
        devices: own
          ? [{ ...profile('standard'), deviceId: CHAT, channel: 'telegram', own: false }]
          : [],
      },
    });
  });
}

async function openAccess(page: Page, query: string): Promise<void> {
  await open(page, query);
  await page.getByRole('button', { name: 'Access' }).click();
  await page.getByLabel('Person').selectOption({ label: 'sara@example.test' });
  await expect(page.getByRole('cell', { name: 'Their telegram chat' })).toBeVisible();
}

test('the admin sees what applies to a person and each chat, and what a profile allows', async ({
  page,
}, info) => {
  await script(page);
  await openAccess(page, queryOf(info.project.metadata));
  await expect(page.getByRole('row', { name: 'The person Standard' })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Their telegram chat Standard' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'What Standard allows' })).toBeVisible();
  await expect(page.locator('main')).toHaveScreenshot('profiles-list.png');
  await noViolations(page);
});

test('a member is not offered the page', async ({ page }, info) => {
  await script(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role: 'member' } } }));
  let asked = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/me')) asked += 1;
  });
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('button', { name: 'Security' })).toBeVisible();
  // Once to decide the screen, once for the role: only then is the absence meaningful.
  await expect.poll(() => asked).toBe(2);
  await expect(page.getByRole('button', { name: 'Access' })).toHaveCount(0);
});
