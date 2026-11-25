import type { ChannelSender } from '../../src/core/index.js';

/** A channel for tests: records what it was asked to send; can be told to fail or hang. */
export class FakeChannel implements ChannelSender {
  readonly channel = 'fake';
  readonly attempts: { chatId: string; text: string }[] = [];
  failures = 0;
  hang = false;

  async send(chatId: string, text: string): Promise<void> {
    this.attempts.push({ chatId, text });
    if (this.hang) await new Promise<void>(() => undefined);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('channel is down');
    }
    return Promise.resolve();
  }
}
