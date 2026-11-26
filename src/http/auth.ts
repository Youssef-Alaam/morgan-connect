import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  accountOf,
  credentialsByEmail,
  endSession,
  linkLive,
  redeemLink,
  type Owner,
} from '../data/index.js';
import { sha256 } from '../identity/admin-link.js';
import { createFailureLimiter } from '../identity/limiter.js';
import { chatRoutes, type ChatDeps } from './chat.js';
import { createPasswordHasher } from '../identity/password.js';
import { deviceRoutes } from './devices.js';
import { passkeyAccountRoutes, passkeySignInRoutes } from './passkeys.js';
import { memberRoutes } from './members.js';
import { profileRoutes } from './profiles.js';
import {
  addressOf,
  COOKIE,
  openSession,
  sessionGate,
  UNIQUE_VIOLATION,
  type AuthDeps,
  type Shared,
  type Signed,
} from './session.js';
import {
  challengeIfNeeded,
  createTwoFactor,
  secondStepRoute,
  twoFactorRoutes,
  type TwoFactor,
} from './two-factor.js';

const MAX_WRONG_TRIES = 5;
// One address may fail more often than one email (a shared office), but not without end.
const MAX_WRONG_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000;
const JSON_TYPE = /^application\/json\s*(;|$)/i;

const email = z.email().max(254);
const password = z.string().min(12).max(200);
const signIn = z.object({ email, password: z.string().max(200) });
const setPassword = z.object({ token: z.string().min(1).max(200), email, password });

/** Sign-in with two limiters (email, address) and a decoy: wrong email and wrong password look the same. */
function signInRoute(routes: Hono<Signed>, deps: AuthDeps, shared: Shared, two: TwoFactor): void {
  const { db, logger, now = Date.now } = deps;
  const { byAddress, hasher } = shared;
  const limiter = createFailureLimiter({ max: MAX_WRONG_TRIES, windowMs: WINDOW_MS, now });
  // A wrong email costs the same time as a wrong password.
  const decoy = hasher.hash(randomBytes(16).toString('hex'));
  /** The person behind this email if the password is right, else undefined (a decoy hash keeps the time equal). */
  const rightPassword = async (email: string, given: string): Promise<Owner | undefined> => {
    const found = await credentialsByEmail(db, email);
    const ok = await hasher.verify(given, found?.passwordHash ?? (await decoy));
    return ok ? found : undefined;
  };
  routes.post('/sign-in', async (c) => {
    const parsed = signIn.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const key = parsed.data.email.toLowerCase();
    const address = addressOf(c);
    if (limiter.blocked(key) || byAddress.blocked(address)) {
      return c.json({ error: 'too_many_attempts' }, 429);
    }
    // Counted before the check, so concurrent tries cannot skip the limit.
    limiter.fail(key);
    const owner = await rightPassword(key, parsed.data.password);
    if (owner === undefined) {
      byAddress.fail(address);
      logger.warn('web sign-in refused');
    } else limiter.reset(key);
    const challenge = await challengeIfNeeded(deps, two, owner, now());
    if (challenge !== undefined) return c.json(challenge);
    if (owner === undefined) return c.json({ error: 'invalid_credentials' }, 401);
    await openSession(c, { db, now }, owner);
    logger.info({ userId: owner.userId }, 'web sign-in');
    return c.json({ ok: true });
  });
}

/** The one-time link sets the first password; the link is spent only if the login is created. */
function setPasswordRoute(routes: Hono<Signed>, { db }: AuthDeps, shared: Shared): void {
  const { byAddress, hasher } = shared;
  routes.post('/set-password', async (c) => {
    const parsed = setPassword.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const address = addressOf(c);
    if (byAddress.blocked(address)) return c.json({ error: 'too_many_attempts' }, 429);
    // Refuse a dead link before spending a hash on it.
    const tokenHash = sha256(parsed.data.token);
    if (!(await linkLive(db, tokenHash))) {
      byAddress.fail(address);
      return c.json({ error: 'link_invalid' }, 410);
    }
    const link = {
      tokenHash,
      email: parsed.data.email,
      passwordHash: await hasher.hash(parsed.data.password),
    };
    try {
      if ((await redeemLink(db, link)) === undefined) return c.json({ error: 'link_invalid' }, 410);
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      return c.json({ error: 'email_taken' }, 409);
    }
    return c.json({ ok: true });
  });
}

/** Sign-in, sign-out, first-password link and `/api/me`. Handlers reach data only through `withOwner`. */
export function authRoutes(deps: AuthDeps, chat?: Omit<ChatDeps, 'db'>): Hono<Signed> {
  const { db } = deps;
  const routes = new Hono<Signed>();
  const byAddress = createFailureLimiter({
    max: MAX_WRONG_PER_IP,
    windowMs: WINDOW_MS,
    now: deps.now ?? Date.now,
  });
  // The auth endpoints take JSON only: a form post from another site cannot reach them.
  routes.use(async (c, next) => {
    const json = JSON_TYPE.test(c.req.header('content-type') ?? '');
    if (c.req.method === 'POST' && !json) return c.json({ error: 'unsupported_media_type' }, 415);
    return next();
  });
  const shared = { byAddress, hasher: createPasswordHasher() };
  const two = createTwoFactor(deps);
  signInRoute(routes, deps, shared, two);
  secondStepRoute(routes, deps, shared, two);
  passkeySignInRoutes(routes, deps, shared);
  setPasswordRoute(routes, deps, shared);

  routes.use(sessionGate(db));
  memberRoutes(routes, deps, shared);
  if (chat !== undefined) chatRoutes(routes, { ...chat, db });
  deviceRoutes(routes, deps);
  profileRoutes(routes, deps);
  twoFactorRoutes(routes, deps, two);
  passkeyAccountRoutes(routes, deps, shared, two);

  routes.get('/me', async (c) => c.json(await accountOf(db, c.get('session'))));

  routes.post('/sign-out', async (c) => {
    const session = c.get('session');
    await endSession(db, session, session.sessionId);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });
  return routes;
}
