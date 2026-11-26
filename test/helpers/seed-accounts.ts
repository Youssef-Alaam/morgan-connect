import type { Db, Owner } from '../../src/data/index.js';

/** A login, a session, a password link, an invite, a link code, a web event and a second factor for this person. */
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
    .insertInto('link_codes')
    .values({ ...person, code_hash: hashes.token_hash, expires_at: hashes.expires_at })
    .execute();
  await owner
    .insertInto('web_events')
    .values({ ...person, chat_id: chatId, kind: 'message', text: `hello ${chatId}` })
    .execute();
  // Unconfirmed, so it never turns a sign-in into two steps.
  await owner
    .insertInto('totp_factors')
    .values({ ...person, secret_sealed: 'sealed' })
    .execute();
  await owner
    .insertInto('backup_codes')
    .values({ ...person, code_hash: `h-${chatId}` })
    .execute();
}
