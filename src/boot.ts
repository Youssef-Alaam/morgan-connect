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
  ensureAppRole,
  migrateToLatest,
  type Db,
} from './data/index.js';
import { createApp } from './http/index.js';
import {
  createAnthropicEngine,
  createGate,
  createHttpEngine,
  type Engine,
} from './policy/index.js';
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

/** The engine that answers: the one passed in, else the one set by ENGINE, else none (echo). */
function chooseEngine(config: Config): Engine | undefined {
  const { ENGINE_URL: url, ENGINE_TOKEN: token } = config;
  if (config.ENGINE === 'http' && url !== undefined && token !== undefined) {
    return createHttpEngine({ url, token });
  }
  const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: modelId } = config;
  return apiKey === undefined ? undefined : createAnthropicEngine({ apiKey, modelId });
}

/** The model that answers: the one passed in, else the one the config names, else none (echo). */
function buildReplier(
  config: Config,
  db: Db,
  logger: Logger,
  engine: Engine | undefined,
): Replier | undefined {
  const model = engine ?? chooseEngine(config);
  return model === undefined
    ? undefined
    : createReplier({
        db,
        logger,
        engine: model,
        model: config.ENGINE === 'http' ? 'http-engine' : config.ANTHROPIC_MODEL,
        gate: createGate({ db, logger, timezone: config.TIMEZONE }),
        timezone: config.TIMEZONE,
        ...TIMING,
      });
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

/**
 * Migrate the database, then open the app's connection. With MIGRATION_DATABASE_URL the owner role
 * migrates and sets up the app role, and the app never holds owner rights; without it one role
 * does both, which leaves the audit log guarded by triggers only (docs/adr/0008-audit-log-guards.md).
 */
async function openDatabase(config: Config, logger: Logger): Promise<Db> {
  const ownerUrl = config.MIGRATION_DATABASE_URL;
  const separate = ownerUrl !== undefined && ownerUrl !== config.DATABASE_URL;
  const owner = createDb(separate ? ownerUrl : config.DATABASE_URL);
  try {
    logger.info({ applied: await migrateToLatest(owner) }, 'migrations done');
    if (separate) await ensureAppRole(owner, config.DATABASE_URL);
    else logger.warn('MIGRATION_DATABASE_URL is not set: the app runs as the owner role');
  } catch (error) {
    await owner.destroy();
    throw error;
  }
  if (!separate) return owner;
  await owner.destroy();
  return createDb(config.DATABASE_URL);
}

/** Load config, migrate the database, then serve HTTP. Tests may pass their own engine. */
export async function start(
  env: Record<string, string | undefined>,
  options: { engine?: Engine } = {},
): Promise<Running> {
  const config = loadConfig(env);
  const logger = createLogger(config.LOG_LEVEL);
  const db = await openDatabase(config, logger);
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
