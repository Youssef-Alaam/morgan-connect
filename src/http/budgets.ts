import { type Hono } from 'hono';
import { z } from 'zod';
import {
  answerTopup,
  budgetSummary,
  isAdmin,
  listWaitingTopups,
  setBudget,
  setTaskCap,
  setTopupStep,
} from '../data/index.js';
import { topupAnswerText } from '../policy/index.js';
import { type AuthDeps, type Signed } from './session.js';

const personId = z.uuid();
const answer = z.object({ decision: z.enum(['approved', 'refused']) });
const money = z.string().regex(/^\d{1,6}(\.\d{1,8})?$/);
const limit = z.object({ limitUsd: money });
/** Null goes back to the install's step. A step of 0 would raise nothing. */
const step = z.object({
  amountUsd: money.refine((value) => Number(value) > 0).nullable(),
});
const taskCap = z.object({ cap: z.number().int().min(1).max(1000).nullable() });

type Admin = Signed['Variables']['session'];

/**
 * One admin-only setting on a person. Decided by the database: a member is refused (403, and the
 * attempt is audited there), and the admin hears 404 for someone outside their workspace.
 */
function setting<T>(
  { routes, db }: { routes: Hono<Signed>; db: AuthDeps['db'] },
  path: 'budget' | 'task-cap' | 'topup-step',
  schema: z.ZodType<T>,
  apply: (admin: Admin, id: string, body: T) => Promise<boolean>,
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

  setting({ routes, db }, 'budget', limit, (admin, id, body) =>
    setBudget(db, admin, id, body.limitUsd),
  );
  setting({ routes, db }, 'task-cap', taskCap, (admin, id, body) =>
    setTaskCap(db, admin, id, body.cap),
  );
  setting({ routes, db }, 'topup-step', step, (admin, id, body) =>
    setTopupStep(db, admin, id, body.amountUsd ?? undefined),
  );

  // The requests still waiting for an answer.
  routes.get('/admin/topups', async (c) => {
    const session = c.get('session');
    if (!(await isAdmin(db, session))) return c.json({ error: 'forbidden' }, 403);
    return c.json({ topups: await listWaitingTopups(db, session) });
  });
}

/**
 * The same question Telegram shows: an answer counts once, whichever side gives it first (M2-15c).
 * A member is refused (and the attempt audited) before anything else is said.
 */
export function topupAnswerRoute(routes: Hono<Signed>, { db, logger, tellMember }: AuthDeps): void {
  routes.post('/admin/topups/:id', async (c) => {
    const session = c.get('session');
    const id = personId.safeParse(c.req.param('id'));
    const body = answer.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success || !body.success) {
      return (await isAdmin(db, session))
        ? c.json({ error: 'invalid_request' }, 400)
        : c.json({ error: 'forbidden' }, 403);
    }
    const { decision } = body.data;
    const done = await answerTopup(db, session, id.data, decision);
    if (done === undefined) {
      return (await isAdmin(db, session))
        ? c.json({ error: 'not_open' }, 404)
        : c.json({ error: 'forbidden' }, 403);
    }
    const text = topupAnswerText(decision === 'approved' ? 'approved' : 'denied', done.amountUsd);
    await tellMember?.(done.channel, done.chatId, text).catch(() => {
      logger.warn({ topupId: id.data }, 'top-up reply not sent');
    });
    return c.json({ amountUsd: done.amountUsd, decision });
  });
}
