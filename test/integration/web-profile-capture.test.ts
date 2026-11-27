import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createReplier } from '../../src/core/index.js';
import { createSession } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { createGate, SWITCHED_OFF } from '../../src/policy/index.js';
import type { ToolDefinition } from '../../src/tools/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let cookie = '';
beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
  await createSession(ctx.app, ctx.alice, {
    tokenHash: sha256('admin-tok'),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  cookie = 'morgan_session=admin-tok';
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const run = vi.fn(() => Promise.resolve('captured'));
const capture: ToolDefinition = {
  name: 'capture.note',
  description: 'capture a note',
  parameters: { type: 'object' },
  actionType: 'create',
  changesState: true,
  run,
};

/** The admin's page saves a profile with this call: for the person, or for one chat. */
const assign = (preset: string, deviceId?: string) =>
  app.request(`/api/members/${ctx.bob.userId}/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ preset, ...(deviceId === undefined ? {} : { deviceId }) }),
  });

/** What Bob's chat receives when he says "capture this" and the model reaches for the tool. */
async function capturing(id: string): Promise<string> {
  const engine = new ScriptedEngine([{ tool: 'capture_note', args: {} }, { text: 'Done.' }]);
  const reply = createReplier({
    db: ctx.app,
    engine,
    logger: createLogger('silent'),
    model: 'test',
    timezone: 'UTC',
    gate: createGate({ db: ctx.app, tools: [capture] }),
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
  });
  const turn = {
    id,
    channel: 'fake',
    chatId: 'b',
    text: 'capture this',
    status: 'sending',
    ...ctx.bob,
  } as const;
  const answer = await reply(turn, new FakeChannel());
  return typeof answer === 'string' ? answer : answer.text;
}

it("Restricted on Bob's chat switches it off while the person stays Trusted, end to end", async () => {
  const chat = await ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('user_id', '=', ctx.bob.userId)
    .where('chat_id', '=', 'b')
    .executeTakeFirstOrThrow();
  expect((await assign('trusted')).status).toBe(200);
  expect(await capturing('turn-open')).toBe('Done.');
  expect(run).toHaveBeenCalledTimes(1);

  expect((await assign('restricted', chat.id)).status).toBe(200);
  expect(await capturing('turn-shut')).toContain(SWITCHED_OFF);
  expect(run).toHaveBeenCalledTimes(1);
});
