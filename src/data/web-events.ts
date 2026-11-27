import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** A session keeps its newest events only, so a long chat cannot grow the table without end. */
export const WEB_EVENT_KEEP = 500;

/** The most events one read returns; a caller that gets this many asks again. */
export const WEB_EVENT_PAGE = 100;

export interface WebEvent {
  /** Its place in the stream; grows with every event, so "after this id" has no duplicates. */
  id: string;
  kind: 'ack' | 'message' | 'approval';
  ref: string | null;
  text: string;
}

/** Store one event on this person's session. A second `ack` for the same `ref` stores nothing. */
export function recordWebEvent(
  db: Db,
  owner: Owner,
  chatId: string,
  event: { kind: WebEvent['kind']; ref?: string; text?: string },
): Promise<string | undefined> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .insertInto('web_events')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        chat_id: chatId,
        kind: event.kind,
        ref: event.ref ?? null,
        text: event.text ?? '',
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning('id')
      .executeTakeFirst();
    await trx
      .deleteFrom('web_events')
      .where('chat_id', '=', chatId)
      .where(
        'id',
        '<=',
        trx
          .selectFrom('web_events')
          .select('id')
          .where('chat_id', '=', chatId)
          .orderBy('id', 'desc')
          .limit(1)
          .offset(WEB_EVENT_KEEP),
      )
      .execute();
    return row?.id;
  });
}

/** This person's events on one session after `afterId` ("0" for all), oldest first. */
export function webEventsAfter(
  db: Db,
  owner: Owner,
  chatId: string,
  afterId: string,
): Promise<WebEvent[]> {
  return withOwner(db, owner, (trx) =>
    trx
      .selectFrom('web_events')
      .select(['id', 'kind', 'ref', 'text'])
      .where('chat_id', '=', chatId)
      .where('id', '>', afterId)
      .orderBy('id')
      .limit(WEB_EVENT_PAGE)
      .execute(),
  );
}
