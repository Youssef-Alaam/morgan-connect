/** The turn running right now in each chat, so `/stop` in that chat can abort it. */
export interface TurnAborts {
  /** Start tracking a chat's turn; the returned signal fires when `stop` is called. */
  begin: (channel: string, chatId: string) => AbortSignal;
  end: (channel: string, chatId: string) => void;
  /** Abort the chat's running turn. False when nothing is running. */
  stop: (channel: string, chatId: string) => boolean;
}

export function createTurnAborts(): TurnAborts {
  const running = new Map<string, AbortController>();
  const key = (channel: string, chatId: string): string => `${channel}:${chatId}`;
  return {
    begin: (channel, chatId) => {
      const controller = new AbortController();
      running.set(key(channel, chatId), controller);
      return controller.signal;
    },
    end: (channel, chatId) => {
      running.delete(key(channel, chatId));
    },
    stop: (channel, chatId) => {
      const controller = running.get(key(channel, chatId));
      controller?.abort();
      return controller !== undefined;
    },
  };
}
