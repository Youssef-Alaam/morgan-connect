import type { ChannelSender, InboundMessage } from '../core/index.js';

/** A channel that receives messages and can reply on the same chat. */
export interface ChannelAdapter extends ChannelSender {
  /** Begin receiving. Resolves once the channel is connected. */
  start: (onMessage: (message: InboundMessage) => Promise<void>) => Promise<void>;
  stop: () => Promise<void>;
}
