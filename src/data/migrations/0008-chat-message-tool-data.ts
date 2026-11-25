import type { Kysely } from 'kysely';

/**
 * A chat message can now be a tool call or a tool result, so the next turn replays what the model
 * really did. `data` holds the tool details; old text-only rows keep it null and load as before.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('chat_messages').addColumn('data', 'jsonb').execute();
}
