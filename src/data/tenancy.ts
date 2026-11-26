import { sql, type Transaction } from 'kysely';
import type { Database, Db, Owner } from './db.js';
import { chatOwner } from './system.js';

/** The workspace every user belongs to until real workspaces land. Same id as migration 0010. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export type { Owner } from './db.js';

/**
 * Run `fn` in one transaction as this person: `app.user_id` and `app.workspace_id` are set local
 * to the transaction, so row-level security shows and accepts only their rows, and nothing leaks
 * to the next use of the pooled connection.
 */
export async function withOwner<T>(
  db: Db,
  owner: Owner,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${owner.userId}, true),
      set_config('app.workspace_id', ${owner.workspaceId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** The person (and their workspace) behind a chat, from its linked device; undefined if unlinked. */
export function ownerOf(
  db: Db,
  chat: { channel: string; chatId: string },
): Promise<Owner | undefined> {
  return chatOwner(db, chat);
}
