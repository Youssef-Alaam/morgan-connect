import type { Db } from './db.js';

export interface AuditEntry {
  turnId?: string | undefined;
  channel: string;
  chatId: string;
  tool: string;
  actionType: string;
  changesState: boolean;
  /** Names of the arguments only. Values can hold private text, so they are never stored. */
  argNames: readonly string[];
  decision: 'auto' | 'ask' | 'off';
  outcome: 'ok' | 'error' | 'refused';
}

/** Add one row. The person is looked up from the linked device of the chat. */
export async function appendAudit(db: Db, entry: AuditEntry): Promise<void> {
  const device = await db
    .selectFrom('devices')
    .select('user_id')
    .where('channel', '=', entry.channel)
    .where('chat_id', '=', entry.chatId)
    .executeTakeFirst();
  await db
    .insertInto('audit_log')
    .values({
      turn_id: entry.turnId ?? null,
      channel: entry.channel,
      chat_id: entry.chatId,
      user_id: device?.user_id ?? null,
      tool: entry.tool,
      action_type: entry.actionType,
      changes_state: entry.changesState,
      arg_names: [...entry.argNames],
      decision: entry.decision,
      outcome: entry.outcome,
    })
    .execute();
}
