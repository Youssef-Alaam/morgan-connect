import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { admit, type GateDeps } from '../../src/core/gate.js';
import { issueLinkCode, type Owner } from '../../src/data/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createIdentity, type Identity } from '../../src/identity/index.js';
import {
  LINK_CODE_TTL_SECONDS,
  newLinkCode,
  normaliseLinkCode,
} from '../../src/identity/link-code.js';
import { createLogger } from '../../src/ops/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let identity: Identity;
let channel: FakeChannel;

beforeAll(async () => {
  ctx = await startIsolation();
  identity = createIdentity(ctx.app);
  channel = new FakeChannel();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

/** What the signed-in web page does: a fresh code for this person, shown to them in full. */
async function newCode(who: Owner): Promise<string> {
  const code = newLinkCode();
  await issueLinkCode(ctx.app, who, {
    codeHash: sha256(normaliseLinkCode(code)),
    ttlSeconds: LINK_CODE_TTL_SECONDS,
  });
  return code;
}
const gate = (): GateDeps => ({
  identity,
  senders: [channel],
  logger: createLogger('silent'),
});
const say = (chatId: string, text: string) =>
  admit(gate(), { channel: 'fake', chatId, messageId: `${chatId}-${text}`, text });
const ownerOfChat = async (chatId: string) =>
  (
    await ctx.owner
      .selectFrom('devices')
      .select('user_id')
      .where('chat_id', '=', chatId)
      .executeTakeFirst()
  )?.user_id;
const auditTools = async (tool: string) =>
  (
    await sql<{ user_id: string | null; outcome: string; subject_user_id: string | null }>`
    select user_id, outcome, subject_user_id from audit_log where tool = ${tool} order by created_at`.execute(
      ctx.owner,
    )
  ).rows;

it('a member asks for a code, sends /link from a chat, and the chat is theirs and not the admin', async () => {
  const code = await newCode(ctx.bob);
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await ownerOfChat('c1')).toBeUndefined();
  expect(await say('c1', `/link@MorganBot ${code.toLowerCase()}`)).toBe(false);
  expect(channel.attempts).toEqual([
    { chatId: 'c1', text: 'Linked. This chat is now one of your devices.' },
  ]);
  expect(await ownerOfChat('c1')).toBe(ctx.bob.userId);
  expect(await auditTools('device.link')).toEqual([
    { user_id: ctx.bob.userId, outcome: 'ok', subject_user_id: ctx.bob.userId },
  ]);
});

it('a code works once, is stored only as a hash, and a linked chat sending /link makes no turn', async () => {
  const code = await newCode(ctx.bob);
  const stored = await sql<{ code_hash: string }>`
    select code_hash from link_codes where used_at is null and user_id = ${ctx.bob.userId}`.execute(
    ctx.owner,
  );
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(stored.rows)).not.toContain(code.replaceAll('-', ''));
  expect(await say('c2', `/link ${code}`)).toBe(false);
  expect(await ownerOfChat('c2')).toBe(ctx.bob.userId);
  expect(await say('c3', `/link ${code}`)).toBe(false);
  expect(await ownerOfChat('c3')).toBeUndefined();
  // Already linked: the code text never becomes a turn, and nothing more is said.
  channel.attempts.length = 0;
  expect(await say('c2', `/link ${code}`)).toBe(false);
  expect(await say('c2', 'hello')).toBe(true);
  expect(channel.attempts).toEqual([]);
});

it('refuses an expired code, and a new code replaces the one before it', async () => {
  const old = await newCode(ctx.bob);
  const fresh = await newCode(ctx.bob);
  await say('c4', `/link ${old}`);
  expect(await ownerOfChat('c4')).toBeUndefined();
  await sql`update link_codes set expires_at = now() - interval '1 second'
    where used_at is null`.execute(ctx.owner);
  await say('c4', `/link ${fresh}`);
  expect(await ownerOfChat('c4')).toBeUndefined();
});

it('keeps unknown chats silent for wrong codes and limits tries per chat, even for the right code', async () => {
  const code = await newCode(ctx.bob);
  channel.attempts.length = 0;
  for (let i = 0; i < 5; i += 1) expect(await say('c5', `/link WRONG${String(i)}`)).toBe(false);
  await say('c5', `/link ${code}`);
  expect(await ownerOfChat('c5')).toBeUndefined();
  expect(channel.attempts).toEqual([]);
  await say('c6', `/link ${code}`);
  expect(await ownerOfChat('c6')).toBe(ctx.bob.userId);
});

it('a chat already linked to someone else cannot be taken over, and the code is not spent', async () => {
  const code = await newCode(ctx.bob);
  expect(await ownerOfChat('a')).toBe(ctx.alice.userId);
  expect(await identity.link('fake', 'a', code)).toBe('refused');
  expect(await ownerOfChat('a')).toBe(ctx.alice.userId);
  expect(await identity.link('fake', 'c7', code)).toBe('claimed');
  expect(await ownerOfChat('c7')).toBe(ctx.bob.userId);
  // The web is not a chat a code can claim.
  const next = await newCode(ctx.bob);
  expect(await identity.link('web', 'forged', next)).toBe('refused');
});

it('caps refused tries across all chats, so new chats cannot keep guessing', async () => {
  const strict = createIdentity(ctx.app);
  const code = await newCode(ctx.bob);
  for (let i = 0; i < 100; i += 1)
    expect(await strict.link('fake', `g${String(i)}`, 'NOPE')).toBe('refused');
  expect(await strict.link('fake', 'g-late', code)).toBe('limited');
  expect(await ownerOfChat('g-late')).toBeUndefined();
  expect(await identity.link('fake', 'g-late', code)).toBe('claimed');
});
