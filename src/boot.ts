import { serve } from '@hono/node-server';
import { type ChannelAdapter, createTelegramAdapter } from './channels/index.js';
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
  closeOrphanedApprovals,
  ensureAppRole,
  installQueueSchema,
  migrateToLatest,
  type Db,
  type TurnQueue,
} from './data/index.js';
import { createApp } from './http/index.js';
import {
  createAnthropicEngine,
  createApprovals,
  createGate,
  createHttpEngine,
  type Approvals,
  type Engine,
} from './policy/index.js';
import { type Config, createLogger, loadConfig, type Logger } from './ops/index.js';

const TIMING = { retryDelayMs: 2000, typingIntervalMs: 4000, turnTimeoutMs: 120_000 };
/** The turn waits for the owner inside its time limit, so a question closes before the turn does. */
const APPROVAL_TTL_MS = 90_000;

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

interface ReplierParts {
  db: Db;
  logger: Logger;
  engine: Engine | undefined;
  approvals: Approvals;
}

/** The model that answers: the one passed in, else the one the config names, else none (echo). */
function buildReplier(
  config: Config,
  { db, logger, engine, approvals }: ReplierParts,
): Replier | undefined {
  const model = engine ?? chooseEngine(config);
  return model === undefined
    ? undefined
    : createReplier({
        db,
        logger,
        engine: model,
        model: config.ENGINE === 'http' ? 'http-engine' : config.ANTHROPIC_MODEL,
        gate: createGate({
          db,
          logger,
          timezone: config.TIMEZONE,
          approvals,
          demo: config.DEMO_TOOLS,
        }),
        timezone: config.TIMEZONE,
        ...TIMING,
      });
}

async function openQueue(config: Config, logger: Logger): Promise<TurnQueue> {
  const queue = createTurnQueue(
    config.DATABASE_URL,
    (error) => {
      logger.error({ kind: error.name }, 'queue error');
    },
    undefined,
    { schemaInstalled: ownerUrl(config) !== undefined },
  );
  await queue.start();
  return queue;
}

/** Questions to the owner go out as a Telegram message with Approve and Deny buttons. */
const telegramApprovals = (db: Db, telegram: ChannelAdapter): Approvals =>
  createApprovals({
    db,
    ttlMs: APPROVAL_TTL_MS,
    prompt: ({ caller, text, id }) => telegram.askApproval(caller.chatId, text, id),
  });

/** With a Telegram token set, start the queue, the worker and the poller. Returns its stop. */
async function startTelegram(
  config: Config,
  db: Db,
  logger: Logger,
  engine: Engine | undefined,
): Promise<() => Promise<void>> {
  if (config.TELEGRAM_BOT_TOKEN === undefined) return () => Promise.resolve();
  assertFitsJobExpiry(TIMING, TURN_EXPIRE_SECONDS);
  const queue = await openQueue(config, logger);
  const telegram = createTelegramAdapter(
    config.TELEGRAM_BOT_TOKEN,
    logger,
    config.TELEGRAM_API_ROOT,
  );
  const identity = createIdentity(db);
  const approvals = telegramApprovals(db, telegram);
  const reply = buildReplier(config, { db, logger, engine, approvals });
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
    await closeOrphanedApprovals(db);
    await announceSetupCode(identity, logger);
    await startWorker(deps);
    await requeueStuckTurns(deps);
    await telegram.start(
      (message) => ingest(deps, message),
      (answer) => approvals.decide(answer.id, answer.decision, answer),
    );
  } catch (error) {
    await queue.stop();
    throw error;
  }
  return async () => {
    await telegram.stop();
    await queue.stop();
  };
}

/** The owner connection, when it is a different one from the app's. */
function ownerUrl(config: Config): string | undefined {
  const url = config.MIGRATION_DATABASE_URL;
  return url === config.DATABASE_URL ? undefined : url;
}

/**
 * Migrate the database, then open the app's connection. With MIGRATION_DATABASE_URL the owner role
 * migrates and sets up the app role, and the app never holds owner rights; without it one role
 * does both, which leaves the audit log guarded by triggers only (docs/adr/0008-audit-log-guards.md).
 */
async function openDatabase(config: Config, logger: Logger): Promise<Db> {
  const separateUrl = ownerUrl(config);
  const separate = separateUrl !== undefined;
  const owner = createDb(separate ? separateUrl : config.DATABASE_URL);
  try {
    logger.info({ applied: await migrateToLatest(owner) }, 'migrations done');
    if (separate) {
      // The owner installs the queue's tables, so the app role needs no right to create schemas.
      if (config.TELEGRAM_BOT_TOKEN !== undefined) await installQueueSchema(separateUrl);
      await ensureAppRole(owner, config.DATABASE_URL);
    } else logger.warn('MIGRATION_DATABASE_URL is not set: the app runs as the owner role');
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
