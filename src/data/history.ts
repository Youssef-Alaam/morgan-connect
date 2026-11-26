import type { Db } from './db.js';
import type { Owner } from './tenancy.js';

export interface StoredToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * One step of a chat, as the model needs to see it again: what the user said, what the model said
 * (with the tool calls it made), and what each tool answered (matched to its call by `id`).
 */
export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: StoredToolCall[] }
  | { role: 'tool'; text: string; id: string; name: string; isError: boolean };

export interface ChatKey {
  channel: string;
  chatId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The stored row back to a message; a tool row without its id and name is damaged and dropped. */
function fromRow(row: {
  role: ChatMessage['role'];
  text: string;
  data: unknown;
}): ChatMessage | undefined {
  const { role, text, data } = row;
  if (role === 'tool') {
    if (!isRecord(data) || typeof data['id'] !== 'string' || typeof data['name'] !== 'string') {
      return undefined;
    }
    return { role, text, id: data['id'], name: data['name'], isError: data['isError'] === true };
  }
  if (role === 'user' || !isRecord(data)) return { role, text };
  const calls = Array.isArray(data['toolCalls']) ? data['toolCalls'] : [];
  const toolCalls = calls.flatMap((call: unknown): StoredToolCall[] => {
    if (!isRecord(call) || typeof call['id'] !== 'string' || typeof call['name'] !== 'string') {
      return [];
    }
    return [
      { id: call['id'], name: call['name'], args: isRecord(call['args']) ? call['args'] : {} },
    ];
  });
  return toolCalls.length === 0 ? { role, text } : { role, text, toolCalls };
}

function toData(message: ChatMessage): string | null {
  if (message.role === 'tool') {
    return JSON.stringify({ id: message.id, name: message.name, isError: message.isError });
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return JSON.stringify({ toolCalls: message.toolCalls });
  }
  return null;
}

const size = (message: ChatMessage): number => message.text.length + (toData(message)?.length ?? 0);

/** A stored tool result is cut to this many characters; the model saw all of it during the turn. */
const MAX_TOOL_TEXT = 4000;
const TRUNCATED = ' [truncated]';
const capped = (text: string): string =>
  text.length <= MAX_TOOL_TEXT ? text : text.slice(0, MAX_TOOL_TEXT) + TRUNCATED;

/** Every tool call is answered at once by its result, and no result stands alone. */
function isWellFormed(turn: readonly ChatMessage[]): boolean {
  let open = new Set<string>();
  for (const m of turn) {
    if (m.role === 'tool') {
      if (!open.delete(m.id)) return false;
    } else if (open.size > 0) {
      return false;
    } else if (m.role === 'assistant') {
      open = new Set((m.toolCalls ?? []).map((c) => c.id));
    }
  }
  return open.size === 0;
}

/**
 * The newest `turns` user turns of a chat (each with its answers, tool calls and results) that fit
 * in `maxChars`, oldest first. The cut falls only where a user message starts, so the list never
 * starts on an answer or a tool result and a call is never parted from its result. A turn that is
 * damaged (a call without its result, or the reverse) is left out whole.
 */
export async function loadHistory(
  db: Db,
  chat: ChatKey,
  turns: number,
  maxChars: number,
): Promise<ChatMessage[]> {
  const rows = await newestRows(db, chat, turns);
  const kept: ChatMessage[] = [];
  let used = 0;
  for (const row of rows) {
    const message = fromRow(row);
    if (message === undefined) continue;
    used += size(message);
    if (used > maxChars) break;
    kept.unshift(message);
  }
  const groups: ChatMessage[][] = [];
  for (const m of kept) {
    if (m.role === 'user') groups.push([m]);
    else groups.at(-1)?.push(m);
  }
  return groups.filter(isWellFormed).flat();
}

/** Rows of the newest `turns` user turns, newest first. */
async function newestRows(db: Db, chat: ChatKey, turns: number) {
  const mine = db
    .selectFrom('chat_messages')
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId);
  const start = await mine
    .select('id')
    .where('role', '=', 'user')
    .orderBy('id', 'desc')
    .offset(turns - 1)
    .limit(1)
    .executeTakeFirst();
  return (start === undefined ? mine : mine.where('id', '>=', start.id))
    .select(['role', 'text', 'data'])
    .orderBy('id', 'desc')
    .execute();
}

/**
 * A turn that ended early (stopped, timed out or failed) as it should be remembered: every tool
 * call still waiting for a result gets an "aborted" error result, then a note that the turn stopped.
 */
export function closeStoppedTurn(partial: readonly ChatMessage[]): ChatMessage[] {
  const answered = new Set(partial.flatMap((m) => (m.role === 'tool' ? [m.id] : [])));
  const open = partial.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []) : []));
  return [
    ...partial,
    ...open
      .filter((c) => !answered.has(c.id))
      .map((c): ChatMessage => ({
        role: 'tool',
        id: c.id,
        name: c.name,
        text: 'aborted',
        isError: true,
      })),
    { role: 'assistant', text: '(turn stopped)' },
  ];
}

/** Add messages in order, all or none, for the owner of the turn that made them. */
export async function appendHistory(
  db: Db,
  chat: ChatKey,
  messages: readonly ChatMessage[],
  owner: Owner,
): Promise<void> {
  if (messages.length === 0) return;
  await db
    .insertInto('chat_messages')
    .values(
      messages.map((m) => ({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        channel: chat.channel,
        chat_id: chat.chatId,
        role: m.role,
        text: m.role === 'tool' ? capped(m.text) : m.text,
        data: toData(m),
      })),
    )
    .execute();
}

/** `/new`: forget the conversation in this chat. */
export async function clearHistory(db: Db, chat: ChatKey): Promise<void> {
  await db
    .deleteFrom('chat_messages')
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .execute();
}
