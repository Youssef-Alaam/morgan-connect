import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// The sign-in screens against a scripted API (page.route): each test says what the server answers.
const queryOf = (metadata: unknown): string =>
  typeof metadata === 'object' && metadata !== null && 'query' in metadata
    ? String(metadata.query)
    : '';

interface Answer {
  status: number;
  body: unknown;
}

async function serve(page: Page, answers: Record<string, Answer | Answer[]>): Promise<string[]> {
  const bodies: string[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.slice('/api'.length);
    const given = answers[path];
    const next = Array.isArray(given) ? (given.length > 1 ? given.shift() : given[0]) : given;
    bodies.push(`${path} ${route.request().postData() ?? ''}`.trim());
    const { status, body } = next ?? { status: 404, body: { error: 'unknown' } };
    await route.fulfill({ status, json: body });
  });
  return bodies;
}

const out: Answer = { status: 401, body: { error: 'unauthorized' } };
const ok: Answer = { status: 200, body: { ok: true } };

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.evaluate(() => document.fonts.ready);
}

async function noViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
}

test('sign-in with a password goes to the signed-in page', async ({ page }, info) => {
  const seen = await serve(page, {
    '/me': [out, { status: 200, body: {} }],
    '/sign-in': ok,
  });
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('main')).toHaveScreenshot('sign-in.png');
  await noViolations(page);
  await page.getByLabel('Email').fill('narimane@example.test');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  expect(seen).toContain(
    `/sign-in ${JSON.stringify({ email: 'narimane@example.test', password: 'correct horse battery' })}`,
  );
});

test('a wrong password shows the refusal and stays on the screen', async ({ page }, info) => {
  await serve(page, {
    '/me': out,
    '/sign-in': { status: 401, body: { error: 'invalid_credentials' } },
  });
  await open(page, queryOf(info.project.metadata));
  await page.getByLabel('Email').fill('narimane@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('not right');
  await expect(page.locator('main')).toHaveScreenshot('sign-in-error.png');
  await noViolations(page);
});

test('a server error is not a sign-out: it offers a retry', async ({ page }, info) => {
  await serve(page, {
    '/me': [{ status: 500, body: { error: 'server_error' } }, out],
  });
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByText('Morgan cannot be reached.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('an authenticator code is asked for after the password', async ({ page }, info) => {
  const seen = await serve(page, {
    '/me': [out, { status: 200, body: {} }],
    '/sign-in': { status: 200, body: { step: 'second_factor', challenge: 'chal-1' } },
    '/sign-in/second-factor': ok,
  });
  await open(page, queryOf(info.project.metadata));
  await page.getByLabel('Email').fill('narimane@example.test');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await expect(page.locator('main')).toHaveScreenshot('second-factor.png');
  await noViolations(page);
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  expect(seen).toContain(
    `/sign-in/second-factor ${JSON.stringify({ challenge: 'chal-1', code: '123456' })}`,
  );
});

test('a backup code can be used instead, and the code step has a way back', async ({
  page,
}, info) => {
  const seen = await serve(page, {
    '/me': [out, { status: 200, body: {} }],
    '/sign-in': { status: 200, body: { step: 'second_factor', challenge: 'chal-2' } },
    '/sign-in/second-factor': ok,
  });
  await open(page, queryOf(info.project.metadata));
  await page.getByLabel('Email').fill('narimane@example.test');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Back to password' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await expect(page.locator('main')).toHaveScreenshot('backup-code.png');
  await noViolations(page);
  await page.getByLabel('Backup code').fill('abcd-efgh-ijkl');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  expect(seen).toContain(
    `/sign-in/second-factor ${JSON.stringify({ challenge: 'chal-2', code: 'abcd-efgh-ijkl' })}`,
  );
});
