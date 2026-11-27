import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage, standing } from '../api.ts';
import { ChatBubble } from '../components/ChatBubble.tsx';
import { Composer } from '../components/Composer.tsx';
import { apply, followEvents, type Line } from '../events.ts';

interface ChatProps {
  onSignedOut: () => void;
}

/** Follow the live stream into the lines; true while it is broken. A session that ended means sign in again. */
function useStream(setLines: Dispatch<SetStateAction<Line[]>>, onSignedOut: () => void): boolean {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    return followEvents(
      {
        onEvent: (event) => {
          setLines((now) => apply(now, event));
        },
        onOpen: () => {
          setBroken(false);
        },
        onBroken: () => {
          setBroken(true);
        },
        onEnded: onSignedOut,
      },
      standing,
    );
  }, [setLines, onSignedOut]);
  return broken;
}

// Talk to Morgan: your messages go out over POST, Morgan's answers arrive on the live stream.
export function Chat({ onSignedOut }: ChatProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<Line[]>([]);
  const broken = useStream(setLines, onSignedOut);

  const send = (text: string) => {
    const id = crypto.randomUUID();
    const set = (state: NonNullable<Line['state']>) => {
      setLines((now) => now.map((line) => (line.id === id ? { ...line, state } : line)));
    };
    setLines((now) => [...now, { id, from: 'user', text, state: 'sending' }]);
    void sendMessage(text, id).then((answer) => {
      if (!answer.ok) set('failed');
    });
  };

  return (
    <main className="page chat">
      <h1>{t('app.name')}</h1>
      <p role="status">{broken ? t('chat.reconnecting') : ''}</p>
      <div className="chat-log" role="log" aria-label={t('chat.log')}>
        {lines.map((line) => (
          <ChatBubble
            key={line.id}
            from={line.from}
            author={t(line.from === 'user' ? 'chat.you' : 'chat.morgan')}
          >
            {line.text}
            {line.state === 'failed' ? ` (${t('chat.failed')})` : ''}
          </ChatBubble>
        ))}
      </div>
      <Composer label={t('chat.message')} sendLabel={t('chat.send')} onSend={send} />
    </main>
  );
}
