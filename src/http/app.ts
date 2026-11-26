import { Hono } from 'hono';
import type { Logger } from '../ops/index.js';
import { authRoutes } from './auth.js';
import { API_PREFIX, type AuthDeps } from './session.js';

export interface AppDeps {
  /** Resolves to the database server version, or rejects when the database is unreachable. */
  dbVersion: () => Promise<string>;
  logger: Logger;
  /** The web account API (`/api/*`); left out, there are no web accounts. */
  auth?: Omit<AuthDeps, 'logger'>;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/health', async (c) => {
    try {
      return c.json({ status: 'ok', db: await deps.dbVersion() });
    } catch (error) {
      deps.logger.error({ err: error }, 'health check failed');
      return c.json({ status: 'error' }, 503);
    }
  });
  if (deps.auth !== undefined) {
    app.route(API_PREFIX, authRoutes({ ...deps.auth, logger: deps.logger }));
    app.onError((error, c) => {
      deps.logger.error({ err: error }, 'request failed');
      return c.json({ error: 'server_error' }, 500);
    });
  }
  return app;
}
