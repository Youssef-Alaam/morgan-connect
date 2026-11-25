import { PgBoss } from 'pg-boss';

const QUEUE = 'turn';

export interface TurnQueue {
  start: () => Promise<void>;
  enqueue: (turnId: string) => Promise<void>;
  /** Run `handler` for each queued turn id. A thrown error makes the queue redeliver the job. */
  work: (handler: (turnId: string) => Promise<void>) => Promise<void>;
  /** Graceful waits for running jobs; otherwise the process is treated as killed mid-job. */
  stop: (options?: { graceful: boolean }) => Promise<void>;
}

/** Tests shorten both to see a killed worker's job redelivered. */
export interface QueueTuning {
  expireInSeconds: number;
  superviseIntervalSeconds: number;
}

/** The job queue (pg-boss) on the same Postgres, in its own `pgboss` schema. */
export function createTurnQueue(
  databaseUrl: string,
  onError: (error: Error) => void,
  tuning?: QueueTuning,
): TurnQueue {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    ...(tuning === undefined ? {} : { superviseIntervalSeconds: tuning.superviseIntervalSeconds }),
  });
  boss.on('error', onError);
  return {
    start: async () => {
      await boss.start();
      await boss.createQueue(QUEUE, {
        // One redelivery is enough: a redelivered turn is claimed once and never re-sent, and
        // failed sends already retry in-process. More job retries would only repeat that no-op.
        retryLimit: 1,
        retryDelay: 5,
        expireInSeconds: tuning?.expireInSeconds ?? 300,
      });
    },
    enqueue: async (turnId) => {
      await boss.send(QUEUE, { turnId });
    },
    work: async (handler) => {
      await boss.work<{ turnId: string }>(QUEUE, async (jobs) => {
        for (const job of jobs) await handler(job.data.turnId);
      });
    },
    stop: (options) => boss.stop({ graceful: options?.graceful ?? true, timeout: 10_000 }),
  };
}
