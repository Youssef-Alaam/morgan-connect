import { createServer, type Server } from 'node:http';

export interface FakeTelegram {
  apiRoot: string;
  /** Bodies of every sendMessage call. */
  sent: unknown[];
  stop: () => Promise<void>;
}

const chat = { id: 42, type: 'private' };
const update = { update_id: 1, message: { message_id: 5, date: 1, chat, text: 'ping' } };

/** A tiny Telegram Bot API on localhost: serves one text update, records sends. */
export async function startFakeTelegram(options: { rejectToken: boolean }): Promise<FakeTelegram> {
  const sent: unknown[] = [];
  let served = false;
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
        reply(served ? [] : [update], served ? 300 : 0);
        served = true;
      } else if (method === 'sendMessage') {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        sent.push(body);
        reply({ message_id: 6, date: 1, chat, text: 'echo' });
      } else reply(true);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    apiRoot: `http://127.0.0.1:${String(port)}`,
    sent,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
