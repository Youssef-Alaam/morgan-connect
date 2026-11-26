import { type Hono } from 'hono';
import { z } from 'zod';
import { issueLinkCode, listDevices, unlinkDevice } from '../data/index.js';
import { sha256 } from '../identity/admin-link.js';
import { createFailureLimiter } from '../identity/limiter.js';
import { LINK_CODE_TTL_SECONDS, newLinkCode, normaliseLinkCode } from '../identity/link-code.js';
import { audit } from './members.js';
import { type AuthDeps, type Signed } from './session.js';

/** A person may ask for this many codes in the window; each new code replaces the last. */
const MAX_CODES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const deviceId = z.uuid();

/**
 * Link codes and linked chats (M2-8). A code is made only inside a signed-in session (the central
 * gate), so the chat that spends it joins the person who asked, never anyone else.
 */
export function deviceRoutes(routes: Hono<Signed>, { db, now = Date.now }: AuthDeps): void {
  const asked = createFailureLimiter({ max: MAX_CODES, windowMs: WINDOW_MS, now });
  routes.post('/link-codes', async (c) => {
    const session = c.get('session');
    if (asked.blocked(session.userId)) return c.json({ error: 'too_many_attempts' }, 429);
    asked.fail(session.userId);
    const code = newLinkCode();
    await issueLinkCode(db, session, {
      codeHash: sha256(normaliseLinkCode(code)),
      ttlSeconds: LINK_CODE_TTL_SECONDS,
    });
    return c.json({ code, expiresInMinutes: LINK_CODE_TTL_SECONDS / 60 });
  });

  routes.get('/devices', async (c) => c.json(await listDevices(db, c.get('session'))));

  // The person removes their own chat; the admin may remove anyone's in the workspace.
  routes.delete('/devices/:id', async (c) => {
    const session = c.get('session');
    const id = deviceId.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const owner = await unlinkDevice(db, session, id.data);
    await audit(db, session, 'device.unlink', { ok: owner !== undefined, subjectUserId: owner });
    return owner === undefined ? c.json({ error: 'not_found' }, 404) : c.body(null, 204);
  });
}
