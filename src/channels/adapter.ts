import type { ChannelSender, InboundMessage } from '../core/index.js';

/** The owner's tap on Approve or Deny, with the chat it came from. */
export interface ApprovalAnswer {
  id: string;
  decision: 'approved' | 'denied';
  channel: string;
  chatId: string;
}

/** A channel that receives messages and can reply on the same chat. */
export interface ChannelAdapter extends ChannelSender {
  askApproval: NonNullable<ChannelSender['askApproval']>;
  /** Begin receiving. Resolves once the channel is connected. */
  start: (
    onMessage: (message: InboundMessage) => Promise<void>,
    /** True when the answer counted. */
    onApproval?: (answer: ApprovalAnswer) => Promise<boolean>,
  ) => Promise<void>;
  stop: () => Promise<void>;
}
