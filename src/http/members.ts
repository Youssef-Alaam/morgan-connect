import { randomBytes } from 'node:crypto';
import { type Hono } from 'hono';
import { z } from 'zod';
import {
  accountOf,
  appendAudit,
  changePassword,
  createAccount,
  createInvite,
  credentialsByEmail,
  inviteLive,
  redeemInvite,
  type Owner,
} from '../data/index.js';
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
const limit = z.number().min(0).max(1_000_000).nullable().default(null);
const newInvite = z.object({
  role: z.literal('member').default('member'),
  monthlyLimitUsd: limit,
  ttlHours: z.number().int().min(1).max(720).default(72),
});
const newAccount = z.object({ email, monthlyLimitUsd: limit });
const change = z.object({
  current: z.string().max(200),
  password,
  acceptedNotice: z.boolean().default(false),
});
const join = z.object({
  token: z.string().min(1).max(200),
  email,
  password,
  acceptedNotice: z.boolean(),
});
const isDuplicate = (error: unknown): boolean =>
  (error as { code?: string }).code === UNIQUE_VIOLATION;

/** One audit row for an admin-only action, `ok` or `refused`, under the caller's web session. */
export function audit(
  db: AuthDeps['db'],
  who: Owner & { sessionId: string },
  tool: string,
  result: { ok: boolean; subjectUserId?: string | undefined },
) {
  return appendAudit(db, {
    channel: 'web',
    chatId: who.sessionId,
    tool,
    actionType: tool,
    changesState: true,
    argNames: [],
    extraArgs: 0,
    argsSha256: sha256(''),
    decision: 'auto',
    outcome: result.ok ? 'ok' : 'refused',
    subjectUserId: result.subjectUserId,
  });
}

/** Admin only: make an invite token, or a member with a temporary password. */
function adminRoutes(routes: Hono<Signed>, { db }: AuthDeps, shared: Shared): void {
  routes.post('/invites', async (c) => {
    const parsed = newInvite.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const token = randomBytes(32).toString('base64url');
    const { monthlyLimitUsd, ttlHours } = parsed.data;
    const invite = { tokenHash: sha256(token), ttlSeconds: ttlHours * 3600, monthlyLimitUsd };
    const ok = await createInvite(db, c.get('session'), invite);
    await audit(db, c.get('session'), 'admin.invite.create', { ok });
    return ok ? c.json({ token, ttlHours }) : c.json({ error: 'forbidden' }, 403);
  });
  routes.post('/accounts', async (c) => {
    const parsed = newAccount.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const temporaryPassword = randomBytes(12).toString('base64url');
    const passwordHash = await shared.hasher.hash(temporaryPassword);
    try {
      const id = await createAccount(db, c.get('session'), { ...parsed.data, passwordHash });
      const result = { ok: id !== undefined, subjectUserId: id };
      await audit(db, c.get('session'), 'admin.account.create', result);
      return id !== undefined ? c.json({ temporaryPassword }) : c.json({ error: 'forbidden' }, 403);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return c.json({ error: 'email_taken' }, 409);
    }
  });
}

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

/** The one call open to a temporary password; it also records the notice for such an account. */
function changePasswordRoute(routes: Hono<Signed>, { db }: AuthDeps, shared: Shared): void {
  routes.post('/change-password', async (c) => {
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
    await changePassword(db, session, {
      passwordHash,
      noticeAccepted: acceptedNotice,
      keepSessionId: session.sessionId,
    });
    return c.json({ ok: true });
  });
}

/** Invites, accounts with a temporary password, joining, and changing a password (M2-5b). */
export function memberRoutes(routes: Hono<Signed>, deps: AuthDeps, shared: Shared): void {
  adminRoutes(routes, deps, shared);
  joinRoute(routes, deps, shared);
  changePasswordRoute(routes, deps, shared);
}
