import type { ChannelAdapter, WebChannel } from './channels/index.js';
import type { Db } from './data/index.js';
import { type Approvals, createApprovals } from './policy/index.js';

/** The turn waits for the owner inside its time limit, so a question closes before the turn does. */
const APPROVAL_TTL_MS = 90_000;

/** Questions to the owner go out on the chat they came from: Telegram buttons or a web event. */
export const approvalsFor = (
  db: Db,
  telegram: ChannelAdapter | undefined,
  web: WebChannel,
): Approvals =>
  createApprovals({
    db,
    ttlMs: APPROVAL_TTL_MS,
    closed: ({ caller, id, outcome }) =>
      caller.channel === 'web' ? web.approvalClosed(caller.chatId, id, outcome) : Promise.resolve(),
    prompt: ({ caller, text, id }) => {
      if (caller.channel === 'web') return web.askApproval(caller.chatId, text, id);
      return telegram !== undefined && caller.channel === 'telegram'
        ? telegram.askApproval(caller.chatId, text, id)
        : Promise.reject(new Error('This channel cannot ask for approval yet'));
    },
  });
