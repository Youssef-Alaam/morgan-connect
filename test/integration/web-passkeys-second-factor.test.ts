import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createInvite } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';
import { newAuthenticator } from '../helpers/passkey-authenticator.js';

const SITE = { origin: 'https://app.example.test', rpId: 'example.test' };
const KEY = Buffer.alloc(32, 9);
let clock = Date.UTC(2026, 10, 26, 12, 0, 10);
let ctx: Isolation;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const serve = (twoFactorKey: Buffer | undefined = KEY) =>
  createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app, now: () => clock, twoFactorKey, passkeys: SITE },
  });
const post = (path: string, body: unknown, cookie = '') =>
  app.request(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
const json = async (response: Response) => (await response.json()) as Record<string, string>;
const codeFor = (secret: string): string =>
  new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: clock });

/** A member with an authenticator on: their session cookie, secret and backup codes. */
async function protectedMember() {
  app = serve();
  await createInvite(ctx.app, ctx.alice, {
    tokenHash: sha256('pk2-tok'),
    ttlSeconds: 600,
    monthlyLimitUsd: null,
  });
  const body = { token: 'pk2-tok', email: 'pk2@example.test', password: 'a brand new password' };
  const joined = await post('join', { ...body, acceptedNotice: true });
  const cookie = /morgan_session=[^;]+/.exec(joined.headers.get('set-cookie') ?? '')?.[0] ?? '';
  const secret = (await json(await post('two-factor/setup', {}, cookie)))['secret'] ?? '';
  clock += 30_000;
  const done = await post('two-factor/confirm', { code: codeFor(secret) }, cookie);
  clock += 30_000;
  const backupCodes = ((await done.json()) as { backupCodes: string[] }).backupCodes;
  return { cookie, secret, backupCodes };
}

it('asks for a current authenticator or backup code before a passkey can be added', async () => {
  const { cookie, secret, backupCodes } = await protectedMember();
  const status = async (body: unknown) => (await post('passkeys/options', body, cookie)).status;
  expect(await status({})).toBe(401);
  expect(await status({ code: '000000' })).toBe(401);
  expect(await status({ code: 123 })).toBe(400);
  const options = await post('passkeys/options', { code: codeFor(secret) }, cookie);
  expect(options.status).toBe(200);
  const challenge = (await json(options))['challenge'] ?? '';
  const added = await post(
    'passkeys',
    { response: newAuthenticator(SITE).create({ challenge }) },
    cookie,
  );
  expect(added.status).toBe(201);
  expect(await status({ code: backupCodes[0] })).toBe(200);
  expect(await status({ code: backupCodes[0] })).toBe(401);
  // Without the key a protected account is refused, never let through.
  app = serve(undefined);
  expect(await status({ code: codeFor(secret) })).toBe(401);
});

it('stops handing out sign-in challenges to an address that keeps failing', async () => {
  app = serve();
  const forger = newAuthenticator(SITE);
  for (let i = 0; i < 20; i++) {
    const options = await json(await post('sign-in/passkey/options', {}));
    const response = forger.get({ challenge: options['challenge'] ?? '' });
    expect((await post('sign-in/passkey', { response })).status).toBe(401);
  }
  expect((await post('sign-in/passkey/options', {})).status).toBe(429);
});
