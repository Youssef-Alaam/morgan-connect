import { Bot, type Context, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import type { InboundMessage } from '../core/index.js';
import type { Logger } from '../ops/index.js';
import type { ApprovalAnswer, AskMoreAnswer, ChannelAdapter } from './adapter.js';

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
    from: z.object({ id: z.number() }),
    message: z.object({ chat: z.object({ id: z.number(), type: z.string() }) }),
  }),
});
/** `ap:y:<id>` approves, `ap:n:<id>` denies; the id is a UUID. Fits Telegram's 64-byte limit. */
const APPROVAL_DATA = /^ap:([yn]):([0-9a-f-]{36})$/;

interface Handlers {
  onApproval?: ((answer: ApprovalAnswer) => Promise<boolean>) | undefined;
  onAskMore?: ((chat: { channel: string; chatId: string }) => Promise<AskMoreAnswer>) | undefined;
}

/** The "Ask for more" button on a budget refusal. */
const ASK_MORE_DATA = 'bm:more';

const ASK_MORE_SHOWN: Record<AskMoreAnswer, string> = {
  sent: 'Asked the admin',
  open: 'Already asked',
  unneeded: 'No limit reached',
  unavailable: 'Not available',
};

/** A tap by a person in their own private chat: its data and chat, or undefined (a group, or someone else's tap). */
function privateTap(update: unknown): { data: string; chatId: string } | undefined {
  const result = callbackSchema.safeParse(update);
  if (!result.success) return undefined;
  const { data, message, from } = result.data.callback_query;
  // Only the person in their own private chat: in a group, anyone could tap the buttons.
  if (message.chat.type !== 'private' || from.id !== message.chat.id) return undefined;
  return { data, chatId: String(message.chat.id) };
}

/** The owner's tap on Approve or Deny, or undefined for any other update. */
export function parseApprovalCallback(update: unknown): ApprovalAnswer | undefined {
  const tap = privateTap(update);
  const match = tap === undefined ? null : APPROVAL_DATA.exec(tap.data);
  if (tap === undefined || match === null) return undefined;
  return {
    id: match[2] ?? '',
    decision: match[1] === 'y' ? 'approved' : 'denied',
    channel: 'telegram',
    chatId: tap.chatId,
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

/** Answer a tap on "Ask for more": the person's own chat is the one that asks. */
async function answerAskMore(
  ctx: Context,
  onAskMore: ((chat: { channel: string; chatId: string }) => Promise<AskMoreAnswer>) | undefined,
): Promise<void> {
  const tap = privateTap(ctx.update);
  let outcome: AskMoreAnswer = 'unavailable';
  try {
    if (tap !== undefined)
      outcome = (await onAskMore?.({ channel: 'telegram', chatId: tap.chatId })) ?? outcome;
  } finally {
    await ctx.answerCallbackQuery({ text: ASK_MORE_SHOWN[outcome] });
  }
  if (outcome === 'sent') await ctx.editMessageReplyMarkup().catch(() => undefined);
}

/** Answer a tap on Approve, Deny or Ask for more: pass it on, tell the person, and take the buttons away. */
async function answerTap(ctx: Context, handlers: Handlers): Promise<void> {
  if (ctx.callbackQuery?.data === ASK_MORE_DATA) {
    await answerAskMore(ctx, handlers.onAskMore);
    return;
  }
  const { onApproval } = handlers;
  const answer = parseApprovalCallback(ctx.update);
  let shown = 'No longer valid';
  let counted = false;
  try {
    if (answer !== undefined && (await onApproval?.(answer)) === true) {
      counted = true;
      shown = answer.decision === 'approved' ? 'Approved' : 'Denied';
    }
  } finally {
    // The spinner on the button must stop even when handling the tap failed.
    await ctx.answerCallbackQuery({ text: shown });
  }
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
    // If this times out the buttons may still appear; a later tap just answers "No longer valid".
    askApproval: async (chatId, text, approvalId) => {
      const buttons = new InlineKeyboard()
        .text('Approve', `ap:y:${approvalId}`)
        .text('Deny', `ap:n:${approvalId}`);
      await withTimeout(bot.api.sendMessage(chatId, text, { reply_markup: buttons }));
    },
    askMore: async (chatId, text) => {
      const button = new InlineKeyboard().text('Ask for more', ASK_MORE_DATA);
      await withTimeout(bot.api.sendMessage(chatId, text, { reply_markup: button }));
    },
    typing: async (chatId) => {
      await bot.api.sendChatAction(chatId, 'typing');
    },
    start: async (onMessage, onApproval, onAskMore) => {
      bot.on('message', async (ctx) => {
        const message = parseTelegramUpdate(ctx.update);
        if (message !== undefined) await onMessage(message);
      });
      bot.on('callback_query:data', (ctx) => answerTap(ctx, { onApproval, onAskMore }));
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
