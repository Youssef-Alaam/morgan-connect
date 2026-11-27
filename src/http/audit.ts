import { type Hono } from 'hono';
import { z } from 'zod';
import { adminRead, AdminReadRefused } from '../data/admin-read.js';
import { isAdmin, listAudit } from '../data/index.js';
import { type AuthDeps, type Signed } from './session.js';

const empty = (value: unknown) => (value === '' ? undefined : value);
const text = z.preprocess(empty, z.string().max(100).optional());
const query = z.object({
  person: z.preprocess(empty, z.uuid().optional()),
  action: text,
  decision: z.preprocess(empty, z.enum(['auto', 'ask', 'off']).optional()),
  outcome: z.preprocess(
    empty,
    z.enum(['ok', 'error', 'refused', 'denied', 'expired', 'aborted']).optional(),
  ),
  from: z.preprocess(empty, z.coerce.date().optional()),
  to: z.preprocess(empty, z.coerce.date().optional()),
  before: z.preprocess(
    empty,
    z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
  ),
  limit: z.preprocess(empty, z.coerce.number().int().min(1).max(100).optional()),
});

/**
 * The admin's audit log viewer (M2-15d): one paged, read-only list, newest first. There is no
 * route that changes or removes a row. A member is refused by the database (403, audited).
 */
export function auditRoutes(routes: Hono<Signed>, { db }: AuthDeps): void {
  routes.get('/admin/audit', async (c) => {
    const session = c.get('session');
    const asked = query.safeParse(c.req.query());
    if (!asked.success) {
      return (await isAdmin(db, session))
        ? c.json({ error: 'invalid_request' }, 400)
        : c.json({ error: 'forbidden' }, 403);
    }
    const { person, action, ...rest } = asked.data;
    const page = await listAudit(db, session, {
      ...(person === undefined ? {} : { personId: person }),
      ...(action === undefined ? {} : { actionType: action }),
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    });
    return page === undefined ? c.json({ error: 'forbidden' }, 403) : c.json(page);
  });
}

const memberId = z.uuid();
/** Why the admin opens the chat; it is written on the audit row. */
const reading = z.object({ reason: z.string().trim().min(1).max(500) });

/**
 * A member's chat, opened by the admin (M2-15d). It goes only through the audited admin read path
 * (ADR 0009): the database writes the `admin.read` row before it returns any message, and a
 * refusal is audited too. A member is refused (403) whatever they send; the admin hears 404 for
 * someone outside their workspace.
 */
export function adminChatRoute(routes: Hono<Signed>, { db }: AuthDeps): void {
  routes.post('/admin/people/:id/chat', async (c) => {
    const session = c.get('session');
    const id = memberId.safeParse(c.req.param('id'));
    const body = reading.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success || !body.success) {
      return (await isAdmin(db, session))
        ? c.json({ error: 'invalid_request' }, 400)
        : c.json({ error: 'forbidden' }, 403);
    }
    try {
      return c.json({ messages: await adminRead.chat(db, session, id.data, body.data.reason) });
    } catch (error) {
      if (!(error instanceof AdminReadRefused)) throw error;
      return (await isAdmin(db, session))
        ? c.json({ error: 'not_found' }, 404)
        : c.json({ error: 'forbidden' }, 403);
    }
  });
}
