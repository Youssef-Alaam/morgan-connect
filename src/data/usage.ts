import { sql } from 'kysely';
import type { Db, UsageStatus } from './db.js';
import { type Owner, withOwner } from './tenancy.js';

export interface UsageEntry extends Owner {
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
  await withOwner(db, entry, (trx) =>
    trx
      .insertInto('usage_ledger')
      .values({
        user_id: entry.userId,
        workspace_id: entry.workspaceId,
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
      .execute(),
  );
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** USD as a decimal string with 8 places, so no float ever touches money. */
  costUsd: string;
}

export interface UsageReport {
  today: UsageTotals;
  month: UsageTotals;
}

interface Row {
  day_calls: number;
  day_in: number;
  day_out: number;
  day_cost: string;
  month_calls: number;
  month_in: number;
  month_out: number;
  month_cost: string;
}

/** The one row of day and month totals; the edges are found on the local clock. */
async function totalsRow(
  db: Db,
  userId: string,
  now: Date,
  timezone: string,
): Promise<Row | undefined> {
  const { rows } = await sql<Row>`
    with local as (
      select
        date_trunc('day', ${now}::timestamptz at time zone ${timezone}) as day,
        date_trunc('month', ${now}::timestamptz at time zone ${timezone}) as month
    ),
    bounds as (
      select
        day at time zone ${timezone} as day_start,
        (day + interval '1 day') at time zone ${timezone} as day_end,
        month at time zone ${timezone} as month_start,
        (month + interval '1 month') at time zone ${timezone} as month_end
      from local
    ),
    today as (select * from usage_ledger, bounds where user_id = ${userId} and created_at >= day_start and created_at < day_end)
    select
      (select count(*) from today)::float8 as day_calls,
      (select coalesce(sum(input_tokens), 0) from today)::float8 as day_in,
      (select coalesce(sum(output_tokens), 0) from today)::float8 as day_out,
      (select coalesce(sum(cost_usd), 0) from today)::text as day_cost,
      count(*)::float8 as month_calls,
      coalesce(sum(input_tokens), 0)::float8 as month_in,
      coalesce(sum(output_tokens), 0)::float8 as month_out,
      coalesce(sum(cost_usd), 0)::text as month_cost
    from usage_ledger, bounds
    where user_id = ${userId} and created_at >= month_start and created_at < month_end`.execute(db);
  return rows[0];
}

/**
 * Totals for the local day and the local month that contain `now`, in `timezone`. The edges are
 * found on the local clock, so a 23 or 25 hour day (a clock change) is still one day.
 */
export async function usageSince(
  db: Db,
  owner: Owner,
  now: Date,
  timezone: string,
): Promise<UsageReport> {
  const r = await withOwner(db, owner, (trx) => totalsRow(trx, owner.userId, now, timezone));
  if (r === undefined) throw new Error('The usage query returned no row');
  return {
    today: {
      calls: r.day_calls,
      inputTokens: r.day_in,
      outputTokens: r.day_out,
      costUsd: r.day_cost,
    },
    month: {
      calls: r.month_calls,
      inputTokens: r.month_in,
      outputTokens: r.month_out,
      costUsd: r.month_cost,
    },
  };
}
