import { PgBoss } from 'pg-boss';

const QUEUE = 'turn';

export interface TurnQueue {
  start: () => Promise<void>;
  enqueue: (turnId: string) => Promise<void>;
  /** Run `handler` for each queued turn id. A thrown error makes the queue redeliver the job. */
  work: (handler: (turnId: string) => Promise<void>) => Promise<void>;
  stop: () => Promise<void>;
}

/** The job queue (pg-boss) on the same Postgres, in its own `pgboss` schema. */
export function createTurnQueue(databaseUrl: string, onError: (error: Error) => void): TurnQueue {
  const boss = new PgBoss(databaseUrl);
  boss.on('error', onError);
  return {
    start: async () => {
      await boss.start();
      await boss.createQueue(QUEUE, { retryLimit: 3, retryDelay: 5, expireInSeconds: 300 });
    },
    enqueue: async (turnId) => {
      await boss.send(QUEUE, { turnId });
    },
    work: async (handler) => {
      await boss.work<{ turnId: string }>(QUEUE, async (jobs) => {
        for (const job of jobs) await handler(job.data.turnId);
      });
    },
    stop: () => boss.stop({ graceful: true, timeout: 10_000 }),
  };
}
