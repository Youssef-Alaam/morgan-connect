import type { Db, Owner } from '../../src/data/index.js';

/** A login, a session, a password link, an invite and a web event for this person. */
export async function seedAccounts(owner: Db, who: Owner, chatId: string): Promise<void> {
  const person = { user_id: who.userId, workspace_id: who.workspaceId };
  await owner
    .insertInto('credentials')
    .values({ ...person, email: `${chatId}@example.test`, password_hash: 'h' })
    .execute();
  const hashes = { token_hash: `t-${chatId}`, expires_at: new Date(Date.now() + 3_600_000) };
  await owner
    .insertInto('sessions')
    .values({ ...person, ...hashes })
    .execute();
  await owner
    .insertInto('password_links')
    .values({ ...person, ...hashes })
    .execute();
  await owner
    .insertInto('invites')
    .values({ ...person, ...hashes, role: 'member' })
    .execute();
  await owner
    .insertInto('web_events')
    .values({ ...person, chat_id: chatId, kind: 'message', text: `hello ${chatId}` })
    .execute();
}
