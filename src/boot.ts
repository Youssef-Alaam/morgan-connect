import { serve } from '@hono/node-server';
import { createDb, dbVersion, migrateToLatest } from './data/index.js';
import { createApp } from './http/index.js';
import { createLogger, loadConfig } from './ops/index.js';

export interface Running {
  port: number;
  stop: () => Promise<void>;
}

/** Load config, migrate the database, then serve HTTP. */
export async function start(env: Record<string, string | undefined>): Promise<Running> {
  const config = loadConfig(env);
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDb(config.DATABASE_URL);
  try {
    logger.info({ applied: await migrateToLatest(db) }, 'migrations done');
  } catch (error) {
    await db.destroy();
    throw error;
  }
  const app = createApp({ dbVersion: () => dbVersion(db), logger });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const listening = serve({ fetch: app.fetch, port: config.PORT }, () => {
      resolve(listening);
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.PORT;
  logger.info({ port }, 'listening');
  return {
    port,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
      await db.destroy();
    },
  };
}
