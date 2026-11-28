import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The admin's providers and channels page against a scripted API.
const providers = {
  routes: [
    {
      id: 'anthropic',
      provider: 'Anthropic',
      model: 'claude-sonnet-5-5',
      keyLast4: 'wxyz',
      enabled: true,
    },
  ],
  channels: [
    { id: 'telegram', configured: true, lastMessageAt: '2026-11-27T10:05:00.000Z' },
    { id: 'web', configured: true, lastMessageAt: null },
  ],
};

async function script(page: Page, role: string): Promise<{ off: boolean }> {
  const state = { off: false };
  await signedIn(page);
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: { role } } }));
  await page.route('**/api/admin/providers', (route) =>
    route.fulfill(
      role === 'admin'
        ? { json: { ...providers, routes: [{ ...providers.routes[0], enabled: !state.off }] } }
        : { status: 403, json: { error: 'forbidden' } },
    ),
  );
  return state;
}

test('the admin sees the route with its key hint only, and the channels', async ({
  page,
}, info) => {
  await script(page, 'admin');
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Providers' }).click();
  await expect(page.getByRole('heading', { name: 'Providers and channels' })).toBeVisible();
  const routes = page.getByRole('table', { name: 'Model routes set up for this install' });
  await expect(routes).toContainText('Anthropic');
  await expect(routes).toContainText('…wxyz');
  await expect(routes).toContainText('On');
  const channels = page.getByRole('table', { name: 'Channels and the last message each received' });
  await expect(channels.getByRole('row', { name: /Telegram/ })).toContainText('2026-11-27 10:05');
  await expect(channels.getByRole('row', { name: /Web chat/ })).toContainText('None yet');
  await noViolations(page);
  await expect(page.locator('main')).toHaveScreenshot('providers-list.png');
});

test('a member is not offered the page', async ({ page }, info) => {
  await script(page, 'member');
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('button', { name: 'Providers' })).toHaveCount(0);
});

test('switching off asks first; Cancel sends nothing, Switch off sends the change', async ({
  page,
}, info) => {
  const state = await script(page, 'admin');
  const sent: string[] = [];
  await page.route('**/api/admin/providers/anthropic', async (route) => {
    const body = route.request().postData() ?? '';
    sent.push(body);
    state.off = body.includes('false');
    await route.fulfill({ status: 204 });
  });
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Providers' }).click();
  await page.getByRole('button', { name: 'Switch off Anthropic' }).click();
  const ask = page.getByRole('dialog', { name: 'Switch this route off?' });
  await noViolations(page);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(sent).toEqual([]);
  await page.getByRole('button', { name: 'Switch off Anthropic' }).click();
  await ask.getByRole('button', { name: 'Switch off', exact: true }).click();
  await expect(page.getByText('Switched off')).toBeVisible();
  expect(sent).toEqual(['{"enabled":false}']);
  await expect(page.getByRole('button', { name: 'Switch on Anthropic' })).toBeVisible();
  // Switching back on needs no question and sends the change at once.
  await page.getByRole('button', { name: 'Switch on Anthropic' }).click();
  await expect(page.getByRole('button', { name: 'Switch off Anthropic' })).toBeVisible();
  expect(sent).toEqual(['{"enabled":false}', '{"enabled":true}']);
});
