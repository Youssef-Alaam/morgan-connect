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
const LINKED_REPLY = 'Linked. This chat is now the admin.';

/**
 * The gate in front of turn creation. True: a linked chat, make a turn. False: stop here.
 * An unlinked chat gets no reply at all, except the one confirmation for a good setup code.
 */
export async function admit(deps: GateDeps, message: InboundMessage): Promise<boolean> {
  if (await deps.identity.isLinked(message.channel, message.chatId)) {
    // A used code must never reach turns.text.
    return !START_ANY.test(message.text);
  }
  const code = START_WITH_CODE.exec(message.text)?.[1];
  if (code === undefined) return false;
  const result = await deps.identity.claim(message.channel, message.chatId, code);
  if (result !== 'claimed') return false;
  deps.logger.info({ channel: message.channel }, 'install claimed');
  const sender = deps.senders.find((s) => s.channel === message.channel);
  await sender?.send(message.chatId, LINKED_REPLY).catch(() => {
    deps.logger.warn({ channel: message.channel }, 'claim confirmation not sent');
  });
  return false;
}
