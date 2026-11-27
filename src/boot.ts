import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { type ChannelAdapter, createTelegramAdapter, createWebChannel } from './channels/index.js';
import {
  assertFitsJobExpiry,
  createReplier,
  createTurnAborts,
  ingest,
  type Replier,
  requeueStuckTurns,
  startWorker,
} from './core/index.js';
import { announceAdminLink, createIdentity, type Identity } from './identity/index.js';
import {
  TURN_EXPIRE_SECONDS,
  createDb,
  createTurnQueue,
  dbVersion,
  closeOrphanedApprovals,
  assertRlsApplies,
  ensureAppRole,
  installQueueSchema,
  migrateToLatest,
  type Db,
  type TurnQueue,
} from './data/index.js';
import { type AppDeps, type ChatDeps, createApp } from './http/index.js';
import {
  createAnthropicEngine,
  createApprovals,
  createGate,
  createHttpEngine,
  type Approvals,
  type Engine,
  type VaultOptions,
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

/** The vault tool is registered only when its URL and token are both set. */
function vaultFrom(config: Config): { vault?: VaultOptions } {
  const { VAULT_REMOTE_URL: remoteUrl, VAULT_TOKEN: token } = config;
  if (remoteUrl === undefined || token === undefined) return {};
  const dir = config.VAULT_DIR ?? join(tmpdir(), 'morgan-vault');
  return { vault: { remoteUrl, token, branch: config.VAULT_BRANCH, dir } };
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
          ...vaultFrom(config),
        }),
        timezone: config.TIMEZONE,
        // TODO(M2-10b+): 'own' once a person can bring their own key or subscription (D46).
        budget: { keySource: 'admin', defaultLimitUsd: config.DEFAULT_MONTHLY_LIMIT_USD },
        idleGapMs: config.IDLE_GAP_MINUTES * 60_000,
        compactAtTokens: config.COMPACT_AT_TOKENS,
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

/** Questions to the owner go out on the chat they came from; only Telegram can ask yet (web: M2-12b). */
const approvalsFor = (db: Db, telegram: ChannelAdapter | undefined): Approvals =>
  createApprovals({
    db,
    ttlMs: APPROVAL_TTL_MS,
    prompt: ({ caller, text, id }) =>
      telegram !== undefined && caller.channel === 'telegram'
        ? telegram.askApproval(caller.chatId, text, id)
        : Promise.reject(new Error('This channel cannot ask for approval yet')),
  });

interface Chat {
  /** The web chat's way into the pipeline, the same one Telegram uses. */
  chat: Omit<ChatDeps, 'logger' | 'db'>;
  stop: () => Promise<void>;
}

/** Start the queue, the worker and the web chat; with a Telegram token also the poller. */
async function startChat(
  config: Config,
  db: Db,
  logger: Logger,
  { engine, onClaimed }: { engine: Engine | undefined; onClaimed: () => Promise<void> },
): Promise<Chat> {
  assertFitsJobExpiry(TIMING, TURN_EXPIRE_SECONDS);
  const queue = await openQueue(config, logger);
  const telegram =
    config.TELEGRAM_BOT_TOKEN === undefined
      ? undefined
      : createTelegramAdapter(config.TELEGRAM_BOT_TOKEN, logger, config.TELEGRAM_API_ROOT);
  const web = createWebChannel(db);
  const identity = createIdentity(db, { onClaimed });
  const approvals = approvalsFor(db, telegram);
  const reply = buildReplier(config, { db, logger, engine, approvals });
  const aborts = createTurnAborts();
  const senders = telegram === undefined ? [web] : [telegram, web];
  const deps = { db, queue, senders, logger, retryDelayMs: 1000, identity, reply, aborts };
  try {
    await closeOrphanedApprovals(db);
    await startWorker(deps);
    await requeueStuckTurns(deps);
    if (telegram !== undefined) {
      await announceSetupCode(identity, logger);
      await telegram.start(
        (message) => ingest(deps, message),
        (answer) => approvals.decide(answer.id, answer.decision, answer),
      );
    }
  } catch (error) {
    await queue.stop();
    throw error;
  }
  return {
    chat: { events: web, ingest: (message) => ingest(deps, message) },
    stop: async () => {
      await telegram?.stop();
      await queue.stop();
    },
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
 * Either way the app refuses to run as a superuser or BYPASSRLS role: row-level security would be off.
 */
async function openDatabase(config: Config, logger: Logger): Promise<Db> {
  const separateUrl = ownerUrl(config);
  const separate = separateUrl !== undefined;
  const onConnectionError = (error: Error): void => {
    logger.error(
      { kind: error.name, code: (error as { code?: string }).code, message: error.message },
      'database connection error',
    );
  };
  const owner = createDb(separate ? separateUrl : config.DATABASE_URL, onConnectionError);
  try {
    logger.info({ applied: await migrateToLatest(owner) }, 'migrations done');
    if (separate) {
      // The owner installs the queue's tables, so the app role needs no right to create schemas.
      await installQueueSchema(separateUrl);
      await ensureAppRole(owner, config.DATABASE_URL);
    } else logger.warn('MIGRATION_DATABASE_URL is not set: the app runs as the owner role');
  } catch (error) {
    await owner.destroy();
    throw error;
  }
  const app = separate ? createDb(config.DATABASE_URL, onConnectionError) : owner;
  if (separate) await owner.destroy();
  try {
    await assertRlsApplies(app);
  } catch (error) {
    await app.destroy();
    throw error;
  }
  return app;
}

/** Serve the app; resolves once the port is open. */
function listen(
  app: ReturnType<typeof createApp>,
  port: number,
): Promise<ReturnType<typeof serve>> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () => {
      resolve(server);
    });
  });
}

/** The optional sign-in features the config switches on: the second-factor key and passkeys. */
function signInSettings(
  config: Config,
): Pick<NonNullable<AppDeps['auth']>, 'twoFactorKey' | 'passkeys'> {
  const { TWO_FACTOR_KEY: key, WEBAUTHN_RP_ID: rpId, WEBAUTHN_ORIGIN: origin } = config;
  return {
    twoFactorKey: key === undefined ? undefined : Buffer.from(key, 'base64'),
    passkeys: rpId === undefined || origin === undefined ? undefined : { rpId, origin },
  };
}

/** Load config, migrate the database, then serve HTTP. Tests may pass their own engine. */
export async function start(
  env: Record<string, string | undefined>,
  options: { engine?: Engine } = {},
): Promise<Running> {
  const config = loadConfig(env);
  const logger = createLogger(config.LOG_LEVEL);
  const db = await openDatabase(config, logger);
  let listening = config.PORT;
  const announce = async (): Promise<void> => {
    await announceAdminLink(
      db,
      logger,
      config.PUBLIC_URL ?? `http://localhost:${String(listening)}`,
    );
  };
  const chat = await startChat(config, db, logger, {
    engine: options.engine,
    onClaimed: announce,
  }).catch(async (error: unknown) => {
    await db.destroy();
    throw error;
  });
  const app = createApp({
    dbVersion: () => dbVersion(db),
    logger,
    auth: { db, ...signInSettings(config) },
    chat: chat.chat,
  });
  const server = await listen(app, config.PORT);
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.PORT;
  listening = port;
  logger.info({ port }, 'listening');
  await announce();
  return {
    port,
    stop: async () => {
      await chat.stop();
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
