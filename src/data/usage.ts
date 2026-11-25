import type { Db, UsageStatus } from './db.js';

export interface UsageEntry {
  channel: string;
  chatId: string;
  model: string;
  status: UsageStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** Add one ledger row. A call that failed is recorded too, with what was billed. */
export async function recordUsage(db: Db, entry: UsageEntry): Promise<void> {
  await db
    .insertInto('usage_ledger')
    .values({
      channel: entry.channel,
      chat_id: entry.chatId,
      model: entry.model,
      status: entry.status,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      cache_read_tokens: entry.cacheReadTokens,
      cache_write_tokens: entry.cacheWriteTokens,
      // Money goes in as a rounded decimal string, never as a float.
      cost_usd: entry.costUsd.toFixed(8),
    })
    .execute();
}
