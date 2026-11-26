import { expect, it } from 'vitest';
import { parseApprovalCallback, parseTelegramUpdate } from './telegram.js';

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

const ID = '123e4567-e89b-12d3-a456-426614174000';
const tap = (data: string, chatId = 42): unknown => ({
  update_id: 2,
  callback_query: { id: 'q', data, message: { message_id: 7, chat: { id: chatId } } },
});

it('maps Approve and Deny taps to an answer with the chat they came from', () => {
  expect(parseApprovalCallback(tap(`ap:y:${ID}`))).toEqual({
    id: ID,
    decision: 'approved',
    channel: 'telegram',
    chatId: '42',
  });
  expect(parseApprovalCallback(tap(`ap:n:${ID}`, -7))).toMatchObject({
    decision: 'denied',
    chatId: '-7',
  });
});

it('ignores any other tap or update', () => {
  expect(parseApprovalCallback(tap('something else'))).toBeUndefined();
  expect(parseApprovalCallback(tap(`ap:x:${ID}`))).toBeUndefined();
  expect(parseApprovalCallback(tap('ap:y:not-an-id'))).toBeUndefined();
  expect(parseApprovalCallback({ update_id: 1, message })).toBeUndefined();
});
