import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  addPasskey,
  listPasskeys,
  passkeyByCredential,
  recordPasskeyUse,
  removePasskey,
} from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const fresh = (credentialId: string) => ({
  credentialId,
  publicKey: `key-${credentialId}`,
  counter: 0,
  transports: ['internal'],
  name: 'Laptop',
});

it('finds a passkey and its owner by credential id before anyone is signed in', async () => {
  await addPasskey(ctx.app, ctx.alice, fresh('c1'));
  expect(await passkeyByCredential(ctx.app, 'c1')).toEqual({
    ...ctx.alice,
    publicKey: 'key-c1',
    counter: 0,
    transports: ['internal'],
  });
  expect(await passkeyByCredential(ctx.app, 'nope')).toBeUndefined();
});

it('refuses a credential id that another person already holds', async () => {
  await expect(addPasskey(ctx.app, ctx.bob, fresh('c1'))).rejects.toMatchObject({ code: '23505' });
});

it('records the new signature count and the time of use', async () => {
  await recordPasskeyUse(ctx.app, ctx.alice, 'c1', 7);
  expect((await passkeyByCredential(ctx.app, 'c1'))?.counter).toBe(7);
  const used = (await listPasskeys(ctx.app, ctx.alice)).find((each) => each.credentialId === 'c1');
  expect(used?.lastUsedAt).toBeInstanceOf(Date);
  await recordPasskeyUse(ctx.app, ctx.bob, 'c1', 99);
  expect((await passkeyByCredential(ctx.app, 'c1'))?.counter).toBe(7);
});

it('removes a passkey, but never the last way to sign in', async () => {
  const id = await addPasskey(ctx.app, ctx.alice, fresh('c2'));
  expect(await removePasskey(ctx.app, ctx.alice, id)).toBe('removed');
  expect(await removePasskey(ctx.app, ctx.alice, id)).toBe('not_found');
  await ctx.owner
    .deleteFrom('passkeys')
    .where('credential_id', '<>', 'c1')
    .where('user_id', '=', ctx.alice.userId)
    .execute();
  const [only] = await listPasskeys(ctx.app, ctx.alice);
  const login = await ctx.owner
    .selectFrom('credentials')
    .selectAll()
    .where('user_id', '=', ctx.alice.userId)
    .executeTakeFirstOrThrow();
  await ctx.owner.deleteFrom('credentials').where('user_id', '=', ctx.alice.userId).execute();
  expect(await removePasskey(ctx.app, ctx.alice, only?.id ?? '')).toBe('last_method');
  await ctx.owner.insertInto('credentials').values(login).execute();
  expect(await removePasskey(ctx.app, ctx.alice, only?.id ?? '')).toBe('removed');
});
