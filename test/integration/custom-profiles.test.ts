import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createSession, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import type { ApprovalPrompt } from '../../src/policy/approvals.js';
import { SWITCHED_OFF } from '../../src/policy/not-approved.js';
import {
  assignProfile,
  createApprovals,
  createGate,
  profileFor,
  profilesOf,
} from '../../src/policy/index.js';
import type { Profile } from '../../src/policy/profile.js';
import type { ActionType, ToolDefinition } from '../../src/tools/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const run = vi.fn(() => Promise.resolve('done'));
beforeEach(() => run.mockClear());

const B = { channel: 'fake', chatId: 'b' };
const MIXED: Profile = {
  read: 'auto',
  create: 'auto',
  overwrite: 'ask',
  delete: 'off',
  send: 'off',
  execute: 'off',
};
const tool = (actionType: ActionType): ToolDefinition => ({
  name: `custom.${actionType}`,
  description: 'test tool',
  parameters: { type: 'object' },
  actionType,
  changesState: actionType !== 'read',
  run,
});
const deviceOfBob = async () =>
  (await profilesOf(ctx.app, ctx.alice, ctx.bob.userId))?.devices[0]?.deviceId ?? '';
const setBobDevice = async (modes: Profile) =>
  assignProfile(ctx.app, ctx.alice, {
    userId: ctx.bob.userId,
    deviceId: await deviceOfBob(),
    preset: 'restricted',
    modes,
  });

it("the gate enforces a custom profile's off, ask and auto per action type", async () => {
  expect(await setBobDevice(MIXED)).toMatchObject({ custom: true });
  expect(await profileFor(ctx.app, ctx.bob, B)).toMatchObject({ custom: true, modes: MIXED });
  const prompts: ApprovalPrompt[] = [];
  const approvals = createApprovals({
    db: ctx.app,
    ttlMs: 60_000,
    prompt: (p) => {
      prompts.push(p);
      return Promise.resolve();
    },
  });
  const gate = createGate({
    db: ctx.app,
    tools: (['create', 'overwrite', 'delete'] as const).map(tool),
    approvals,
  });
  const [create, overwrite, del] = gate.toolsFor(B);
  expect(await create?.run({})).toContain('done'); // auto: runs at once
  expect(JSON.stringify(await del?.run({}))).toContain(SWITCHED_OFF); // off: refused
  const asked = Promise.resolve(overwrite?.run({})); // ask: waits for Bob
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(1);
  });
  expect(await approvals.decide(prompts[0]?.id ?? '', 'denied', B)).toBe(true);
  await asked;
  expect(run).toHaveBeenCalledTimes(1);
});

it('lists a warning for each type the custom profile loosens, and a preset clears it again', async () => {
  await setBobDevice({ ...MIXED, create: 'off', overwrite: 'off' });
  const done = await setBobDevice({ ...MIXED, execute: 'ask' });
  expect(done?.warnings.map((w) => [w.actionType, w.to])).toEqual([
    ['create', 'auto'],
    ['overwrite', 'ask'],
    ['execute', 'ask'],
  ]);
  await assignProfile(ctx.app, ctx.alice, {
    userId: ctx.bob.userId,
    deviceId: await deviceOfBob(),
    preset: 'restricted',
  });
  const back = await profileFor(ctx.app, ctx.bob, B);
  expect(back).toMatchObject({ custom: false, modes: { create: 'off' } });
});

async function cookieFor(who: Owner): Promise<string> {
  const token = `custom-${String(Math.random())}`;
  await createSession(ctx.app, who, {
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return `morgan_session=${token}`;
}
const previewOf = (userId: string, modes: Profile) =>
  call(
    'GET',
    `admin/profile-preview?userId=${userId}&preset=standard&modes=${encodeURIComponent(JSON.stringify(modes))}`,
  );
const call = async (method: string, path: string, body?: unknown) =>
  app.request(`/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: await cookieFor(ctx.alice) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

it('the API saves and previews custom modes, and refuses an unknown mode or type', async () => {
  const shown = await previewOf(ctx.bob.userId, { ...MIXED, send: 'ask' });
  expect(shown.status).toBe(200);
  expect(await shown.json()).toMatchObject({ custom: true, refused: false });
  const saved = await call('PUT', `members/${ctx.bob.userId}/profile`, {
    preset: 'standard',
    modes: { ...MIXED, send: 'ask' },
  });
  expect(saved.status).toBe(200);
  const listed = await call('GET', `members/${ctx.bob.userId}/profiles`);
  expect(await listed.json()).toMatchObject({ person: { custom: true, modes: { send: 'ask' } } });
  for (const bad of [{ ...MIXED, send: 'always' }, { ...MIXED, root: 'auto' }, { read: 'auto' }]) {
    const body = { preset: 'standard', modes: bad };
    expect((await call('PUT', `members/${ctx.bob.userId}/profile`, body)).status).toBe(400);
  }
});

it('refuses the admin a custom profile that shuts them out like Restricted would', async () => {
  const shut: Profile = { ...MIXED, create: 'off', overwrite: 'off' };
  const own = { userId: ctx.alice.userId, preset: 'standard' as const, modes: shut };
  expect(await assignProfile(ctx.app, ctx.alice, own)).toBeUndefined();
  expect(await (await previewOf(ctx.alice.userId, shut)).json()).toMatchObject({ refused: true });
});
