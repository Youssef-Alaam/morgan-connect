import type { ChannelSender, InboundMessage } from '../core/index.js';

/** The owner's tap on Approve or Deny, with the chat it came from. */
export interface ApprovalAnswer {
  id: string;
  decision: 'approved' | 'denied';
  channel: string;
  chatId: string;
}

/** What came of a tap on "Ask for more". */
export type AskMoreAnswer = 'sent' | 'open' | 'unneeded' | 'unavailable';

/** A channel that receives messages and can reply on the same chat. */
export interface ChannelAdapter extends ChannelSender {
  askApproval: NonNullable<ChannelSender['askApproval']>;
  /** Begin receiving. Resolves once the channel is connected. */
  start: (
    onMessage: (message: InboundMessage) => Promise<void>,
    /** True when the answer counted. */
    onApproval?: (answer: ApprovalAnswer) => Promise<boolean>,
    /** The person's tap on "Ask for more", from their own chat. */
    onAskMore?: (chat: { channel: string; chatId: string }) => Promise<AskMoreAnswer>,
  ) => Promise<void>;
  stop: () => Promise<void>;
}
