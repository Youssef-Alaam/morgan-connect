import type { Db, Owner } from './db.js';
import { sweepSessions } from './system.js';
import { withOwner } from './tenancy.js';

/** Open a browser session and its `web` device in one step; expired sessions are swept first. */
export async function createSession(
  db: Db,
  owner: Owner,
  session: { tokenHash: string; expiresAt: Date },
): Promise<string> {
  await sweepSessions(db);
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .insertInto('sessions')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        token_hash: session.tokenHash,
        expires_at: session.expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('devices')
      .values({ user_id: owner.userId, channel: 'web', chat_id: row.id })
      .execute();
    return row.id;
  });
}

/** Sign out: the session and its device go together. */
export function endSession(db: Db, owner: Owner, sessionId: string): Promise<void> {
  return withOwner(db, owner, async (trx) => {
    await trx
      .deleteFrom('devices')
      .where('channel', '=', 'web')
      .where('chat_id', '=', sessionId)
      .execute();
    await trx.deleteFrom('sessions').where('id', '=', sessionId).execute();
  });
}

export interface Account {
  user: { id: string; role: string; email: string | null };
  workspace: { id: string; name: string };
}

/** The signed-in person's own user row, email and workspace. */
export function accountOf(db: Db, owner: Owner): Promise<Account> {
  return withOwner(db, owner, async (trx) => {
    const user = await trx.selectFrom('users').select(['id', 'role']).executeTakeFirstOrThrow();
    const login = await trx.selectFrom('credentials').select('email').executeTakeFirst();
    const workspace = await trx
      .selectFrom('workspaces')
      .select(['id', 'name'])
      .where('id', '=', owner.workspaceId)
      .executeTakeFirstOrThrow();
    return { user: { ...user, email: login?.email ?? null }, workspace };
  });
}
