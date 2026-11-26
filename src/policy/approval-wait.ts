import { closeApproval, type Db, type Owner } from '../data/index.js';

type Answer = 'approved' | 'denied' | 'expired' | 'aborted';

export interface WaitingRoom {
  /** Pause until the question is answered, runs out of time, or the turn is aborted. */
  wait: (id: string, owner: Owner, signal: AbortSignal | undefined) => Promise<Answer>;
  /** Wake the turn waiting on this question with the owner's answer. */
  settle: (id: string, answer: Answer) => void;
  /** Give up on a question the owner can no longer be asked. */
  cancel: (id: string) => void;
}

/** The turns paused on a question, in memory: a restart ends them all (closeOrphanedApprovals). */
export function createWaitingRoom(db: Db, ttlMs: number): WaitingRoom {
  const waiting = new Map<string, (answer: Answer) => void>();
  /** Whose question each id is, so closing it runs as them. */
  const owners = new Map<string, Owner>();
  const settle = (id: string, answer: Answer): void => {
    waiting.get(id)?.(answer);
    waiting.delete(id);
  };

  /** Close the row first, so a tap that lands at the same moment cannot also win. */
  const giveUp = (id: string, status: 'expired' | 'cancelled', answer: Answer): void => {
    const owner = owners.get(id);
    if (owner === undefined) return;
    closeApproval(db, owner, id, status)
      .catch(() => false)
      .then((closed) => {
        if (closed || status === 'cancelled') settle(id, answer);
      })
      .catch(() => undefined);
  };

  return {
    settle,
    cancel: (id) => {
      giveUp(id, 'cancelled', 'aborted');
    },
    wait: async (id, owner, signal) => {
      owners.set(id, owner);
      const answered = new Promise<Answer>((resolve) => {
        waiting.set(id, resolve);
      });
      const timer = setTimeout(() => {
        giveUp(id, 'expired', 'expired');
      }, ttlMs);
      const abort = (): void => {
        giveUp(id, 'cancelled', 'aborted');
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted === true) abort();
      try {
        return await answered;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        waiting.delete(id);
        owners.delete(id);
      }
    },
  };
}
