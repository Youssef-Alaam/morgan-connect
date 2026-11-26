import { type Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  accountOf,
  addPasskey,
  listPasskeys,
  passkeyByCredential,
  recordPasskeyUse,
  removePasskey,
} from '../data/index.js';
import {
  authenticationOptions,
  createChallenges,
  type Challenges,
  registrationOptions,
  userHandle,
  verifyAuthentication,
  verifyRegistration,
} from '../identity/passkeys.js';
import {
  addressOf,
  openSession,
  UNIQUE_VIOLATION,
  type AuthDeps,
  type Shared,
  type Signed,
} from './session.js';

const text = (max: number) => z.string().max(max);
const common = { id: text(1024), rawId: text(1024), type: z.literal('public-key') };
const extensions = z.record(z.string(), z.unknown());
const registration = z.object({
  response: z.object({
    ...common,
    response: z.object({
      clientDataJSON: text(4096),
      attestationObject: text(16384),
      transports: z.array(text(32)).max(10).optional(),
    }),
    clientExtensionResults: extensions,
  }),
  name: z.string().trim().min(1).max(60).default('Passkey'),
});
const assertion = z.object({
  response: z.object({
    ...common,
    response: z.object({
      clientDataJSON: text(4096),
      authenticatorData: text(4096),
      signature: text(4096),
      userHandle: text(256).optional(),
    }),
    clientExtensionResults: extensions,
  }),
});
const passkeyId = z.uuid();
const unavailable = { error: 'passkeys_unavailable' } as const;

/**
 * Sign-in with a passkey and no password (M2-7), open without a session. A passkey must prove the
 * person (PIN, face or finger), so it also stands in for a second factor. Without
 * WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN none of the passkey paths is on.
 */
export function passkeySignInRoutes(routes: Hono<Signed>, deps: AuthDeps, shared: Shared): void {
  const { db, logger, now = Date.now, passkeys: rp } = deps;
  const challenges = createChallenges(now);

  routes.post('/sign-in/passkey/options', async (c) => {
    if (rp === undefined) return c.json(unavailable, 501);
    const options = await authenticationOptions(rp);
    challenges.put(options.challenge);
    return c.json(options);
  });

  routes.post('/sign-in/passkey', async (c) => {
    if (rp === undefined) return c.json(unavailable, 501);
    const parsed = assertion.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const address = addressOf(c);
    if (shared.byAddress.blocked(address)) return c.json({ error: 'too_many_attempts' }, 429);
    const given = parsed.data.response;
    const stored = await passkeyByCredential(db, given.id);
    const counter =
      stored === undefined
        ? undefined
        : await verifyAuthentication(
            rp,
            given as AuthenticationResponseJSON,
            { ...stored, credentialId: given.id },
            (challenge) => challenges.take(challenge),
          );
    const handle = given.response.userHandle;
    if (
      stored === undefined ||
      counter === undefined ||
      (handle !== undefined && handle !== userHandle(stored.userId))
    ) {
      shared.byAddress.fail(address);
      logger.warn('web passkey sign-in refused');
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    await recordPasskeyUse(db, stored, given.id, counter);
    await openSession(c, { db, now }, stored);
    logger.info({ userId: stored.userId }, 'web sign-in with passkey');
    return c.json({ ok: true });
  });
}

/** Store a passkey the browser just made: only for the challenge this person was given. */
function addRoute(
  routes: Hono<Signed>,
  { db, passkeys: rp }: AuthDeps,
  shared: Shared,
  challenges: Challenges,
): void {
  routes.post('/passkeys', async (c) => {
    if (rp === undefined) return c.json(unavailable, 501);
    const parsed = registration.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const session = c.get('session');
    const address = addressOf(c);
    if (shared.byAddress.blocked(address)) return c.json({ error: 'too_many_attempts' }, 429);
    const passkey = await verifyRegistration(
      rp,
      parsed.data.response as RegistrationResponseJSON,
      (challenge) => challenges.take(challenge, session.userId),
    );
    if (passkey === undefined) {
      shared.byAddress.fail(address);
      return c.json({ error: 'invalid_passkey' }, 400);
    }
    try {
      const id = await addPasskey(db, session, { ...passkey, name: parsed.data.name });
      return c.json({ id }, 201);
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      return c.json({ error: 'already_registered' }, 409);
    }
  });
}

/** The signed-in half: ask to add a passkey, store it, list and remove. */
export function passkeyAccountRoutes(routes: Hono<Signed>, deps: AuthDeps, shared: Shared): void {
  const { db, now = Date.now, passkeys: rp } = deps;
  const challenges = createChallenges(now);

  routes.post('/passkeys/options', async (c) => {
    if (rp === undefined) return c.json(unavailable, 501);
    const session = c.get('session');
    const account = await accountOf(db, session);
    const person = { userId: session.userId, label: account.user.email ?? 'account' };
    const options = await registrationOptions(rp, person, await listPasskeys(db, session));
    challenges.put(options.challenge, session.userId);
    return c.json(options);
  });

  addRoute(routes, deps, shared, challenges);

  routes.get('/passkeys', async (c) => {
    const list = await listPasskeys(db, c.get('session'));
    return c.json(
      list.map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })),
    );
  });

  routes.delete('/passkeys/:id', async (c) => {
    const id = passkeyId.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const result = await removePasskey(db, c.get('session'), id.data);
    if (result === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result === 'last_method') return c.json({ error: 'last_sign_in_method' }, 409);
    return c.body(null, 204);
  });
}
