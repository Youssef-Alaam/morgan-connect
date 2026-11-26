import type { Identity } from '../identity/index.js';
import type { Logger } from '../ops/index.js';
import type { InboundMessage } from './message.js';

export interface GateDeps {
  identity: Identity;
  senders: readonly { channel: string; send: (chatId: string, text: string) => Promise<void> }[];
  logger: Logger;
}

/** `/start <code>` or `/start@BotName <code>`. */
const START_WITH_CODE = /^\/start(?:@\w+)?\s+(\S+)\s*$/;
const START_ANY = /^\/start(?:@\w+)?(?:\s|$)/;
const LINK_WITH_CODE = /^\/link(?:@\w+)?\s+(\S+)\s*$/;
const LINK_ANY = /^\/link(?:@\w+)?(?:\s|$)/;
const LINKED_REPLY = 'Linked. This chat is now the admin.';
const DEVICE_REPLY = 'Linked. This chat is now one of your devices.';

/** Tell the chat it is linked. A failed send changes nothing: the link stands. */
async function confirm(deps: GateDeps, message: InboundMessage, reply: string): Promise<void> {
  const sender = deps.senders.find((s) => s.channel === message.channel);
  await sender?.send(message.chatId, reply).catch(() => {
    deps.logger.warn({ channel: message.channel }, 'link confirmation not sent');
  });
}

/**
 * The gate in front of turn creation. True: a linked chat, make a turn. False: stop here.
 * An unlinked chat gets no reply at all, except the one confirmation for a good code: a wrong,
 * spent, expired or rate-limited code looks exactly like any other message.
 */
export async function admit(deps: GateDeps, message: InboundMessage): Promise<boolean> {
  const { channel, chatId, text } = message;
  if (await deps.identity.isLinked(channel, chatId)) {
    // A used code must never reach turns.text.
    return !START_ANY.test(text) && !LINK_ANY.test(text);
  }
  const setup = START_WITH_CODE.exec(text)?.[1];
  if (setup !== undefined) {
    if ((await deps.identity.claim(channel, chatId, setup)) !== 'claimed') return false;
    deps.logger.info({ channel }, 'install claimed');
    await confirm(deps, message, LINKED_REPLY);
    return false;
  }
  const link = LINK_WITH_CODE.exec(text)?.[1];
  if (link !== undefined && (await deps.identity.link(channel, chatId, link)) === 'claimed') {
    deps.logger.info({ channel }, 'chat linked');
    await confirm(deps, message, DEVICE_REPLY);
  }
  return false;
}
