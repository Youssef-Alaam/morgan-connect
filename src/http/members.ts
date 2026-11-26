import { type Hono } from 'hono';
import { z } from 'zod';
import { inviteLive, redeemInvite } from '../data/index.js';
import { sha256 } from '../identity/admin-link.js';
import {
  addressOf,
  openSession,
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
      if (joined === undefined) {
        shared.byAddress.fail(address);
        return c.json({ error: 'link_invalid' }, 410);
      }
      await openSession(c, { db, now }, joined);
      return c.json({ ok: true });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return c.json({ error: 'email_taken' }, 409);
    }
  });
}

/** Joining by an invite (M2-5b). */
export function memberRoutes(routes: Hono<Signed>, deps: AuthDeps, shared: Shared): void {
  joinRoute(routes, deps, shared);
}
