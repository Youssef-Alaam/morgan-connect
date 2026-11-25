import { expect, it } from 'vitest';
import { parseTelegramUpdate } from './telegram.js';

const message = { message_id: 7, text: 'hi', chat: { id: -42 } };

it('maps a text update to the internal message', () => {
  expect(parseTelegramUpdate({ update_id: 1, message })).toEqual({
    channel: 'telegram',
    chatId: '-42',
    messageId: '7',
    text: 'hi',
  });
});

it('ignores a message with no text', () => {
  const photo = { update_id: 1, message: { ...message, text: undefined } };
  expect(parseTelegramUpdate(photo)).toBeUndefined();
});
