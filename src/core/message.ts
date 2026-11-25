import { z } from 'zod';
import { PipelineError } from './errors.js';

/** The one message shape every channel is turned into before it enters the core (L4 to L5). */
const inboundMessageSchema = z.object({
  channel: z.string().min(1),
  chatId: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string().min(1),
});

export type InboundMessage = z.infer<typeof inboundMessageSchema>;

/** Check a payload from any channel before use. Throws `PipelineError` (`invalid_message`). */
export function parseInbound(raw: unknown): InboundMessage {
  const result = inboundMessageSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new PipelineError('invalid_message', `Invalid message fields: ${fields.join(', ')}`);
  }
  return result.data;
}

/** The key that makes one incoming message produce one turn, however often it is delivered. */
export function idempotencyKey(message: InboundMessage): string {
  return `${message.channel}:${message.chatId}:${message.messageId}`;
}
