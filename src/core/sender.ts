export interface ChannelSender {
  readonly channel: string;
  send: (chatId: string, text: string) => Promise<void>;
  /** Show a "typing" signal on the chat, if the channel has one. */
  typing?: (chatId: string) => Promise<void>;
}
