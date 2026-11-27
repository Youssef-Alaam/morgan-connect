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

interface Scripted {
  saved: unknown[];
}

/** An admin with one member who has a Telegram chat; the member's profile is Standard until a save. */
async function script(page: Page, previewAnswer: unknown): Promise<Scripted> {
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
  const seen: Scripted = { saved: [] };
  await page.route('**/api/members/*/profiles', (route) => {
    const own = route.request().url().includes(MEMBER);
    const now = seen.saved.length > 0 ? 'trusted' : 'standard';
    return route.fulfill({
      json: {
        person: profile(own ? now : 'standard'),
        devices: own ? [{ ...profile(now), deviceId: CHAT, channel: 'telegram', own: false }] : [],
      },
    });
  });
  await page.route('**/api/admin/profile-preview*', (route) =>
    route.fulfill({ json: previewAnswer }),
  );
  await page.route('**/api/members/*/profile', async (route) => {
    seen.saved.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  return seen;
}

const loosening = {
  previous: 'standard',
  preset: 'trusted',
  warnings: [
    { actionType: 'create', from: 'ask', to: 'auto', warning: 'profile.risk.create.auto' },
  ],
  refused: false,
};

async function openAccess(page: Page, query: string): Promise<void> {
  await open(page, query);
  await page.getByRole('button', { name: 'Access' }).click();
  await page.getByLabel('Person').selectOption({ label: 'sara@example.test' });
  await expect(page.getByLabel('Profile for sara@example.test')).toHaveValue('standard');
}

test('the admin sees what applies to a person and each chat, and what a profile allows', async ({
  page,
}, info) => {
  await script(page, loosening);
  await openAccess(page, queryOf(info.project.metadata));
  await expect(page.getByLabel('Profile for telegram chat of sara@example.test')).toHaveValue(
    'standard',
  );
  await expect(
    page.getByRole('cell', { name: 'Their telegram chat, same as the person' }),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: 'What Standard allows' })).toBeVisible();
  // Read is Auto in every profile, so it is not flagged; only a setting looser than Restricted is.
  await expect(page.getByRole('row', { name: 'Read Auto' }).locator('.badge-danger')).toHaveCount(
    0,
  );
  await expect(page.locator('main')).toHaveScreenshot('profiles-list.png');
  await noViolations(page);
});

test('a loosening shows its risk before anything is saved, and saves only on Save', async ({
  page,
}, info) => {
  const seen = await script(page, loosening);
  await openAccess(page, queryOf(info.project.metadata));
  await page.getByLabel('Profile for sara@example.test').selectOption('trusted');
  const review = page.getByRole('region', { name: 'Change for sara@example.test' });
  await expect(review).toContainText('Auto lets Morgan create notes and files without asking');
  await expect(page.getByRole('table', { name: 'What Trusted allows' })).toBeVisible();
  // The dropdown shows the choice waiting to be saved, not the old value.
  await expect(page.getByLabel('Profile for sara@example.test')).toHaveValue('trusted');
  expect(seen.saved).toEqual([]);
  await expect(page.locator('main')).toHaveScreenshot('profiles-risk.png');
  await noViolations(page);
  await review.getByRole('button', { name: 'Save' }).dblclick(); // a second click sends nothing
  await expect(page.getByLabel('Profile for sara@example.test')).toHaveValue('trusted');
  expect(seen.saved).toEqual([{ preset: 'trusted' }]);
});

test('cancelling saves nothing, and a chat is saved with its id', async ({ page }, info) => {
  const seen = await script(page, loosening);
  await openAccess(page, queryOf(info.project.metadata));
  await page.getByLabel('Profile for sara@example.test').selectOption('trusted');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('region')).toHaveCount(0);
  expect(seen.saved).toEqual([]);
  await page.getByLabel('Profile for telegram chat of sara@example.test').selectOption('trusted');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => seen.saved).toEqual([{ preset: 'trusted', deviceId: CHAT }]);
});

test('choosing the profile that already applies drops the pending change', async ({
  page,
}, info) => {
  const seen = await script(page, loosening);
  await openAccess(page, queryOf(info.project.metadata));
  const select = page.getByLabel('Profile for sara@example.test');
  await select.selectOption('trusted');
  await expect(page.getByRole('region')).toHaveCount(1);
  await select.selectOption('standard');
  await expect(page.getByRole('region')).toHaveCount(0);
  expect(seen.saved).toEqual([]);
});

test('a choice the server would refuse cannot be saved', async ({ page }, info) => {
  const seen = await script(page, { ...loosening, warnings: [], refused: true });
  await openAccess(page, queryOf(info.project.metadata));
  await page.getByLabel('Profile for sara@example.test').selectOption('restricted');
  await expect(page.getByRole('alert')).toContainText('cannot make yourself Restricted');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(seen.saved).toEqual([]);
});

test('a failed presets load shows the problem', async ({ page }, info) => {
  await script(page, loosening);
  await page.route('**/api/admin/profile-presets', (route) =>
    route.fulfill({ status: 500, json: { error: 'server_error' } }),
  );
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Access' }).click();
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
});

test('a member is not offered the page', async ({ page }, info) => {
  await script(page, loosening);
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
