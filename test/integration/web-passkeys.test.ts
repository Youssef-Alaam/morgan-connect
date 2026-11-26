import { afterAll, beforeAll, expect, it } from 'vitest';
import { createInvite } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { userHandle } from '../../src/identity/passkeys.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';
import { newAuthenticator, type Authenticator } from '../helpers/passkey-authenticator.js';

const SITE = { origin: 'https://app.example.test', rpId: 'example.test' };
const PASSWORD = 'a brand new password';
type Server = ReturnType<typeof createApp>;
let ctx: Isolation;
let app: Server;
let bare: Server;
let clock = Date.UTC(2026, 10, 26, 12, 0, 10);
let counter = 0;

function serve(passkeys: typeof SITE | undefined): Server {
  const logger = createLogger('silent');
  const auth = { db: ctx.app, now: () => clock, passkeys };
  return createApp({ dbVersion: () => Promise.resolve('17'), logger, auth });
}

beforeAll(async () => {
  ctx = await startIsolation();
  bare = serve(undefined);
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const call = (
  server: Server,
  method: string,
  path: string,
  extra: { body?: unknown; cookie?: string } = {},
) =>
  server.request(`/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: extra.cookie ?? '' },
    ...(extra.body === undefined ? {} : { body: JSON.stringify(extra.body) }),
  });
const post = (path: string, body: unknown, cookie = '') =>
  call(app, 'POST', path, { body, cookie });
const get = (path: string, cookie: string) => call(app, 'GET', path, { cookie });
const remove = (path: string, cookie: string) => call(app, 'DELETE', path, { cookie });
const cookieOf = (response: Response) =>
  /morgan_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';
const json = async (response: Response) => (await response.json()) as Record<string, string>;
const listOf = async (cookie: string) =>
  (await (await get('passkeys', cookie)).json()) as {
    name: string;
    lastUsedAt: string | null;
  }[];

/** A new member with a password, signed in; a fresh server so no failure counts carry over. */
async function member(): Promise<{ cookie: string; userId: string }> {
  app = serve(SITE);
  counter += 1;
  const token = `pk-${String(counter)}`;
  const email = `pk${String(counter)}@example.test`;
  await createInvite(ctx.app, ctx.alice, {
    tokenHash: sha256(token),
    ttlSeconds: 600,
    monthlyLimitUsd: null,
  });
  const joined = await post('join', { token, email, password: PASSWORD, acceptedNotice: true });
  const login = await ctx.owner
    .selectFrom('credentials')
    .select('user_id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return { cookie: cookieOf(joined), userId: login.user_id };
}

/** Add this authenticator as a passkey of the signed-in member; returns the add response. */
async function add(cookie: string, passkey: Authenticator, name = 'Laptop'): Promise<Response> {
  const options = await json(await post('passkeys/options', {}, cookie));
  const response = passkey.create({ challenge: options['challenge'] ?? '' });
  return post('passkeys', { response, name }, cookie);
}

/** Sign in with this passkey, no password. */
async function signInWith(passkey: Authenticator, handle?: string): Promise<Response> {
  const options = await json(await post('sign-in/passkey/options', {}));
  const response = passkey.get({ challenge: options['challenge'] ?? '' }, SITE, handle);
  return post('sign-in/passkey', { response });
}

it('adds a passkey and then signs in with it, without a password', async () => {
  const { cookie, userId } = await member();
  const passkey = newAuthenticator(SITE, { userHandle: userHandle(userId) });
  expect((await add(cookie, passkey, '  Work laptop ')).status).toBe(201);
  expect((await listOf(cookie)).map((each) => [each.name, each.lastUsedAt])).toEqual([
    ['Work laptop', null],
  ]);
  const signed = await signInWith(passkey);
  expect(signed.status).toBe(200);
  expect((await get('me', cookieOf(signed))).status).toBe(200);
  expect((await listOf(cookie))[0]?.lastUsedAt).not.toBeNull();
});

it('spends a sign-in challenge once and lets it expire', async () => {
  const { cookie, userId } = await member();
  const passkey = newAuthenticator(SITE, { userHandle: userHandle(userId) });
  await add(cookie, passkey);
  const options = await json(await post('sign-in/passkey/options', {}));
  const response = passkey.get({ challenge: options['challenge'] ?? '' });
  expect((await post('sign-in/passkey', { response })).status).toBe(200);
  expect((await post('sign-in/passkey', { response })).status).toBe(401);
  const late = await json(await post('sign-in/passkey/options', {}));
  clock += 6 * 60_000;
  const stale = passkey.get({ challenge: late['challenge'] ?? '' });
  expect((await post('sign-in/passkey', { response: stale })).status).toBe(401);
});

it('refuses a passkey that is not this person: wrong key, unknown id, wrong handle', async () => {
  const { cookie, userId } = await member();
  const passkey = newAuthenticator(SITE, { userHandle: userHandle(userId) });
  await add(cookie, passkey);
  const options = await json(await post('sign-in/passkey/options', {}));
  const challenge = options['challenge'] ?? '';
  const fake = newAuthenticator(SITE).get({ challenge }) as { id: string; rawId: string };
  const stolen = { ...fake, id: passkey.credentialId, rawId: passkey.credentialId };
  expect((await post('sign-in/passkey', { response: stolen })).status).toBe(401);
  expect((await post('sign-in/passkey', { response: fake })).status).toBe(401);
  expect((await signInWith(passkey, userHandle('someone-else'))).status).toBe(401);
  expect((await post('sign-in/passkey', { response: 'x' })).status).toBe(400);
});

it('keeps one person from using or removing the passkey of another', async () => {
  const first = await member();
  const second = await member();
  const passkey = newAuthenticator(SITE);
  const id = (await json(await add(first.cookie, passkey)))['id'] ?? '';
  expect(await listOf(second.cookie)).toEqual([]);
  expect((await remove(`passkeys/${id}`, second.cookie)).status).toBe(404);
  expect((await remove('passkeys/not-an-id', second.cookie)).status).toBe(404);
  // A registration challenge is the asker's alone, and one authenticator is added once.
  const options = await json(await post('passkeys/options', {}, first.cookie));
  const answer = newAuthenticator(SITE).create({ challenge: options['challenge'] ?? '' });
  expect((await post('passkeys', { response: answer }, second.cookie)).status).toBe(400);
  expect((await add(second.cookie, passkey)).status).toBe(409);
  expect((await remove(`passkeys/${id}`, first.cookie)).status).toBe(204);
});

it('refuses a registration from the wrong site or without proof of the person', async () => {
  const { cookie } = await member();
  const attempt = async (passkey: Authenticator, site?: typeof SITE): Promise<number> => {
    const options = await json(await post('passkeys/options', {}, cookie));
    const response = passkey.create({ challenge: options['challenge'] ?? '' }, site);
    return (await post('passkeys', { response }, cookie)).status;
  };
  const elsewhere = { origin: 'https://evil.test', rpId: 'evil.test' };
  expect(await attempt(newAuthenticator(SITE), elsewhere)).toBe(400);
  expect(await attempt(newAuthenticator(SITE, { userVerified: false }))).toBe(400);
  expect(await attempt(newAuthenticator(SITE))).toBe(201);
  expect((await post('passkeys', { response: 'x' }, cookie)).status).toBe(400);
});

it('refuses repeated bad sign-ins from one address, then even a good one', async () => {
  const { cookie, userId } = await member();
  const passkey = newAuthenticator(SITE, { userHandle: userHandle(userId) });
  await add(cookie, passkey);
  const forger = newAuthenticator(SITE);
  for (let i = 0; i < 20; i++) expect((await signInWith(forger)).status).toBe(401);
  expect((await signInWith(passkey)).status).toBe(429);
  expect((await add(cookie, newAuthenticator(SITE))).status).toBe(429);
});

it('is off without the relying-party settings', async () => {
  const { cookie } = await member();
  for (const path of [
    'sign-in/passkey/options',
    'sign-in/passkey',
    'passkeys/options',
    'passkeys',
  ]) {
    const response = await call(bare, 'POST', path, { body: {}, cookie });
    expect([path, response.status]).toEqual([path, 501]);
  }
});
