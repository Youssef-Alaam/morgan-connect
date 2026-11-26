import { Writable } from 'node:stream';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createInvite } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

const KEY = Buffer.alloc(32, 9);
const START = Date.UTC(2026, 10, 26, 12, 0, 10);
const PASSWORD = 'a brand new password';
let ctx: Isolation;
let clock = START;
let logs = '';
let counter = 0;
let app: ReturnType<typeof createApp>;

/** A fresh server (so no failure counts carry over) on the same database and clock. */
function serve(twoFactorKey: Buffer | null = KEY): ReturnType<typeof createApp> {
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  return createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('trace', sink),
    auth: { db: ctx.app, now: () => clock, twoFactorKey: twoFactorKey ?? undefined },
  });
}

beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const post = (path: string, body: unknown, cookie = '') =>
  app.request(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
const cookieOf = (response: Response) =>
  /morgan_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';
const codeFor = (secret: string, ms = clock): string =>
  new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: ms });
const wrongFor = (secret: string): string => (codeFor(secret) === '000000' ? '000001' : '000000');
const signIn = (email: string, password = PASSWORD) => post('sign-in', { email, password });
const body = async (response: Response) => (await response.json()) as Record<string, string>;

/** A member with an authenticator switched on: their email, secret, backup codes and session. */
async function enrolled() {
  app = serve();
  counter += 1;
  const token = `tok-${String(counter)}`;
  const email = `m${String(counter)}@example.test`;
  const tokenHash = sha256(token);
  await createInvite(ctx.app, ctx.alice, { tokenHash, ttlSeconds: 600, monthlyLimitUsd: null });
  const joined = await post('join', { token, email, password: PASSWORD, acceptedNotice: true });
  const cookie = cookieOf(joined);
  const secret = (await body(await post('two-factor/setup', {}, cookie)))['secret'] ?? '';
  clock += 30_000;
  const confirmed = await post('two-factor/confirm', { code: codeFor(secret) }, cookie);
  const backupCodes = ((await confirmed.json()) as { backupCodes: string[] }).backupCodes;
  clock += 30_000;
  return { email, secret, backupCodes, cookie };
}

/** Password first, then the second step with this code. */
async function twoStep(email: string, code: string): Promise<Response> {
  const first = await body(await signIn(email));
  return post('sign-in/second-factor', { challenge: first['challenge'], code });
}

it('is two steps: the password alone opens nothing, the code completes it', async () => {
  const { email, secret } = await enrolled();
  const first = await signIn(email);
  expect([first.status, first.headers.get('set-cookie')]).toEqual([200, null]);
  expect(Object.keys(await body(first)).sort()).toEqual(['challenge', 'step']);
  const done = await twoStep(email, codeFor(secret));
  expect(done.status).toBe(200);
  const me = await app.request('/api/me', { headers: { cookie: cookieOf(done) } });
  expect(await me.json()).toMatchObject({ user: { email } });
});

it('answers a wrong password and an unknown email like a right one, and no code opens them', async () => {
  const { email, secret } = await enrolled();
  const right = await body(await signIn(email));
  const wrong = await signIn(email, 'not the password');
  const stranger = await signIn('nobody@example.test');
  for (const answer of [wrong, stranger]) {
    expect([answer.status, answer.headers.get('set-cookie')]).toEqual([200, null]);
    expect(Object.keys(await body(answer.clone())).sort()).toEqual(Object.keys(right).sort());
  }
  // Even the person's own valid code is refused behind a wrong password, and is not used up.
  const behind = await body(wrong);
  const refused = await post('sign-in/second-factor', {
    challenge: behind['challenge'],
    code: codeFor(secret),
  });
  expect([refused.status, await body(refused)]).toEqual([401, { error: 'invalid_credentials' }]);
  expect((await twoStep(email, codeFor(secret))).status).toBe(200);
});

it('refuses a code used twice in its window, and accepts the next one', async () => {
  const { email, secret } = await enrolled();
  const code = codeFor(secret);
  expect((await twoStep(email, code)).status).toBe(200);
  expect((await twoStep(email, code)).status).toBe(401);
  clock += 30_000;
  expect((await twoStep(email, codeFor(secret))).status).toBe(200);
});

it('takes a backup code once, in any case and with or without the dash', async () => {
  const { email, backupCodes } = await enrolled();
  const [first = '', second = ''] = backupCodes;
  expect((await twoStep(email, first.toUpperCase().replace('-', ' '))).status).toBe(200);
  expect((await twoStep(email, first)).status).toBe(401);
  expect((await twoStep(email, second)).status).toBe(200);
});

it('rate-limits wrong codes, then refuses even the right one', async () => {
  const { email, secret } = await enrolled();
  for (let i = 0; i < 5; i++) expect((await twoStep(email, wrongFor(secret))).status).toBe(401);
  expect((await twoStep(email, codeFor(secret))).status).toBe(429);
});

it('refuses an old, altered or foreign challenge, and a chat code', async () => {
  const { email, secret } = await enrolled();
  const { challenge = '' } = await body(await signIn(email));
  const code = codeFor(secret);
  const attempt = async (given: string) =>
    (await post('sign-in/second-factor', { challenge: given, code })).status;
  expect(await attempt(`${challenge.slice(0, -2)}AA`)).toBe(401);
  expect(await attempt('not-a-challenge')).toBe(401);
  const stored = await ctx.owner
    .selectFrom('totp_factors')
    .select('secret_sealed')
    .where('secret_sealed', '<>', 'sealed')
    .executeTakeFirstOrThrow();
  expect(await attempt(stored.secret_sealed)).toBe(401);
  expect((await twoStep(email, 'a-chat-setup-code')).status).toBe(401);
  clock += 6 * 60_000;
  expect(await attempt(challenge)).toBe(401);
});

it('keeps no secret in the log, and without a key a wrong password is a plain 401', async () => {
  const { email, secret, backupCodes } = await enrolled();
  const { challenge = '' } = await body(await signIn(email));
  expect(logs).not.toContain(secret);
  expect(logs).not.toContain(challenge);
  for (const code of backupCodes) expect(logs).not.toContain(code);
  app = serve(null);
  expect((await signIn(email, 'not the password')).status).toBe(401);
  // A missing key never switches a second factor off: the right password is refused too.
  const open = await signIn(email);
  expect([open.status, open.headers.get('set-cookie')]).toEqual([500, null]);
  expect((await post('sign-in/second-factor', { challenge, code: '123456' })).status).toBe(501);
});
