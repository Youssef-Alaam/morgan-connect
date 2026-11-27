import { type Hono } from 'hono';
import { z } from 'zod';
import { budgetSummary, isAdmin, setBudget, setTaskCap } from '../data/index.js';
import { type AuthDeps, type Signed } from './session.js';

const personId = z.uuid();
const limit = z.object({ limitUsd: z.string().regex(/^\d{1,6}(\.\d{1,8})?$/) });
const taskCap = z.object({ cap: z.number().int().min(1).max(1000).nullable() });

/**
 * The admin's budgets page (M2-15c): spend this month against each limit, and the limit and task
 * cap per person. Every route is decided by the database, not by the page.
 */
export function budgetRoutes(
  routes: Hono<Signed>,
  { db, budgets, now = Date.now }: AuthDeps,
): void {
  // Spend this local month beside each person's limit, cap and approved top-ups (M2-15c).
  routes.get('/admin/budgets', async (c) => {
    const timezone = budgets?.timezone ?? 'UTC';
    const summary = await budgetSummary(db, c.get('session'), new Date(now()), timezone);
    if (summary === undefined) return c.json({ error: 'forbidden' }, 403);
    return c.json({
      ...summary,
      defaults: {
        limitUsd: budgets?.defaultLimitUsd ?? null,
        topupUsd: budgets?.topupAmountUsd ?? null,
      },
    });
  });

  // The two settings below are decided by the database: a member is refused (403, audited), and the
  // admin hears 404 for someone outside their workspace.
  function setting<T>(
    path: 'budget' | 'task-cap',
    schema: z.ZodType<T>,
    apply: (admin: Signed['Variables']['session'], id: string, body: T) => Promise<boolean>,
  ): void {
    routes.put(`/admin/people/:id/${path}`, async (c) => {
      const session = c.get('session');
      const id = personId.safeParse(c.req.param('id'));
      const body = schema.safeParse(await c.req.json().catch(() => undefined));
      const ready = id.success && body.success;
      if (!(await isAdmin(db, session))) {
        if (ready) await apply(session, id.data, body.data);
        return c.json({ error: 'forbidden' }, 403);
      }
      if (!ready) return c.json({ error: 'invalid_request' }, 400);
      return (await apply(session, id.data, body.data))
        ? c.body(null, 204)
        : c.json({ error: 'not_found' }, 404);
    });
  }
  setting('budget', limit, (admin, id, body) => setBudget(db, admin, id, body.limitUsd));
  setting('task-cap', taskCap, (admin, id, body) => setTaskCap(db, admin, id, body.cap));
}
