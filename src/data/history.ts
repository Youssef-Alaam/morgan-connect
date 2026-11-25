import type { Db } from './db.js';

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

/** The stored row back to a message. A row without `data` (or with unreadable data) is plain text. */
function fromRow(row: { role: ChatMessage['role']; text: string; data: unknown }): ChatMessage {
  const { role, text, data } = row;
  if (role === 'user' || !isRecord(data))
    return { role: role === 'tool' ? 'assistant' : role, text };
  if (role === 'tool') {
    const { id, name, isError } = data;
    if (typeof id === 'string' && typeof name === 'string') {
      return { role, text, id, name, isError: isError === true };
    }
    return { role: 'assistant', text };
  }
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

/**
 * The last `limit` messages of a chat that fit in `maxChars`, oldest first. The newest messages
 * are kept, and the cut falls only where a user message starts: the list never starts on an answer
 * or a tool result, and a tool call is never parted from its result.
 */
export async function loadHistory(
  db: Db,
  chat: ChatKey,
  limit: number,
  maxChars: number,
): Promise<ChatMessage[]> {
  const rows = await db
    .selectFrom('chat_messages')
    .select(['role', 'text', 'data'])
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  const kept: ChatMessage[] = [];
  let used = 0;
  for (const row of rows) {
    const message = fromRow(row);
    used += size(message);
    if (used > maxChars) break;
    kept.unshift(message);
  }
  while (kept.length > 0 && kept[0]?.role !== 'user') kept.shift();
  return kept;
}

/** Add messages in order, all or none. */
export async function appendHistory(
  db: Db,
  chat: ChatKey,
  messages: readonly ChatMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  await db
    .insertInto('chat_messages')
    .values(
      messages.map((m) => ({
        channel: chat.channel,
        chat_id: chat.chatId,
        role: m.role,
        text: m.text,
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
