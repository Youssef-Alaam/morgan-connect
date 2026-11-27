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
    if (path === '/chat/events' && answers[path] === undefined) {
      await route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
      return;
    }
    const given = answers[path];
    const next = Array.isArray(given) ? (given.length > 1 ? given.shift() : given[0]) : given;
    bodies.push(`${path} ${route.request().postData() ?? ''}`.trim());
    const { status, body } = next ?? { status: 404, body: { error: 'unknown' } };
    await route.fulfill({ status, json: body });
  });
  return bodies;
}

const out: Answer = { status: 401, body: { error: 'unauthorized' } };
const mustChange: Answer = { status: 403, body: { error: 'password_change_required' } };
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
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
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
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
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
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
  expect(seen).toContain(
    `/sign-in/second-factor ${JSON.stringify({ challenge: 'chal-2', code: 'abcd-efgh-ijkl' })}`,
  );
});

test('a temporary password ends on the change-password screen', async ({ page }, info) => {
  const seen = await serve(page, {
    '/me': [out, mustChange, { status: 200, body: {} }],
    '/sign-in': ok,
    '/change-password': ok,
  });
  await open(page, queryOf(info.project.metadata));
  await page.getByLabel('Email').fill('narimane@example.test');
  await page.getByLabel('Password', { exact: true }).fill('temporary-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await expect(page.locator('main')).toHaveScreenshot('change-password.png');
  await noViolations(page);
  await page.getByLabel('Current password').fill('temporary-pass');
  await page.getByLabel('New password').fill('my own long password');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
  expect(seen).toContain(
    `/change-password ${JSON.stringify({ current: 'temporary-pass', password: 'my own long password', acceptedNotice: true })}`,
  );
});

test('a browser that is already on the temporary password lands on change-password', async ({
  page,
}, info) => {
  await serve(page, { '/me': mustChange });
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
});

const sse = (id: number, kind: string, data: object): string =>
  `id: ${String(id)}\nevent: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;

test('a member sends a message and the reply streams in', async ({ page }, info) => {
  await serve(page, { '/me': { status: 200, body: {} } });
  let sent: { messageId: string; text: string } | undefined;
  await page.route('**/api/chat', async (route) => {
    sent = route.request().postDataJSON() as { messageId: string; text: string };
    await route.fulfill({ status: 202, json: { ok: true, messageId: sent.messageId } });
  });
  // The stream is quiet until a message was posted, then it replays the ack and the answer.
  await page.route('**/api/chat/events', async (route) => {
    const body =
      sent === undefined
        ? ''
        : sse(1, 'ack', { ref: sent.messageId }) +
          sse(2, 'message', { text: 'Done. I will message you at six.' });
    await route.fulfill({ contentType: 'text/event-stream', body: `retry: 200\n\n${body}` });
  });
  await open(page, queryOf(info.project.metadata));
  const box = page.getByRole('textbox', { name: 'Message Morgan' });
  await box.fill('Remind me to call Narimane at six.');
  await box.press('Enter');
  const log = page.getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.bubble-user')).toContainText('Remind me to call Narimane');
  await expect(log.locator('.bubble-morgan')).toContainText('Done. I will message you at six.');
  expect(sent?.text).toBe('Remind me to call Narimane at six.');
  await expect(log).toHaveScreenshot('chat-screen.png');
  await noViolations(page);
});

test('a reload shows both sides of the conversation, replayed from the stream', async ({
  page,
}, info) => {
  await serve(page, { '/me': { status: 200, body: {} } });
  await page.route('**/api/chat/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body:
        'retry: 60000\n\n' +
        sse(1, 'ack', { ref: 'u1', text: 'Remind me to call Narimane at six.' }) +
        sse(2, 'message', { text: 'Done. I will message you at six.' }),
    }),
  );
  await open(page, queryOf(info.project.metadata));
  const log = page.getByRole('log', { name: 'Conversation' });
  await expect(log.locator('.bubble-user')).toContainText('Remind me to call Narimane');
  await expect(log.locator('.bubble-morgan')).toContainText('Done. I will message you at six.');
});

test('a message the server refuses is marked as not sent', async ({ page }, info) => {
  await serve(page, { '/me': { status: 200, body: {} } });
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 400, json: { error: 'invalid_request' } }),
  );
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('textbox', { name: 'Message Morgan' }).fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.bubble-user')).toContainText('not sent');
});

test('a session that ended while chatting goes back to sign-in', async ({ page }, info) => {
  await serve(page, { '/me': [{ status: 200, body: {} }, out] });
  await page.route('**/api/chat/events', (route) => route.fulfill({ status: 401, json: out.body }));
  await open(page, queryOf(info.project.metadata));
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

async function fillFirstPassword(page: Page): Promise<void> {
  await page.getByLabel('Email').fill('narimane@example.test');
  await page.getByLabel('New password').fill('my own long password');
  await page.getByRole('button', { name: 'Set password' }).click();
}

test('the first-password link sets the password and signs in, token never in a URL', async ({
  page,
}, info) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  const seen = await serve(page, { '/set-password': ok, '/sign-in': ok, '/me': ok });
  await page.goto(`/set-password${queryOf(info.project.metadata)}#token=tok-123`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('main')).toHaveScreenshot('set-password.png');
  await noViolations(page);
  await fillFirstPassword(page);
  await expect(page.getByRole('textbox', { name: 'Message Morgan' })).toBeVisible();
  const login = { email: 'narimane@example.test', password: 'my own long password' };
  expect(seen).toContain(`/set-password ${JSON.stringify({ token: 'tok-123', ...login })}`);
  expect(seen).toContain(`/sign-in ${JSON.stringify(login)}`);
  expect(urls.filter((url) => url.includes('tok-123'))).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a first password on a temporary-password account ends on change-password', async ({
  page,
}, info) => {
  await serve(page, { '/set-password': ok, '/sign-in': ok, '/me': mustChange });
  await page.goto(`/set-password${queryOf(info.project.metadata)}#token=tok-123`);
  await fillFirstPassword(page);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
});

test('a used or missing link says so and does not sign in', async ({ page }, info) => {
  await serve(page, { '/set-password': { status: 410, body: { error: 'link_invalid' } } });
  await page.goto(`/set-password${queryOf(info.project.metadata)}#token=old`);
  await fillFirstPassword(page);
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
  await page.goto(`/set-password${queryOf(info.project.metadata)}`);
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
  await expect(page.getByRole('button', { name: 'Set password' })).toBeDisabled();
});

test('a failed sign-in after the password is set hands over to sign-in without the token', async ({
  page,
}, info) => {
  const seen = await serve(page, {
    '/set-password': ok,
    '/sign-in': { status: 500, body: { error: 'server_error' } },
  });
  await page.goto(`/set-password${queryOf(info.project.metadata)}#token=tok-123`);
  await fillFirstPassword(page);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(seen.filter((line) => line.startsWith('/set-password'))).toHaveLength(1);
});
