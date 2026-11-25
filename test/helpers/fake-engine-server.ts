import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll } from 'vitest';
import { z } from 'zod';
import type { Step } from './fake-engine.js';

export interface FakeEngineServer {
  url: string;
  /** Every request seen, in order. */
  requests: { path: string; token: string | undefined; body: Record<string, unknown> }[];
  /** Plug in a different answer for the next `/turn` (a status and body). */
  next: (reply: { status: number; body: unknown }) => void;
}

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

const body = z.record(z.string(), z.unknown());

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return raw === '' ? {} : body.parse(JSON.parse(raw));
};

interface Reply {
  status: number;
  body: unknown;
}

/** What `/turn` answers for one scripted step. */
function replyFor(step: Step | undefined): Reply | undefined {
  if (step === undefined) return { status: 500, body: {} };
  if ('text' in step) {
    const usage = { inputTokens: 3, outputTokens: 2, costUsd: 0.01 };
    return { status: 200, body: { text: step.text, usage } };
  }
  if ('error' in step) return { status: step.error === 'transient' ? 503 : 400, body: {} };
  return undefined; // hang: never answer
}

/** A small HTTP server that answers `/turn` from a script of `Step`s. Closed after the test file. */
export async function startFakeEngineServer(script: Step[]): Promise<FakeEngineServer> {
  const requests: FakeEngineServer['requests'] = [];
  let forced: Reply | undefined;
  const server = createServer((req, res) => {
    void (async () => {
      const token = req.headers['x-engine-token'];
      requests.push({
        path: req.url ?? '',
        token: typeof token === 'string' ? token : undefined,
        body: await readJson(req),
      });
      const reply =
        req.url === '/turn' ? (forced ?? replyFor(script.shift())) : { status: 200, body: {} };
      if (req.url === '/turn') forced = undefined;
      if (reply === undefined) return;
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    next: (reply) => {
      forced = reply;
    },
  };
}
