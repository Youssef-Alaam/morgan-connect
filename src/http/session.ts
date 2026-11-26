import { randomBytes } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createSession, sessionOwner, type Db, type Owner } from '../data/index.js';
import { sha256 } from '../identity/admin-link.js';
import type { FailureLimiter } from '../identity/limiter.js';
import type { PasswordHasher } from '../identity/password.js';
import type { Logger } from '../ops/index.js';

export const COOKIE = 'morgan_session';
const SESSION_DAYS = 30;
export const UNIQUE_VIOLATION = '23505';

export interface AuthDeps {
  db: Db;
  logger: Logger;
  now?: () => number;
  /** Seals authenticator secrets and keys backup-code hashes (config TWO_FACTOR_KEY); undefined: no second factor. */
  twoFactorKey?: Buffer | undefined;
}

/** What every auth route shares: the hasher and the per-address failure bucket. */
export interface Shared {
  byAddress: FailureLimiter;
  hasher: PasswordHasher;
}

/** The caller's address, or one shared bucket when the server cannot tell (a test, a socket). */
export function addressOf(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface Signed {
  Variables: { session: Owner & { sessionId: string; mustChange: boolean } };
}

/** Start a browser session for this person and set its cookie. */
export async function openSession(
  c: Context,
  deps: { db: Db; now: () => number },
  owner: Owner,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expiresAt = new Date(deps.now() + maxAge * 1000);
  await createSession(deps.db, owner, { tokenHash: sha256(token), expiresAt });
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge });
}

/** Where `authRoutes` is mounted; the gate below matches paths after it. */
export const API_PREFIX = '/api';
/** The only paths open without a session; every other path under the prefix is refused by default. */
const PUBLIC = ['/sign-in', '/set-password', '/join'];
/** The only paths a person still on a temporary password may call. */
const TEMPORARY_OK = ['/change-password', '/sign-out'];

/** One gate for every route: a live session cookie, and a changed password, unless the path is listed. */
export function sessionGate(db: Db) {
  return createMiddleware<Signed>(async (c, next) => {
    const path = c.req.path.slice(API_PREFIX.length);
    if (PUBLIC.includes(path)) return next();
    const token = getCookie(c, COOKIE);
    const session = token === undefined ? undefined : await sessionOwner(db, sha256(token));
    if (session === undefined) return c.json({ error: 'unauthorized' }, 401);
    if (session.mustChange && !TEMPORARY_OK.includes(path)) {
      return c.json({ error: 'password_change_required' }, 403);
    }
    c.set('session', session);
    return next();
  });
}
