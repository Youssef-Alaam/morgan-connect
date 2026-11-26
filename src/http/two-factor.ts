import { type Hono } from 'hono';
import { z } from 'zod';
import { accountOf, confirmTotp, pendingTotp, startTotp } from '../data/index.js';
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
import { type AuthDeps, type Signed } from './session.js';

const MAX_WRONG_CODES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const code = z.object({ code: z.string().max(32) });
const unavailable = { error: 'two_factor_unavailable' } as const;

/** What the second-factor paths share: the key, and one failure bucket per person. */
export interface TwoFactor {
  key: Buffer | undefined;
  limiter: FailureLimiter;
}

export function createTwoFactor({ twoFactorKey: key, now = Date.now }: AuthDeps): TwoFactor {
  const limiter = createFailureLimiter({ max: MAX_WRONG_CODES, windowMs: WINDOW_MS, now });
  return { key, limiter };
}

/** Counts the try first, then runs the check, so concurrent tries cannot skip the limit. */
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
 * Turning on an authenticator app (M2-6): `setup` hands out a secret and the address for its QR
 * code; `confirm` takes the first code, switches it on and shows the backup codes once. Without
 * `TWO_FACTOR_KEY` there is nowhere safe to keep the secret, so both answer 501.
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
}
