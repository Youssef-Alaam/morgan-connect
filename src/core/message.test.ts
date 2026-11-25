import { describe, expect, it } from 'vitest';
import { PipelineError } from './errors.js';
import { parseInbound } from './message.js';
import { SEND_RETRIES, sendWithRetry } from './retry.js';

const valid = { channel: 'fake', chatId: '42', messageId: '7', text: 'hello' };

describe('internal message format', () => {
  it('accepts a complete message', () => {
    expect(parseInbound(valid)).toEqual(valid);
  });

  it.each([
    ['null', null],
    ['no text', { ...valid, text: '' }],
    ['numeric chat id', { ...valid, chatId: 42 }],
    ['missing channel', { chatId: '42', messageId: '7', text: 'hi' }],
  ])('rejects %s with invalid_message', (_name, raw) => {
    expect(() => parseInbound(raw)).toThrow(PipelineError);
    expect(() => parseInbound(raw)).toThrow(/Invalid message fields/);
  });

  it('keeps the message body out of the error', () => {
    expect(() => parseInbound({ ...valid, chatId: 1, text: 'secret body' })).not.toThrow(
      /secret body/,
    );
  });
});

describe('sendWithRetry', () => {
  it('retries three times after the first attempt, then throws send_failed', async () => {
    let calls = 0;
    const failing = (): Promise<void> => {
      calls += 1;
      return Promise.reject(new Error('down'));
    };
    const error = await sendWithRetry(failing, 0).catch((e: unknown) => e);
    expect(calls).toBe(1 + SEND_RETRIES);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error).toMatchObject({ kind: 'send_failed' });
  });
});
