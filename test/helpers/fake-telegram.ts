import { createServer, type Server } from 'node:http';

export interface FakeTelegram {
  apiRoot: string;
  /** Bodies of every sendMessage call. */
  sent: unknown[];
  /** Bodies of every answerCallbackQuery call. */
  answers: unknown[];
  /** Hand Telegram another update to deliver on the next poll. */
  push: (update: unknown) => void;
  /** Bodies of every sendChatAction call. */
  actions: unknown[];
  stop: () => Promise<void>;
}

const chat = { id: 42, type: 'private' };
const updateWith = (messageId: number): unknown => ({
  update_id: messageId,
  message: { message_id: messageId, date: 1, chat, text: 'ping' },
});

/** A tiny Telegram Bot API on localhost: serves one text update, records sends. */
export async function startFakeTelegram(options: {
  rejectToken: boolean;
  messageId?: number;
}): Promise<FakeTelegram> {
  const sent: unknown[] = [];
  const actions: unknown[] = [];
  const queue: unknown[] = [updateWith(options.messageId ?? 5)];
  const answers: unknown[] = [];
  const recorded = { sendMessage: sent, sendChatAction: actions, answerCallbackQuery: answers };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const method = (req.url ?? '').split('/').pop();
      const reply = (result: unknown, delayMs = 0): void => {
        setTimeout(() => res.end(JSON.stringify({ ok: true, result })), delayMs);
      };
      if (options.rejectToken) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }));
      } else if (method === 'getMe')
        reply({ id: 1, is_bot: true, first_name: 'Fake', username: 'FakeBot' });
      else if (method === 'getUpdates') {
        const batch = queue.splice(0);
        reply(batch, batch.length > 0 ? 0 : 300);
      } else {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        (recorded as Record<string, unknown[] | undefined>)[method ?? '']?.push(body);
        reply(method === 'sendMessage' ? { message_id: 6, date: 1, chat, text: 'echo' } : true);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    apiRoot: `http://127.0.0.1:${String(port)}`,
    sent,
    actions,
    answers,
    push: (update) => queue.push(update),
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
