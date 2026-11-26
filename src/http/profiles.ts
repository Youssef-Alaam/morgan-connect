import { type Hono } from 'hono';
import { z } from 'zod';
import { assignProfile, PRESETS, profilesOf } from '../policy/index.js';
import { type AuthDeps, type Signed } from './session.js';

const userId = z.uuid();
const choice = z.object({ preset: z.enum(PRESETS), deviceId: z.uuid().optional() });

/**
 * Access profiles (M2-9a). Anyone signed in reads their own; the admin reads and sets anyone's in
 * the workspace. Whether the caller may is decided by the database (named functions), and every
 * change writes its audit row there.
 */
export function profileRoutes(routes: Hono<Signed>, { db }: AuthDeps): void {
  routes.get('/members/:id/profiles', async (c) => {
    const id = userId.safeParse(c.req.param('id'));
    const found = id.success ? await profilesOf(db, c.get('session'), id.data) : undefined;
    return found === undefined ? c.json({ error: 'not_found' }, 404) : c.json(found);
  });

  routes.put('/members/:id/profile', async (c) => {
    const id = userId.safeParse(c.req.param('id'));
    const parsed = choice.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success || !parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const done = await assignProfile(db, c.get('session'), { userId: id.data, ...parsed.data });
    return done === undefined ? c.json({ error: 'forbidden' }, 403) : c.json(done);
  });
}
