import type { Db } from './db.js';
import { fromRow, latestSummary, type ChatKey, type ChatMessage } from './history.js';
import { type Owner, withOwner } from './tenancy.js';

/** The part of a chat to be replaced by a summary: where it ends, and what to summarise. */
export interface CompactionPlan {
  fromId: string;
  toId: string;
  /** The summary already standing in front of these messages, if any. */
  previous: string | undefined;
  messages: ChatMessage[];
}

const charsOf = (rows: readonly { text: string }[]): number =>
  rows.reduce((sum, r) => sum + r.text.length, 0);

/**
 * What to compact: everything after the last summary except the newest messages that fit in
 * `keepChars`. The cut falls only where a user message starts, so a tool call is never parted from
 * its result, and the newest turn is always kept. Undefined when there is nothing older to replace.
 */
export async function planCompaction(
  db: Db,
  owner: Owner,
  chat: ChatKey,
  keepChars: number,
): Promise<CompactionPlan | undefined> {
  const { previous, rows } = await withOwner(db, owner, async (trx) => ({
    previous: await latestSummary(trx, chat),
    rows: await trx
      .selectFrom('chat_messages')
      .select(['id', 'role', 'text', 'data'])
      .where('channel', '=', chat.channel)
      .where('chat_id', '=', chat.chatId)
      .where('role', '<>', 'summary')
      .orderBy('id', 'asc')
      .execute(),
  }));
  const live = rows.filter((r) => BigInt(r.id) > BigInt(previous?.coversTo ?? '0'));
  const starts = live.flatMap((r, i) => (r.role === 'user' ? [i] : []));
  let cut = starts.at(-1) ?? 0;
  let kept = charsOf(live.slice(cut));
  for (const start of starts.slice(0, -1).reverse()) {
    const turn = charsOf(live.slice(start, cut));
    if (kept + turn > keepChars) break;
    kept += turn;
    cut = start;
  }
  const old = live.slice(0, cut);
  const first = old[0];
  const last = old.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const messages = old.flatMap((r) => fromRow(r) ?? []);
  return { fromId: first.id, toId: last.id, previous: previous?.text, messages };
}

/** Store a summary of messages `fromId` to `toId`. The messages themselves stay. */
export async function saveSummary(
  db: Db,
  owner: Owner,
  chat: ChatKey,
  summary: { fromId: string; toId: string; text: string },
): Promise<void> {
  await withOwner(db, owner, (trx) =>
    trx
      .insertInto('chat_messages')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        channel: chat.channel,
        chat_id: chat.chatId,
        role: 'summary',
        text: summary.text,
        covers_from: summary.fromId,
        covers_to: summary.toId,
      })
      .execute(),
  );
}
