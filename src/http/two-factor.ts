import { randomUUID } from 'node:crypto';
import { type Hono } from 'hono';
import { z } from 'zod';
import {
  accountOf,
  activeTotp,
  confirmTotp,
  pendingTotp,
  removeTotp,
  spendBackupCode,
  spendTotpStep,
  startTotp,
  type Owner,
} from '../data/index.js';
import { createFailureLimiter, type FailureLimiter } from '../identity/limiter.js';
import {
  checkTotp,
  hashBackupCode,
  newBackupCodes,
  newTotpSecret,
  openSecret,
  sealSecret,
  totpUri,
} from '../identity/second-factor.js';
import { addressOf, openSession, type AuthDeps, type Shared, type Signed } from './session.js';

const MAX_WRONG_CODES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
/** Binds a challenge to its purpose, so no stored secret can be passed off as one. */
const CHALLENGE_AAD = 'sign-in';
const code = z.object({ code: z.string().max(32) });
const challengeBody = z.object({ challenge: z.string().max(500), code: z.string().max(32) });
const challengeData = z.object({
  jti: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  real: z.boolean(),
  until: z.number(),
});
const unavailable = { error: 'two_factor_unavailable' } as const;

/** What the second-factor paths share: the key, one failure bucket per person, and the check. */
export interface TwoFactor {
  key: Buffer | undefined;
  /**
   * One wrong-code bucket per person, shared by the sign-in second step, confirm and disable, so
   * guessing cannot be spread across the three paths. For a sign-in with a bad challenge it is the
   * caller's address.
   */
  limiter: FailureLimiter;
  /** Spend a challenge id; false when it was spent already (kept in memory until it expires). */
  spend: (jti: string, until: number) => boolean;
  /** True for a live authenticator code (each step once) or an unused backup code (once). */
  verify: (owner: Owner, code: string) => Promise<boolean>;
}

export function createTwoFactor({ db, twoFactorKey: key, now = Date.now }: AuthDeps): TwoFactor {
  const limiter = createFailureLimiter({ max: MAX_WRONG_CODES, windowMs: WINDOW_MS, now });
  const spent = new Map<string, number>();
  const spend = (jti: string, until: number): boolean => {
    for (const [id, end] of spent) if (end <= now()) spent.delete(id);
    if (spent.has(jti)) return false;
    spent.set(jti, until);
    return true;
  };
  const verify = async (owner: Owner, given: string): Promise<boolean> => {
    if (key === undefined) return false;
    const sealed = await activeTotp(db, owner);
    if (sealed === undefined) return false;
    if (/^\d{6}$/.test(given)) {
      const step = checkTotp(openSecret(key, owner.userId, sealed), given, now());
      return step !== undefined && (await spendTotpStep(db, owner, step));
    }
    return spendBackupCode(db, owner, hashBackupCode(key, given));
  };
  return { key, limiter, spend, verify };
}

/**
 * The answer to a password that needs a second step, or undefined when none is needed. With a key
 * set, a wrong password gets the same answer as a right one on an account with a second factor
 * (same shape, only a right password carries the real person, a wrong one made-up ids no code can
 * match), so the password is never confirmed to someone who lacks the second factor.
 */
export async function challengeIfNeeded(
  { db }: AuthDeps,
  two: TwoFactor,
  owner: Owner | undefined,
  now: number,
): Promise<object | undefined> {
  // One lookup either way, so a wrong password costs the same time as a right one.
  const who = owner ?? { userId: randomUUID(), workspaceId: randomUUID() };
  const on = owner !== undefined && (await activeTotp(db, who)) !== undefined;
  if (two.key === undefined) {
    // Never let a missing key switch a second factor off: refuse the sign-in (a 500, logged).
    if (on) throw new Error('TWO_FACTOR_KEY is not set but this account has a second factor');
    return undefined;
  }
  if (owner !== undefined && !on) return undefined;
  const { userId, workspaceId } = who;
  const real = owner !== undefined;
  const data = { jti: randomUUID(), userId, workspaceId, real, until: now + CHALLENGE_MS };
  const challenge = sealSecret(two.key, CHALLENGE_AAD, JSON.stringify(data));
  return { step: 'second_factor', challenge };
}

/** The person a challenge was made for, if it is genuine, live and came from a right password. */
function challengeOwner(
  two: TwoFactor,
  challenge: string,
  now: number,
): { owner: Owner; jti: string; until: number } | undefined {
  try {
    const raw = openSecret(two.key ?? Buffer.alloc(32), CHALLENGE_AAD, challenge);
    const data = challengeData.parse(JSON.parse(raw));
    if (!data.real || data.until <= now) return undefined;
    const { jti, until } = data;
    return { owner: { userId: data.userId, workspaceId: data.workspaceId }, jti, until };
  } catch {
    return undefined;
  }
}

/** A challenge opens one sign-in: it is spent only once a code has passed, so a typo can be retried. */
async function passes(
  two: TwoFactor,
  { owner, jti, until }: { owner: Owner; jti: string; until: number },
  code: string,
): Promise<boolean> {
  return (await two.verify(owner, code)) && two.spend(jti, until);
}

/** Second half of a sign-in: the challenge from `/sign-in` plus an authenticator or backup code. */
export function secondStepRoute(
  routes: Hono<Signed>,
  deps: AuthDeps,
  shared: Shared,
  two: TwoFactor,
): void {
  const { db, logger, now = Date.now } = deps;
  routes.post('/sign-in/second-factor', async (c) => {
    if (two.key === undefined) return c.json(unavailable, 501);
    const parsed = challengeBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const address = addressOf(c);
    const opened = challengeOwner(two, parsed.data.challenge, now());
    const bucket = opened?.owner.userId ?? address;
    if (two.limiter.blocked(bucket) || shared.byAddress.blocked(address)) {
      return c.json({ error: 'too_many_attempts' }, 429);
    }
    // Counted before the check, so concurrent tries cannot skip the limit.
    two.limiter.fail(bucket);
    if (opened === undefined || !(await passes(two, opened, parsed.data.code))) {
      shared.byAddress.fail(address);
      logger.warn('web sign-in refused');
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    two.limiter.reset(bucket);
    await openSession(c, { db, now }, opened.owner);
    logger.info({ userId: opened.owner.userId }, 'web sign-in with second factor');
    return c.json({ ok: true });
  });
}

/** Counts the try first, then runs the check; a person's tries share one limit. */
async function tried(
  limiter: FailureLimiter,
  userId: string,
  check: () => Promise<boolean>,
): Promise<200 | 401 | 429> {
  if (limiter.blocked(userId)) return 429;
  limiter.fail(userId);
  if (!(await check())) return 401;
  limiter.reset(userId);
  return 200;
}

const refusal = (status: 401 | 429) => ({
  error: status === 429 ? 'too_many_attempts' : 'invalid_code',
});

/**
 * For a step a stolen session must not take alone: open when the person has no authenticator on,
 * else a current authenticator or backup code (the same check, limit and refusal as turning it off).
 */
export async function secondFactorGate(
  { db }: AuthDeps,
  two: TwoFactor,
  session: Owner,
  given: string | undefined,
): Promise<{ error: string; status: 401 | 429 } | undefined> {
  if ((await activeTotp(db, session)) === undefined) return undefined;
  const status =
    given === undefined
      ? 401
      : await tried(two.limiter, session.userId, () => two.verify(session, given));
  return status === 200 ? undefined : { ...refusal(status), status };
}

/** Turning it off takes a current code (authenticator or backup), so a stolen session cannot do it. */
function disableRoute(routes: Hono<Signed>, { db }: AuthDeps, two: TwoFactor): void {
  routes.post('/two-factor/disable', async (c) => {
    if (two.key === undefined) return c.json(unavailable, 501);
    const parsed = code.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const session = c.get('session');
    const status = await tried(two.limiter, session.userId, () =>
      two.verify(session, parsed.data.code),
    );
    if (status !== 200) return c.json(refusal(status), status);
    await removeTotp(db, session, session.sessionId);
    return c.json({ ok: true });
  });
}

/**
 * Turning an authenticator app on and off (M2-6): `setup` hands out a secret and the address for
 * its QR code; `confirm` takes the first code, switches it on and shows the backup codes once;
 * `disable` needs a current code. Without `TWO_FACTOR_KEY` there is nowhere safe to keep the secret.
 */
export function twoFactorRoutes(routes: Hono<Signed>, deps: AuthDeps, two: TwoFactor): void {
  const { db, now = Date.now } = deps;
  const { key } = two;

  routes.post('/two-factor/setup', async (c) => {
    if (key === undefined) return c.json(unavailable, 501);
    const session = c.get('session');
    const secret = newTotpSecret();
    if (!(await startTotp(db, session, sealSecret(key, session.userId, secret)))) {
      return c.json({ error: 'already_enabled' }, 409);
    }
    const label = (await accountOf(db, session)).user.email ?? 'account';
    return c.json({ secret, uri: totpUri(secret, label) });
  });

  routes.post('/two-factor/confirm', async (c) => {
    if (key === undefined) return c.json(unavailable, 501);
    const parsed = code.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const session = c.get('session');
    const sealed = await pendingTotp(db, session);
    if (sealed === undefined) return c.json({ error: 'not_started' }, 409);
    const backupCodes = newBackupCodes();
    const codeHashes = backupCodes.map((each) => hashBackupCode(key, each));
    const status = await tried(two.limiter, session.userId, async () => {
      const step = checkTotp(openSecret(key, session.userId, sealed), parsed.data.code, now());
      return (
        step !== undefined &&
        (await confirmTotp(db, session, {
          sealed,
          step,
          codeHashes,
          keepSessionId: session.sessionId,
        }))
      );
    });
    return status === 200 ? c.json({ backupCodes }) : c.json(refusal(status), status);
  });
  disableRoute(routes, deps, two);
}
