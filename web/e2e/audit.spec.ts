import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin's audit log page against a scripted API.
const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-01T10:00:00.000Z';

const row = (id: number, over: object) => ({
  id: String(id),
  at: `2026-11-01T10:0${String(id % 10)}:00.000Z`,
  personId: MEMBER,
  person: 'sara@example.test',
  subjectId: null,
  subject: null,
  tool: 'files.read',
  actionType: 'read',
  decision: 'auto',
  outcome: 'ok',
  reason: null,
  ...over,
});
const newest = [
  row(9, { actionType: 'delete', decision: 'ask', outcome: 'denied' }),
  row(8, {
    personId: ADMIN,
    person: 'admin@example.test',
    subjectId: MEMBER,
    subject: 'sara@example.test',
    actionType: 'admin.read',
    reason: 'support ticket 12',
  }),
  row(7, { actionType: 'send', decision: 'ask', outcome: 'refused' }),
];

/** An admin; the log answers with the newest rows, then one older row, and records each query. */
async function script(page: Page): Promise<URLSearchParams[]> {
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role: 'admin' } } }));
  await page.route('**/api/admin/invites', (route) => route.fulfill({ json: { invites: [] } }));
  const person = (id: string, email: string, role: string) => ({
    id,
    email,
    role,
    status: 'active',
    createdAt: DAY,
    devices: [],
  });
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
  const asked: URLSearchParams[] = [];
  await page.route('**/api/admin/audit?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    asked.push(query);
    const rows = query.has('before') ? [row(6, { actionType: 'create' })] : newest;
    const refused = query.get('outcome') === 'refused';
    return route.fulfill({
      json: {
        rows: refused ? [newest[2]] : rows,
        more: !query.has('before') && !refused,
        actions: ['admin.read', 'create', 'delete', 'read', 'send'],
      },
    });
  });
  return asked;
}

test('the admin sees the log newest first, filters it and pages back', async ({ page }, info) => {
  const asked = await script(page);
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('row', { name: /admin\.read support ticket 12/ })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(4);
  await expect(page.locator('main')).toHaveScreenshot('audit-list.png');
  await noViolations(page);

  await page.getByRole('button', { name: 'Show older rows' }).click();
  await expect(page.getByRole('row')).toHaveCount(5);
  expect(asked.at(-1)?.get('before')).toBe('7');
  await expect(page.getByRole('button', { name: 'Show older rows' })).toHaveCount(0);

  await page.getByLabel('Outcome').selectOption('refused');
  await expect(page.getByRole('row')).toHaveCount(2);
  expect(asked.at(-1)?.get('outcome')).toBe('refused');
  expect(asked.at(-1)?.has('before')).toBe(false);
  await page.getByLabel('To (UTC)').fill('2026-11-02');
  await expect.poll(() => asked.at(-1)?.get('to')).toBe('2026-11-03T00:00:00.000Z');
});

test('a refused list shows the refusal and no table', async ({ page }, info) => {
  await script(page);
  await page.route('**/api/admin/audit?*', (route) =>
    route.fulfill({ status: 403, json: { error: 'forbidden' } }),
  );
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('alert')).toContainText('Only the admin');
  await expect(page.getByRole('table')).toHaveCount(0);
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
  await expect.poll(() => asked).toBe(2);
  await expect(page.getByRole('button', { name: 'Audit' })).toHaveCount(0);
});
