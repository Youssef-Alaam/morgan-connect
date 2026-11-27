import type { Db, Owner } from '../../src/data/index.js';

/** A login, a session, a password link, an invite, a link code, a web event, a second factor, a passkey, a profile choice, a budget and a top-up for this person. */
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
  await owner
    .insertInto('passkeys')
    .values({ ...person, credential_id: `cred-${chatId}`, public_key: 'key', name: chatId })
    .execute();
  await owner
    .insertInto('profile_assignments')
    .values({ ...person, preset: 'standard' })
    .execute();
  await seedBudget(owner, who, chatId);
}

/** A monthly limit and one approved top-up for this person. */
async function seedBudget(owner: Db, who: Owner, chatId: string): Promise<void> {
  const person = { user_id: who.userId, workspace_id: who.workspaceId };
  await owner
    .insertInto('budgets')
    .values({ ...person, monthly_limit_usd: chatId === 'b' ? '9' : '1' })
    .execute();
  await owner
    .insertInto('budget_topups')
    .values({
      ...person,
      amount_usd: '5',
      month: '2026-11',
      status: 'approved',
      channel: 'fake',
      chat_id: chatId,
      expires_at: new Date(Date.now() + 3_600_000),
    })
    .execute();
}
