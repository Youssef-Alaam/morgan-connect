import { z } from 'zod';

const data = z.object({ ref: z.string().nullable(), text: z.string() });
export interface SseEvent {
  id: string;
  event: string;
  data: z.infer<typeof data>;
}

/** One block of a stream as an event, or undefined for a comment (keep-alive) block. */
function parseBlock(block: string): SseEvent | undefined {
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}: ?(.*)$`, 'm').exec(block)?.[1];
  const id = field('id');
  if (id === undefined) return undefined;
  const body = data.parse(JSON.parse(field('data') ?? 'null'));
  return { id, event: field('event') ?? 'message', data: body };
}

/** Read `count` events from a server-sent stream (comment lines skipped), then close it. */
export async function readEvents(response: Response, count: number): Promise<SseEvent[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('The response has no body');
  const decoder = new TextDecoder();
  const found: SseEvent[] = [];
  let buffer = '';
  try {
    while (found.length < count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value as Uint8Array, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      found.push(...blocks.map(parseBlock).filter((event) => event !== undefined));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (found.length < count) throw new Error(`Got ${String(found.length)} of ${String(count)}`);
  return found;
}
