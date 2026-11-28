import { type Hono } from 'hono';
import { z } from 'zod';
import { isAdmin, providersState, setRoute } from '../data/index.js';
import { type AuthDeps, type ProvidersConfig, type Signed } from './session.js';

/** The last four characters of a key, or nothing when the key is too short to show any of it safely. */
export const keyHint = (key: string | undefined): string | null =>
  key === undefined || key.length < 16 ? null : key.slice(-4);

const switchBody = z.object({ enabled: z.boolean() });

/**
 * The admin's providers and channels page (M2-15e): each configured route with its key hint and
 * switch, and each channel with the last message it received. The database decides who may read or
 * switch; a member is refused (403) and the attempt is audited there.
 */
export function providerRoutes(routes: Hono<Signed>, { db, providers }: AuthDeps): void {
  const known = providers?.routes ?? [];
  routes.get('/admin/providers', async (c) => {
    const state = await providersState(db, c.get('session'));
    if (state === undefined) return c.json({ error: 'forbidden' }, 403);
    const switched = new Map(state.routes.map((r) => [r.id, r.enabled]));
    const last = new Map(state.channels.map((ch) => [ch.id, ch.lastMessageAt]));
    const channel = (id: string, configured: boolean) => ({
      id,
      configured,
      lastMessageAt: last.get(id) ?? null,
    });
    return c.json({
      routes: known.map((r) => ({ ...r, enabled: switched.get(r.id) ?? true })),
      channels: [channel('telegram', providers?.telegram === true), channel('web', true)],
    });
  });

  routes.put('/admin/providers/:id', async (c) => {
    const session = c.get('session');
    const id = c.req.param('id');
    const body = switchBody.safeParse(await c.req.json().catch(() => undefined));
    if (!(await isAdmin(db, session))) {
      await setRoute(db, session, id, body.success ? body.data.enabled : true).catch(() => false);
      return c.json({ error: 'forbidden' }, 403);
    }
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    if (!known.some((r) => r.id === id)) return c.json({ error: 'not_found' }, 404);
    return (await setRoute(db, session, id, body.data.enabled))
      ? c.body(null, 204)
      : c.json({ error: 'forbidden' }, 403);
  });
}

/** What the providers page shows, from config. Keys are cut to their last four characters here; nothing longer travels on. */
export function providersFrom(config: {
  ENGINE: 'pi' | 'http';
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_MODEL: string;
  ENGINE_TOKEN?: string | undefined;
  TELEGRAM_BOT_TOKEN?: string | undefined;
}): ProvidersConfig {
  const http = config.ENGINE === 'http';
  const key = http ? config.ENGINE_TOKEN : config.ANTHROPIC_API_KEY;
  const route = http
    ? { id: 'http', provider: 'Your own engine', model: 'http-engine' }
    : { id: 'anthropic', provider: 'Anthropic', model: config.ANTHROPIC_MODEL };
  return {
    routes: http || key !== undefined ? [{ ...route, keyLast4: keyHint(key) }] : [],
    telegram: config.TELEGRAM_BOT_TOKEN !== undefined,
  };
}
