import { type Hono } from 'hono';
import { z } from 'zod';
import { isAdmin, listInvites, listPeople, revokeInvite } from '../data/index.js';
import { type AuthDeps, type Signed } from './session.js';

const inviteId = z.uuid();

/**
 * What the admin's Users page reads and revokes (M2-15a). Making invites and accounts and unlinking
 * a chat are the existing calls. Every route is decided by the database, not by the page: a member
 * gets 403 whatever they send.
 */
export function adminRoutes(routes: Hono<Signed>, { db }: AuthDeps): void {
  routes.get('/admin/people', async (c) => {
    const people = await listPeople(db, c.get('session'));
    return people === undefined ? c.json({ error: 'forbidden' }, 403) : c.json({ people });
  });

  routes.get('/admin/invites', async (c) => {
    const session = c.get('session');
    if (!(await isAdmin(db, session))) return c.json({ error: 'forbidden' }, 403);
    return c.json({ invites: await listInvites(db, session) });
  });

  // Refused and audited for a member; 404 for an invite that is gone or already used.
  routes.delete('/admin/invites/:id', async (c) => {
    const session = c.get('session');
    const id = inviteId.safeParse(c.req.param('id'));
    if (id.success && (await revokeInvite(db, session, id.data))) return c.body(null, 204);
    // A member is refused whatever the id; only the admin hears "not found".
    return (await isAdmin(db, session))
      ? c.json({ error: 'not_found' }, 404)
      : c.json({ error: 'forbidden' }, 403);
  });
}
