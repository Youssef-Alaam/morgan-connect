import { type Hono } from 'hono';
import { z } from 'zod';
import {
  accountOf,
  changePassword,
  credentialsByEmail,
  inviteLive,
  redeemInvite,
} from '../data/index.js';
import { sha256 } from '../identity/admin-link.js';
import {
  addressOf,
  openSession,
  signedIn,
  UNIQUE_VIOLATION,
  type AuthDeps,
  type Shared,
  type Signed,
} from './session.js';

/** The translation key of the disclosure shown at joining (D59). */
const ADMIN_READ_NOTICE = 'join.notice.admin_can_read';

const email = z.email().max(254);
const password = z.string().min(12).max(200);
const join = z.object({
  token: z.string().min(1).max(200),
  email,
  password,
  acceptedNotice: z.boolean(),
});
const change = z.object({
  current: z.string().max(200),
  password,
  acceptedNotice: z.boolean().default(false),
});

const isDuplicate = (error: unknown): boolean =>
  (error as { code?: string }).code === UNIQUE_VIOLATION;

/** The invited person opens the link: accepts the notice, sets a password, and is signed in. */
function joinRoute(routes: Hono<Signed>, deps: AuthDeps, shared: Shared): void {
  const { db, now = Date.now } = deps;
  routes.post('/join', async (c) => {
    const parsed = join.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    if (!parsed.data.acceptedNotice) {
      return c.json({ error: 'notice_required', notice: ADMIN_READ_NOTICE }, 400);
    }
    const address = addressOf(c);
    if (shared.byAddress.blocked(address)) return c.json({ error: 'too_many_attempts' }, 429);
    const tokenHash = sha256(parsed.data.token);
    if (!(await inviteLive(db, tokenHash))) {
      shared.byAddress.fail(address);
      return c.json({ error: 'link_invalid' }, 410);
    }
    const passwordHash = await shared.hasher.hash(parsed.data.password);
    try {
      const joined = await redeemInvite(db, { tokenHash, email: parsed.data.email, passwordHash });
      if (joined === undefined) return c.json({ error: 'link_invalid' }, 410);
      await openSession(c, { db, now }, joined);
      return c.json({ ok: true });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return c.json({ error: 'email_taken' }, 409);
    }
  });
}

/** The one call open to a temporary password; it also records the notice for such an account. */
function changePasswordRoute(routes: Hono<Signed>, { db }: AuthDeps, shared: Shared): void {
  routes.post('/change-password', signedIn(db, { allowTemporary: true }), async (c) => {
    const parsed = change.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const session = c.get('session');
    const { current, acceptedNotice } = parsed.data;
    if (session.mustChange && !acceptedNotice) {
      return c.json({ error: 'notice_required', notice: ADMIN_READ_NOTICE }, 400);
    }
    const address = addressOf(c);
    if (shared.byAddress.blocked(address)) return c.json({ error: 'too_many_attempts' }, 429);
    const mine = (await accountOf(db, session)).user.email ?? '';
    const found = await credentialsByEmail(db, mine);
    if (found === undefined || !(await shared.hasher.verify(current, found.passwordHash))) {
      shared.byAddress.fail(address);
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    if (current === parsed.data.password) return c.json({ error: 'same_password' }, 400);
    const passwordHash = await shared.hasher.hash(parsed.data.password);
    await changePassword(db, session, { passwordHash, noticeAccepted: acceptedNotice });
    return c.json({ ok: true });
  });
}

/** Joining by an invite and changing a password (M2-5b). */
export function memberRoutes(routes: Hono<Signed>, deps: AuthDeps, shared: Shared): void {
  joinRoute(routes, deps, shared);
  changePasswordRoute(routes, deps, shared);
}
