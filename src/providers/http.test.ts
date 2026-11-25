import { expect, it } from 'vitest';
import { startFakeEngineServer } from '../../test/helpers/fake-engine-server.js';
import { EngineError } from './engine.js';
import { createHttpEngine } from './http.js';

const open = (server: { url: string }, extra: { timeoutMs?: number } = {}) =>
  createHttpEngine({ url: server.url, token: 'secret', ...extra }).open({
    history: [],
    conversationId: 'conv-1',
  });

it('posts the conversation id and text with the shared secret, and reports usage', async () => {
  const server = await startFakeEngineServer([{ text: 'hello' }]);
  const calls: unknown[] = [];
  const session = createHttpEngine({ url: server.url, token: 'secret' }).open({
    history: [],
    conversationId: 'conv-1',
    onUsage: (call) => calls.push(call),
  });
  expect(await session.prompt('hi there')).toBe('hello');
  expect(server.requests).toEqual([
    { path: '/turn', token: 'secret', body: { conversationId: 'conv-1', text: 'hi there' } },
  ]);
  expect(calls).toEqual([
    {
      inputTokens: 3,
      outputTokens: 2,
      costUsd: 0.01,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      status: 'ok',
    },
  ]);
  expect(session.usage()).toEqual({ inputTokens: 3, outputTokens: 2, costUsd: 0.01 });
  expect(session.transcript()).toEqual([
    { role: 'user', text: 'hi there' },
    { role: 'assistant', text: 'hello' },
  ]);
});

it('does not send tools or history, and sends steered text with the next prompt', async () => {
  const server = await startFakeEngineServer([{ text: 'ok' }]);
  const session = createHttpEngine({ url: server.url, token: 'secret' }).open({
    history: [{ role: 'user', text: 'old' }],
    conversationId: 'c',
    system: 'be brief',
  });
  session.steer('shorter please');
  await session.prompt('hi');
  expect(server.requests[0]?.body).toEqual({ conversationId: 'c', text: 'shorter please\n\nhi' });
});

it.each([
  [500, 'transient'],
  [503, 'transient'],
  [429, 'transient'],
  [408, 'transient'],
  [400, 'failed'],
  [401, 'failed'],
  [404, 'failed'],
] as const)('maps status %i to a %s error without user text', async (status, kind) => {
  const server = await startFakeEngineServer([]);
  server.next({ status, body: { error: 'secret user text' } });
  const failure: unknown = await open(server)
    .prompt('my private words')
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(EngineError);
  expect(failure).toMatchObject({ kind });
  expect((failure as Error).message).not.toMatch(/private|secret/);
});

it('treats an answer of the wrong shape as failed', async () => {
  const server = await startFakeEngineServer([]);
  server.next({ status: 200, body: { nope: true } });
  await expect(open(server).prompt('hi')).rejects.toMatchObject({ kind: 'failed' });
});

it('treats an unreachable engine as transient', async () => {
  const session = createHttpEngine({ url: 'http://127.0.0.1:1', token: 't' }).open({
    history: [],
  });
  await expect(session.prompt('hi')).rejects.toMatchObject({ kind: 'transient' });
});

it('treats a timeout as transient', async () => {
  const server = await startFakeEngineServer([{ hang: true }]);
  await expect(open(server, { timeoutMs: 50 }).prompt('hi')).rejects.toMatchObject({
    kind: 'transient',
  });
});

it('abort cancels the request, posts /abort, and reports an aborted call', async () => {
  const server = await startFakeEngineServer([{ hang: true }]);
  const calls: { status: string }[] = [];
  const session = createHttpEngine({ url: server.url, token: 'secret' }).open({
    history: [],
    conversationId: 'conv-9',
    onUsage: (call) => calls.push(call),
  });
  const pending = session.prompt('hi');
  const caught = pending.catch((error: unknown) => error);
  await expect.poll(() => server.requests.length).toBe(1);
  session.abort();
  expect(await caught).toMatchObject({ kind: 'aborted' });
  await expect.poll(() => server.requests.map((r) => r.path)).toEqual(['/turn', '/abort']);
  expect(server.requests[1]).toMatchObject({ token: 'secret', body: { conversationId: 'conv-9' } });
  expect(calls).toEqual([expect.objectContaining({ status: 'aborted' })]);
});

it('end posts /end with the conversation id, and maps a failure', async () => {
  const server = await startFakeEngineServer([]);
  const engine = createHttpEngine({ url: server.url, token: 'secret' });
  await engine.end?.('conv-2');
  expect(server.requests).toEqual([
    { path: '/end', token: 'secret', body: { conversationId: 'conv-2' } },
  ]);
  const down = createHttpEngine({ url: 'http://127.0.0.1:1', token: 't' });
  await expect(down.end?.('x')).rejects.toMatchObject({ kind: 'transient' });
});

it('works when the url ends with a slash', async () => {
  const server = await startFakeEngineServer([{ text: 'ok' }]);
  const session = createHttpEngine({ url: `${server.url}/`, token: 'secret' }).open({
    history: [],
  });
  expect(await session.prompt('hi')).toBe('ok');
});
