import { Bot } from 'grammy';
import { z } from 'zod';
import type { InboundMessage } from '../core/index.js';
import type { Logger } from '../ops/index.js';
import type { ChannelAdapter } from './adapter.js';

const SEND_TIMEOUT_MS = 30_000;

const updateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    text: z.string(),
    chat: z.object({ id: z.number() }),
  }),
});

/** Turn a raw Telegram update into the internal message, or undefined if it is not a text message. */
export function parseTelegramUpdate(update: unknown): InboundMessage | undefined {
  const result = updateSchema.safeParse(update);
  if (!result.success) return undefined;
  const { message } = result.data;
  return {
    channel: 'telegram',
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    text: message.text,
  };
}

/** Telegram over long polling (grammY). Text messages only for now. */
export function createTelegramAdapter(
  token: string,
  logger: Logger,
  apiRoot?: string,
): ChannelAdapter {
  const bot = new Bot(token, apiRoot === undefined ? {} : { client: { apiRoot } });
  return {
    channel: 'telegram',
    send: async (chatId, text) => {
      // Keeps one send from outliving the queue's job expiry.
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Telegram send timed out'));
        }, SEND_TIMEOUT_MS).unref();
      });
      await Promise.race([bot.api.sendMessage(chatId, text), timeout]);
    },
    start: async (onMessage) => {
      bot.on('message', async (ctx) => {
        const message = parseTelegramUpdate(ctx.update);
        if (message !== undefined) await onMessage(message);
      });
      bot.catch((error) => {
        logger.error(
          { kind: error.error instanceof Error ? error.error.name : 'unknown' },
          'update failed',
        );
      });
      await new Promise<void>((resolve, reject) => {
        bot
          .start({
            onStart: (info) => {
              logger.info({ bot: info.username }, 'polling started');
              resolve();
            },
          })
          .catch(reject);
      });
    },
    stop: () => bot.stop(),
  };
}
