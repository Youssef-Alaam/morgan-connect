import { Hono } from 'hono';
import type { Logger } from '../ops/index.js';

export interface AppDeps {
  /** Resolves to the database server version, or rejects when the database is unreachable. */
  dbVersion: () => Promise<string>;
  logger: Logger;
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
  return app;
}
