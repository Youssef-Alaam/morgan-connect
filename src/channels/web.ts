import type { ChannelSender } from '../core/index.js';
import {
  ownerOf,
  recordWebEvent,
  webEventsAfter,
  type Db,
  type Owner,
  type WebEvent,
} from '../data/index.js';

/** The web chat: a browser session is a device; its events are stored, then pushed to its stream. */
export interface WebChannel extends ChannelSender {
  readonly channel: 'web';
  /** Show the owner's question as an `approval` event: `text` holds the exact arguments. */
  askApproval: NonNullable<ChannelSender['askApproval']>;
  /** Show that a question is over (`outcome` is the word); a session that ended has nothing to show. */
  approvalClosed: (chatId: string, approvalId: string, outcome: string) => Promise<void>;
  /** Note that a posted message arrived, keeping its text so a reload shows it. A resent message is noted once. */
  acknowledge: (owner: Owner, chatId: string, messageId: string, text: string) => Promise<void>;
  /** This person's events on one session after `afterId`, oldest first. */
  eventsAfter: (owner: Owner, chatId: string, afterId: string) => Promise<WebEvent[]>;
  /** Call `wake` whenever the session gets an event. Returns the way to stop. */
  subscribe: (owner: Owner, chatId: string, wake: () => void) => () => void;
}

/** The person is part of the key, so a stream cannot be aimed at another person's session. */
const keyOf = (owner: Owner, chatId: string): string => `${owner.userId}:${chatId}`;

export function createWebChannel(db: Db): WebChannel {
  const listeners = new Map<string, Set<() => void>>();
  const notify = (owner: Owner, chatId: string): void => {
    for (const wake of listeners.get(keyOf(owner, chatId)) ?? []) wake();
  };
  return {
    channel: 'web',
    send: async (chatId, text) => {
      const owner = await ownerOf(db, { channel: 'web', chatId });
      if (owner === undefined) throw new Error('The web session has ended');
      await recordWebEvent(db, owner, chatId, { kind: 'message', text });
      notify(owner, chatId);
    },
    askApproval: async (chatId, text, approvalId) => {
      const owner = await ownerOf(db, { channel: 'web', chatId });
      if (owner === undefined) throw new Error('The web session has ended');
      await recordWebEvent(db, owner, chatId, { kind: 'approval', ref: approvalId, text });
      notify(owner, chatId);
    },
    approvalClosed: async (chatId, approvalId, outcome) => {
      const owner = await ownerOf(db, { channel: 'web', chatId });
      if (owner === undefined) return;
      await recordWebEvent(db, owner, chatId, {
        kind: 'approval_closed',
        ref: approvalId,
        text: outcome,
      });
      notify(owner, chatId);
    },
    acknowledge: async (owner, chatId, messageId, text) => {
      const stored = await recordWebEvent(db, owner, chatId, {
        kind: 'ack',
        ref: messageId,
        text,
      });
      if (stored !== undefined) notify(owner, chatId);
    },
    eventsAfter: (owner, chatId, afterId) => webEventsAfter(db, owner, chatId, afterId),
    subscribe: (owner, chatId, wake) => {
      const key = keyOf(owner, chatId);
      const set = listeners.get(key) ?? new Set<() => void>();
      set.add(wake);
      listeners.set(key, set);
      return () => {
        set.delete(wake);
        if (set.size === 0) listeners.delete(key);
      };
    },
  };
}
