import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin's budgets page against a scripted API.
const budgets = {
  month: '2026-11',
  defaults: { limitUsd: '3', topupUsd: '5' },
  people: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      role: 'admin',
      email: 'admin@example.test',
      topupUsd: '0',
      spentUsd: '12.25000000',
      calls: 40,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      role: 'member',
      email: 'sara@example.test',
      limitUsd: '10.00000000',
      taskCap: 4,
      topupStepUsd: '2.50000000',
      topupUsd: '5.00000000',
      spentUsd: '15.00000000',
      calls: 12,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      role: 'member',
      topupUsd: '0',
      spentUsd: '0.50000000',
      calls: 1,
    },
  ],
};

async function script(page: Page, role: string): Promise<void> {
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role } } }));
  await page.route('**/api/admin/budgets', (route) =>
    route.fulfill(
      role === 'admin' ? { json: budgets } : { status: 403, json: { error: 'forbidden' } },
    ),
  );
}

test('the admin sees spend against each limit, with top-ups, task cap and step', async ({
  page,
}, info) => {
  await script(page, 'admin');
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Budgets' }).click();
  await expect(page.getByRole('heading', { name: 'Budgets and usage' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Spend and limits for 2026-11' });
  const sara = table.getByRole('row', { name: /sara@example.test/ });
  // Her own $10 plus the $5 approved this month; $15 spent has reached it.
  await expect(sara).toContainText('$15.00 (at limit)');
  await expect(sara).toContainText('$15.00$5.00');
  await expect(sara).toContainText('$2.50');
  // No limit of her own: the install's $3 applies, and the default cap of 2 and step of $5.
  const chatOnly = table.getByRole('row', { name: /Chat only/ });
  await expect(chatOnly).toContainText('$3.00');
  await expect(chatOnly).toContainText('$5.00');
  // The admin is never held back, whatever they spend.
  await expect(table.getByRole('row', { name: /admin@example.test/ })).toContainText('No limit');
  await noViolations(page);
  await expect(table).toHaveScreenshot('budgets-list.png');
});

test('a member is not offered the page', async ({ page }, info) => {
  await script(page, 'member');
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('button', { name: 'Budgets' })).toHaveCount(0);
});

const SARA = '22222222-2222-4222-8222-222222222222';

test('the admin edits one person: only what changed is sent, and a bad box sends nothing', async ({
  page,
}, info) => {
  await script(page, 'admin');
  const sent: string[] = [];
  await page.route('**/api/admin/people/*/*', async (route) => {
    const url = new URL(route.request().url());
    sent.push(`${url.pathname.split('/').slice(-2).join('/')} ${route.request().postData() ?? ''}`);
    await route.fulfill({ status: 204 });
  });
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Budgets' }).click();
  await page.getByRole('button', { name: 'Edit the limits of sara@example.test' }).click();
  const dialog = page.getByRole('dialog', { name: 'Limits of sara@example.test' });
  await expect(dialog.getByLabel('Monthly limit (USD)')).toHaveValue('10');
  await expect(dialog.getByLabel('Tasks at once')).toHaveValue('4');
  await expect(dialog.getByLabel('Top-up step (USD)')).toHaveValue('2.5');
  await noViolations(page);
  await expect(dialog).toHaveScreenshot('budgets-edit.png');
  await dialog.getByLabel('Tasks at once').fill('0');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a whole number from 1 to 1000.')).toBeVisible();
  expect(sent).toEqual([]);
  await dialog.getByLabel('Tasks at once').fill('');
  await dialog.getByLabel('Monthly limit (USD)').fill('12.5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([`${SARA}/budget {"limitUsd":"12.5"}`, `${SARA}/task-cap {"cap":null}`]);
});
