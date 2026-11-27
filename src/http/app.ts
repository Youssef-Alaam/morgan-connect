import { Hono } from 'hono';
import type { Logger } from '../ops/index.js';
import { authRoutes } from './auth.js';
import type { ChatDeps } from './chat.js';
import { API_PREFIX, type AuthDeps } from './session.js';
import { webRoutes } from './web.js';

export interface AppDeps {
  /** Resolves to the database server version, or rejects when the database is unreachable. */
  dbVersion: () => Promise<string>;
  logger: Logger;
  /** The web account API (`/api/*`); left out, there are no web accounts. */
  auth?: Omit<AuthDeps, 'logger'>;
  /** The web chat (`/api/chat`), behind the same session gate; needs `auth`. */
  chat?: Omit<ChatDeps, 'logger' | 'db'>;
  /** The built web app (`web/dist`), served for every page path; left out, only the API answers. */
  webDir?: string;
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
    app.route(
      API_PREFIX,
      authRoutes(
        { ...deps.auth, logger: deps.logger },
        deps.chat && { ...deps.chat, logger: deps.logger },
      ),
    );
    app.onError((error, c) => {
      deps.logger.error({ err: error }, 'request failed');
      return c.json({ error: 'server_error' }, 500);
    });
  }
  if (deps.webDir !== undefined) app.route('/', webRoutes(deps.webDir));
  return app;
}
