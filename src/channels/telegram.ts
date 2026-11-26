import { Bot, type Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import type { InboundMessage } from '../core/index.js';
import type { Logger } from '../ops/index.js';
import type { ApprovalAnswer, ChannelAdapter } from './adapter.js';

const SEND_TIMEOUT_MS = 30_000;

const updateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    text: z.string(),
    chat: z.object({ id: z.number() }),
  }),
});

const callbackSchema = z.object({
  update_id: z.number(),
  callback_query: z.object({
    data: z.string(),
    message: z.object({ chat: z.object({ id: z.number() }) }),
  }),
});
/** `ap:y:<id>` approves, `ap:n:<id>` denies; the id is a UUID. Fits Telegram's 64-byte limit. */
const APPROVAL_DATA = /^ap:([yn]):([0-9a-f-]{36})$/;

/** The owner's tap on Approve or Deny, or undefined for any other update. */
export function parseApprovalCallback(update: unknown): ApprovalAnswer | undefined {
  const result = callbackSchema.safeParse(update);
  if (!result.success) return undefined;
  const { data, message } = result.data.callback_query;
  const match = APPROVAL_DATA.exec(data);
  if (match === null) return undefined;
  return {
    id: match[2] ?? '',
    decision: match[1] === 'y' ? 'approved' : 'denied',
    channel: 'telegram',
    chatId: String(message.chat.id),
  };
}

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

/** Answer a tap on Approve or Deny: pass it on, tell the person, and take the buttons away. */
async function answerTap(
  ctx: Context,
  onApproval: ((answer: ApprovalAnswer) => Promise<boolean>) | undefined,
): Promise<void> {
  const answer = parseApprovalCallback(ctx.update);
  const counted = answer !== undefined && (await onApproval?.(answer)) === true;
  const shown = counted
    ? answer.decision === 'approved'
      ? 'Approved'
      : 'Denied'
    : 'No longer valid';
  await ctx.answerCallbackQuery({ text: shown });
  // So they cannot be tapped twice; failing to is harmless.
  if (counted) await ctx.editMessageReplyMarkup().catch(() => undefined);
}

/** Keeps one send from outliving the queue's job expiry. */
async function withTimeout(call: Promise<unknown>): Promise<void> {
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error('Telegram send timed out'));
    }, SEND_TIMEOUT_MS).unref();
  });
  await Promise.race([call, timeout]);
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
      await withTimeout(bot.api.sendMessage(chatId, text));
    },
    askApproval: async (chatId, text, approvalId) => {
      const buttons = new InlineKeyboard()
        .text('Approve', `ap:y:${approvalId}`)
        .text('Deny', `ap:n:${approvalId}`);
      await withTimeout(bot.api.sendMessage(chatId, text, { reply_markup: buttons }));
    },
    typing: async (chatId) => {
      await bot.api.sendChatAction(chatId, 'typing');
    },
    start: async (onMessage, onApproval) => {
      bot.on('message', async (ctx) => {
        const message = parseTelegramUpdate(ctx.update);
        if (message !== undefined) await onMessage(message);
      });
      bot.on('callback_query:data', (ctx) => answerTap(ctx, onApproval));
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
