import type { AuditOutcome, Db } from './db.js';
import { DEFAULT_WORKSPACE_ID, ownerOf } from './tenancy.js';

export interface AuditEntry {
  turnId?: string | undefined;
  channel: string;
  chatId: string;
  tool: string;
  actionType: string;
  changesState: boolean;
  /** Argument names only. Values can hold private text, so they are never stored. */
  argNames: readonly string[];
  extraArgs: number;
  argsSha256: string;
  decision: 'auto' | 'ask' | 'off';
  outcome: AuditOutcome;
}

/**
 * Add one row. The person is looked up from the linked device of the chat; a stranger has no user
 * and their row goes to the default workspace.
 */
export async function appendAudit(db: Db, entry: AuditEntry): Promise<void> {
  const owner = await ownerOf(db, entry);
  await db
    .insertInto('audit_log')
    .values({
      turn_id: entry.turnId ?? null,
      channel: entry.channel,
      chat_id: entry.chatId,
      user_id: owner?.userId ?? null,
      workspace_id: owner?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      tool: entry.tool,
      action_type: entry.actionType,
      changes_state: entry.changesState,
      arg_names: [...entry.argNames],
      extra_args: entry.extraArgs,
      args_sha256: entry.argsSha256,
      decision: entry.decision,
      outcome: entry.outcome,
    })
    .execute();
}
