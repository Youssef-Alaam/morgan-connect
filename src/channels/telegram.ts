import { Bot } from 'grammy';
import type { Logger } from '../ops/index.js';
import type { ChannelAdapter } from './adapter.js';

/** Telegram over long polling (grammY). Text messages only for now. */
export function createTelegramAdapter(token: string, logger: Logger): ChannelAdapter {
  const bot = new Bot(token);
  return {
    channel: 'telegram',
    send: async (chatId, text) => {
      await bot.api.sendMessage(chatId, text);
    },
    start: async (onMessage) => {
      bot.on('message:text', (ctx) =>
        onMessage({
          channel: 'telegram',
          chatId: String(ctx.chat.id),
          messageId: String(ctx.message.message_id),
          text: ctx.message.text,
        }),
      );
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
