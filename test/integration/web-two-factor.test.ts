import { Writable } from 'node:stream';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createInvite } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { hashBackupCode } from '../../src/identity/second-factor.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

const KEY = Buffer.alloc(32, 9);
const CLOCK = Date.UTC(2026, 10, 26, 12, 0, 10);
let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let bare: ReturnType<typeof createApp>;
let logs = '';

beforeAll(async () => {
  ctx = await startIsolation();
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const logger = createLogger('trace', sink);
  const auth = { db: ctx.app, now: () => CLOCK };
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger,
    auth: { ...auth, twoFactorKey: KEY },
  });
  bare = createApp({ dbVersion: () => Promise.resolve('17'), logger, auth });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const post = (path: string, body: unknown, cookie: string, server = app) =>
  server.request(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
const cookieOf = (response: Response) =>
  /morgan_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';
const codeFor = (secret: string, ms = CLOCK): string =>
  new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: ms });

/** A new member, signed in, through an invite. */
async function member(name: string): Promise<string> {
  const token = `tok-${name}`;
  await createInvite(ctx.app, ctx.alice, {
    tokenHash: sha256(token),
    ttlSeconds: 600,
    monthlyLimitUsd: null,
  });
  const body = { token, email: `${name}@example.test`, password: 'a brand new password' };
  const joined = await post('join', { ...body, acceptedNotice: true }, '');
  return cookieOf(joined);
}

it('enrols an authenticator: a secret and QR address, then the first code switches it on', async () => {
  const cookie = await member('one');
  const setup = await post('two-factor/setup', {}, cookie);
  const { secret, uri } = (await setup.json()) as { secret: string; uri: string };
  expect(uri).toContain(`secret=${secret}`);
  expect(uri).toContain('one%40example.test');
  const wrong = codeFor(secret) === '000000' ? '000001' : '000000';
  expect((await post('two-factor/confirm', { code: wrong }, cookie)).status).toBe(401);
  const confirmed = await post('two-factor/confirm', { code: codeFor(secret) }, cookie);
  expect(confirmed.status).toBe(200);
  const { backupCodes } = (await confirmed.json()) as { backupCodes: string[] };
  expect(new Set(backupCodes).size).toBe(10);
  // Stored sealed and hashed, never plain; the code's step is recorded so it cannot be used again.
  const factor = await ctx.owner
    .selectFrom('totp_factors')
    .selectAll()
    .where('secret_sealed', '<>', 'sealed')
    .execute();
  expect(JSON.stringify(factor)).not.toContain(secret);
  expect(factor[0]?.confirmed_at).toBeInstanceOf(Date);
  expect(factor[0]?.last_step).toBe(String(Math.floor(CLOCK / 30_000)));
  const stored = await ctx.owner
    .selectFrom('backup_codes')
    .select('code_hash')
    .where('user_id', '=', factor[0]?.user_id ?? '')
    .execute();
  expect(stored.map((row) => row.code_hash).sort()).toEqual(
    backupCodes.map((code) => hashBackupCode(KEY, code)).sort(),
  );
  expect(logs).not.toContain(secret);
  for (const code of backupCodes) expect(logs).not.toContain(code);
  expect((await post('two-factor/setup', {}, cookie)).status).toBe(409);
  expect((await post('two-factor/confirm', { code: codeFor(secret) }, cookie)).status).toBe(409);
});

it('restarting setup replaces the unconfirmed secret; confirm without setup is refused', async () => {
  const cookie = await member('two');
  expect((await post('two-factor/confirm', { code: '123456' }, cookie)).status).toBe(409);
  const first = (await (await post('two-factor/setup', {}, cookie)).json()) as { secret: string };
  const second = (await (await post('two-factor/setup', {}, cookie)).json()) as { secret: string };
  expect(second.secret).not.toBe(first.secret);
  const stale = codeFor(first.secret) === codeFor(second.secret) ? '' : codeFor(first.secret);
  if (stale !== '')
    expect((await post('two-factor/confirm', { code: stale }, cookie)).status).toBe(401);
});

it('rate-limits wrong codes and then refuses even the right one', async () => {
  const cookie = await member('three');
  const { secret } = (await (await post('two-factor/setup', {}, cookie)).json()) as {
    secret: string;
  };
  const wrong = codeFor(secret) === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) {
    expect((await post('two-factor/confirm', { code: wrong }, cookie)).status).toBe(401);
  }
  expect((await post('two-factor/confirm', { code: codeFor(secret) }, cookie)).status).toBe(429);
});

it('needs a session and a key: no session is 401, no key is 501, a bad body is 400', async () => {
  expect((await post('two-factor/setup', {}, '')).status).toBe(401);
  const cookie = await member('four');
  expect((await post('two-factor/setup', {}, cookie, bare)).status).toBe(501);
  expect((await post('two-factor/confirm', { code: '1' }, cookie, bare)).status).toBe(501);
  expect((await post('two-factor/confirm', { nope: 1 }, cookie)).status).toBe(400);
});

it('a chat setup code is not a second factor', async () => {
  const cookie = await member('five');
  await post('two-factor/setup', {}, cookie);
  expect((await post('two-factor/confirm', { code: 'a-chat-setup-code' }, cookie)).status).toBe(
    401,
  );
});

it('turning it on ends the other sessions but keeps this one', async () => {
  const cookie = await member('six');
  const other = cookieOf(
    await post('sign-in', { email: 'six@example.test', password: 'a brand new password' }, ''),
  );
  const { secret } = (await (await post('two-factor/setup', {}, cookie)).json()) as {
    secret: string;
  };
  expect((await post('two-factor/confirm', { code: codeFor(secret) }, cookie)).status).toBe(200);
  expect((await app.request('/api/me', { headers: { cookie: other } })).status).toBe(401);
  expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(200);
});

it('says whether an authenticator is on and whether this install can have one', async () => {
  const status = async (cookie: string, server = app) =>
    (await server.request('/api/two-factor', { headers: { cookie } })).json();
  expect((await app.request('/api/two-factor')).status).toBe(401);
  const cookie = await member('status');
  expect(await status(cookie)).toEqual({ available: true, enabled: false });
  const setup = await post('two-factor/setup', {}, cookie);
  const { secret } = (await setup.json()) as { secret: string };
  // A started setup is not switched on until its first code is given.
  expect(await status(cookie)).toEqual({ available: true, enabled: false });
  const confirmed = await post('two-factor/confirm', { code: codeFor(secret) }, cookie);
  expect(confirmed.status).toBe(200);
  expect(await status(cookie)).toEqual({ available: true, enabled: true });
  expect(await status(cookie, bare)).toEqual({ available: false, enabled: true });
});
