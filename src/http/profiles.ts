import { type Hono } from 'hono';
import { z } from 'zod';
import { isAdmin, listPresets } from '../data/index.js';
import { asModes, assignProfile, PRESETS, previewProfile, profilesOf } from '../policy/index.js';
import { type AuthDeps, type Signed } from './session.js';

const userId = z.uuid();
// Custom modes name every action type, each off, ask or auto, and nothing else.
const modes = z.unknown().transform((value, ctx) => {
  const parsed = asModes(value);
  if (parsed === undefined) ctx.addIssue({ code: 'custom', message: 'bad modes' });
  return parsed ?? z.NEVER;
});
const json = z.string().transform((text, ctx) => {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'not json' });
    return z.NEVER;
  }
});
const preview = z.object({
  userId: z.uuid(),
  deviceId: z.uuid().optional(),
  preset: z.enum(PRESETS),
  modes: json.pipe(modes).optional(),
});
const choice = z.object({
  preset: z.enum(PRESETS),
  deviceId: z.uuid().optional(),
  modes: modes.optional(),
});

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

  // The three presets and what each allows, for the admin's profile page.
  routes.get('/admin/profile-presets', async (c) => {
    if (!(await isAdmin(db, c.get('session')))) return c.json({ error: 'forbidden' }, 403);
    return c.json({ presets: await listPresets(db) });
  });

  // What a choice would loosen, before it is saved: the same warnings the save returns. Writes nothing.
  routes.get('/admin/profile-preview', async (c) => {
    const session = c.get('session');
    if (!(await isAdmin(db, session))) return c.json({ error: 'forbidden' }, 403);
    const parsed = preview.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const shown = await previewProfile(db, session, parsed.data);
    return shown === undefined ? c.json({ error: 'not_found' }, 404) : c.json(shown);
  });
}
