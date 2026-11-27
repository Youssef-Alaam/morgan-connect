import { PgBoss } from 'pg-boss';

/**
 * The queue's name; it was 'turn' (policy standard). pg-boss cannot change a policy, so the
 * one-waiting-job-per-turn policy needs a new name. Boot re-queues every queued turn into it.
 */
const QUEUE = 'turns';

/** A turn held back by its person's cap is looked at again after this many seconds. */
const DEFER_SECONDS = 2;

/** A job running longer than this is taken as dead and handed out again. */
export const TURN_EXPIRE_SECONDS = 300;

export interface TurnQueue {
  /** A job running longer than this is redelivered, so a turn claimed longer ago is dead. */
  readonly expireInSeconds: number;
  start: () => Promise<void>;
  enqueue: (turnId: string) => Promise<void>;
  /**
   * Run `handler` for each queued turn id. A thrown error makes the queue redeliver the job; a
   * handler that answers `'later'` has not started the turn, so it is queued again after a pause.
   */
  work: (handler: (turnId: string) => Promise<'later' | undefined>) => Promise<void>;
  /** Graceful waits for running jobs; otherwise the process is treated as killed mid-job. */
  stop: (options?: { graceful: boolean }) => Promise<void>;
}

/** Tests shorten both to see a killed worker's job redelivered. */
export interface QueueTuning {
  expireInSeconds: number;
  superviseIntervalSeconds: number;
}

/** Install or upgrade the queue's tables. Run as the owner role, so the app role never needs CREATE on the database. */
export async function installQueueSchema(ownerUrl: string): Promise<void> {
  const boss = new PgBoss({ connectionString: ownerUrl });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.stop({ graceful: false });
}

/** The job queue (pg-boss) on the same Postgres, in its own `pgboss` schema. */
export function createTurnQueue(
  databaseUrl: string,
  onError: (error: Error) => void,
  tuning?: QueueTuning,
  options: { schemaInstalled: boolean } = { schemaInstalled: false },
): TurnQueue {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    // Wake the worker the moment a turn is queued; the default poll waits up to 2 s (perf budget).
    useListenNotify: true,
    // Installed by the owner role already: the app role has no right to create or alter it.
    ...(options.schemaInstalled ? { createSchema: false, migrate: false } : {}),
    ...(tuning === undefined ? {} : { superviseIntervalSeconds: tuning.superviseIntervalSeconds }),
  });
  boss.on('error', onError);
  const expireInSeconds = tuning?.expireInSeconds ?? TURN_EXPIRE_SECONDS;
  return {
    expireInSeconds,
    start: async () => {
      await boss.start();
      await boss.createQueue(QUEUE, {
        notify: true,
        // One redelivery is enough: a redelivered turn is claimed once and never re-sent, and
        // failed sends already retry in-process. More job retries would only repeat that no-op.
        retryLimit: 1,
        retryDelay: 5,
        expireInSeconds,
        // One waiting job per turn (see singletonKey below).
        policy: 'short',
      });
      // createQueue leaves an existing queue alone, so turn notify on for installs made before it.
      await boss.updateQueue(QUEUE, { notify: true });
    },
    enqueue: async (turnId) => {
      // A turn has one waiting job: a restart or a redelivery adds no second one.
      await boss.send(QUEUE, { turnId }, { singletonKey: turnId });
    },
    work: async (handler) => {
      // With notify on, polling is only a backstop and would default to 30 s: keep it short.
      await boss.work<{ turnId: string }>(
        QUEUE,
        { notifyPollingIntervalSeconds: 2 },
        async (jobs) => {
          for (const job of jobs) {
            if ((await handler(job.data.turnId)) === 'later') {
              // No id back means a waiting job for this turn already exists: that is the one to keep.
              await boss.send(QUEUE, job.data, {
                startAfter: DEFER_SECONDS,
                singletonKey: job.data.turnId,
              });
            }
          }
        },
      );
    },
    stop: (options) => boss.stop({ graceful: options?.graceful ?? true, timeout: 10_000 }),
  };
}
