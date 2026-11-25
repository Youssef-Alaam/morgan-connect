import { serve } from '@hono/node-server';
import { createTelegramAdapter } from './channels/index.js';
import {
  assertFitsJobExpiry,
  createReplier,
  createTurnAborts,
  ingest,
  type Replier,
  requeueStuckTurns,
  startWorker,
} from './core/index.js';
import { createIdentity, type Identity } from './identity/index.js';
import {
  TURN_EXPIRE_SECONDS,
  createDb,
  createTurnQueue,
  dbVersion,
  migrateToLatest,
  type Db,
} from './data/index.js';
import { createApp } from './http/index.js';
import { createAnthropicEngine, createGate, type Engine } from './policy/index.js';
import { type Config, createLogger, loadConfig, type Logger } from './ops/index.js';

const TIMING = { retryDelayMs: 2000, typingIntervalMs: 4000, turnTimeoutMs: 120_000 };

export interface Running {
  port: number;
  stop: () => Promise<void>;
}

/** While nobody has claimed the install, log a fresh one-time code (once per boot). */
async function announceSetupCode(identity: Identity, logger: Logger): Promise<void> {
  const code = await identity.issueSetupCode();
  if (code !== undefined) logger.info(`Setup code: send "/start ${code}" to the bot to claim it`);
}

/** The model that answers: the one passed in, else Claude when a key is set, else none (echo). */
function buildReplier(
  config: Config,
  db: Db,
  logger: Logger,
  engine: Engine | undefined,
): Replier | undefined {
  const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: modelId } = config;
  const model =
    engine ?? (apiKey === undefined ? undefined : createAnthropicEngine({ apiKey, modelId }));
  return model === undefined
    ? undefined
    : createReplier({ db, logger, engine: model, gate: createGate({ db, logger }), ...TIMING });
}

/** With a Telegram token set, start the queue, the worker and the poller. Returns its stop. */
async function startTelegram(
  config: Config,
  db: Db,
  logger: Logger,
  engine: Engine | undefined,
): Promise<() => Promise<void>> {
  if (config.TELEGRAM_BOT_TOKEN === undefined) return () => Promise.resolve();
  assertFitsJobExpiry(TIMING, TURN_EXPIRE_SECONDS);
  const queue = createTurnQueue(config.DATABASE_URL, (error) => {
    logger.error({ kind: error.name }, 'queue error');
  });
  await queue.start();
  const telegram = createTelegramAdapter(
    config.TELEGRAM_BOT_TOKEN,
    logger,
    config.TELEGRAM_API_ROOT,
  );
  const identity = createIdentity(db);
  const reply = buildReplier(config, db, logger, engine);
  const aborts = createTurnAborts();
  const deps = {
    db,
    queue,
    senders: [telegram],
    logger,
    retryDelayMs: 1000,
    identity,
    reply,
    aborts,
  };
  try {
    await announceSetupCode(identity, logger);
    await startWorker(deps);
    await requeueStuckTurns(deps);
    await telegram.start((message) => ingest(deps, message));
  } catch (error) {
    await queue.stop();
    throw error;
  }
  return async () => {
    await telegram.stop();
    await queue.stop();
  };
}

/** Load config, migrate the database, then serve HTTP. Tests may pass their own engine. */
export async function start(
  env: Record<string, string | undefined>,
  options: { engine?: Engine } = {},
): Promise<Running> {
  const config = loadConfig(env);
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDb(config.DATABASE_URL);
  try {
    logger.info({ applied: await migrateToLatest(db) }, 'migrations done');
  } catch (error) {
    await db.destroy();
    throw error;
  }
  const stopTelegram = await startTelegram(config, db, logger, options.engine).catch(
    async (error: unknown) => {
      await db.destroy();
      throw error;
    },
  );
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
      await stopTelegram();
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
