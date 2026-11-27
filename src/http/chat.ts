import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { type SSEStreamingApi, streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { InboundMessage } from '../core/index.js';
import { sessionOwner, WEB_EVENT_PAGE, type Db, type Owner, type WebEvent } from '../data/index.js';
import { sha256 } from '../identity/admin-link.js';
import type { Logger } from '../ops/index.js';
import { COOKIE, type Signed } from './session.js';

/** What the chat routes need from the web channel (wired in boot; http never imports channels). */
export interface ChatEvents {
  acknowledge: (owner: Owner, chatId: string, messageId: string) => Promise<void>;
  eventsAfter: (owner: Owner, chatId: string, afterId: string) => Promise<WebEvent[]>;
  subscribe: (owner: Owner, chatId: string, wake: () => void) => () => void;
}

/** The owner's answer to a question; false when it does not count (see `Approvals.decide`). */
export type DecideApproval = (
  id: string,
  decision: 'approved' | 'denied',
  from: { channel: string; chatId: string },
) => Promise<boolean>;

export interface ChatDeps {
  db: Db;
  logger: Logger;
  events: ChatEvents;
  decide: DecideApproval;
  /** The same pipeline entry the Telegram channel uses. */
  ingest: (message: InboundMessage) => Promise<void>;
  /** How long a quiet stream waits before a keep-alive line. */
  keepAliveMs?: number;
}

const JSON_TYPE = /^application\/json\s*(;|$)/i;
const KEEP_ALIVE_MS = 15_000;
/** With no `messageId` the server makes one: the message is then not safe to resend. */
const post = z.object({
  text: z.string().min(1).max(4096),
  messageId: z
    .string()
    .min(1)
    .max(100)
    .default(() => randomUUID()),
});

const answer = z.object({ decision: z.enum(['approved', 'denied']) });
const APPROVAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An event id is a number; anything else means "from the start". */
function cursorOf(value: string | undefined): string {
  return value !== undefined && /^\d{1,18}$/.test(value) ? value : '0';
}

/** Send every stored event after `cursor`; returns the new cursor. */
async function drain(
  deps: ChatDeps,
  who: { owner: Owner; chatId: string },
  out: SSEStreamingApi,
  from: string,
): Promise<string> {
  let cursor = from;
  for (;;) {
    const found = await deps.events.eventsAfter(who.owner, who.chatId, cursor);
    for (const event of found) {
      await out.writeSSE({
        id: event.id,
        event: event.kind,
        data: JSON.stringify({ ref: event.ref, text: event.text }),
      });
      cursor = event.id;
    }
    if (found.length < WEB_EVENT_PAGE) return cursor;
  }
}

/** Replay what is stored after the last id the browser saw, then push new events as they come. */
function stream(c: Context<Signed>, deps: ChatDeps): Response | Promise<Response> {
  const session = c.get('session');
  const who = { owner: session, chatId: session.sessionId };
  const keepAliveMs = deps.keepAliveMs ?? KEEP_ALIVE_MS;
  const token = getCookie(c, COOKIE) ?? '';
  let cursor = cursorOf(c.req.header('last-event-id') ?? c.req.query('after'));
  // Tells a proxy in front not to hold the stream back.
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (out) => {
    // Properties, not variables: the callbacks below change them while the loop waits.
    const state = { pending: true, open: true, wake: (): void => undefined };
    // Read through functions: the compiler cannot see the callbacks change them.
    const isOpen = (): boolean => state.open;
    const isPending = (): boolean => state.pending;
    const unsubscribe = deps.events.subscribe(who.owner, who.chatId, () => {
      state.pending = true;
      state.wake();
    });
    out.onAbort(() => {
      state.open = false;
      state.wake();
    });
    try {
      while (isOpen()) {
        state.pending = false;
        cursor = await drain(deps, who, out, cursor);
        if (isPending()) continue;
        const quiet = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            resolve(true);
          }, keepAliveMs);
          state.wake = () => {
            clearTimeout(timer);
            resolve(false);
          };
        });
        if (!quiet || !isOpen()) continue;
        // A person who signed out (or whose session ended) stops receiving at the next tick.
        if ((await sessionOwner(deps.db, sha256(token))) === undefined) break;
        await out.write(': keep-alive\n\n');
      }
    } catch (error) {
      // The browser gets a fixed word, never the database's own message.
      deps.logger.error({ err: error }, 'chat stream failed');
      await out.writeSSE({ event: 'error', data: 'stream_failed' });
    } finally {
      unsubscribe();
    }
  });
}

/** `POST /chat` sends a message; `GET /chat/events` is the live stream of this session's events. Mounted after the session gate. */
export function chatRoutes(routes: Hono<Signed>, deps: ChatDeps): void {
  routes.post('/chat', async (c) => {
    // JSON only, so a form post from another site cannot send a message as the person.
    if (!JSON_TYPE.test(c.req.header('content-type') ?? '')) {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }
    const parsed = post.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const session = c.get('session');
    const chatId = session.sessionId;
    await deps.events.acknowledge(session, chatId, parsed.data.messageId);
    await deps.ingest({ channel: 'web', chatId, ...parsed.data });
    return c.json({ ok: true, messageId: parsed.data.messageId }, 202);
  });
  routes.post('/chat/approvals/:id', async (c) => {
    if (!JSON_TYPE.test(c.req.header('content-type') ?? '')) {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }
    const parsed = answer.safeParse(await c.req.json().catch(() => undefined));
    const id = c.req.param('id');
    if (!parsed.success || !APPROVAL_ID.test(id)) return c.json({ error: 'invalid_request' }, 400);
    // The answer counts only from the session the question was shown on.
    const counted = await deps.decide(id, parsed.data.decision, {
      channel: 'web',
      chatId: c.get('session').sessionId,
    });
    return counted ? c.json({ ok: true }) : c.json({ error: 'not_open' }, 409);
  });
  routes.get('/chat/events', (c) => stream(c, deps));
}
