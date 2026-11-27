import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage, standing } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { ChatBubble } from '../components/ChatBubble.tsx';
import { Composer } from '../components/Composer.tsx';
import { ApprovalLine } from './ApprovalLine.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { TopBar } from './TopBar.tsx';
import { useDecide } from './useDecide.ts';
import { apply, followEvents, type Line } from '../events.ts';

interface ChatProps {
  onSignedOut: () => void;
  onSecurity: () => void;
  /** Given only to the admin. */
  onUsers?: () => void;
  onProfiles?: () => void;
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

/** The buttons that open the other pages; People and Access only for the admin. */
function PageButtons({
  onSecurity,
  onUsers,
  onProfiles,
}: {
  onSecurity: () => void;
  onUsers: (() => void) | undefined;
  onProfiles: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <>
      {onUsers === undefined ? null : (
        <Button variant="secondary" onClick={onUsers}>
          {t('users.open')}
        </Button>
      )}
      {onProfiles === undefined ? null : (
        <Button variant="secondary" onClick={onProfiles}>
          {t('profiles.open')}
        </Button>
      )}
      <Button variant="secondary" onClick={onSecurity}>
        {t('security.title')}
      </Button>
    </>
  );
}

// Talk to Morgan: your messages go out over POST, Morgan's answers arrive on the live stream.
export function Chat({ onSignedOut, onSecurity, onUsers, onProfiles }: ChatProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<Line[]>([]);
  const broken = useStream(setLines, onSignedOut);
  const { decide, error } = useDecide(setLines);

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
      <TopBar onSignedOut={onSignedOut}>
        <PageButtons onSecurity={onSecurity} onUsers={onUsers} onProfiles={onProfiles} />
      </TopBar>
      <p role="status">{broken ? t('chat.reconnecting') : ''}</p>
      <ErrorBanner error={error} />
      <div className="chat-log" role="log" aria-label={t('chat.log')}>
        {lines.map((line) =>
          line.approval === undefined ? (
            <ChatBubble
              key={line.id}
              from={line.from}
              author={t(line.from === 'user' ? 'chat.you' : 'chat.morgan')}
            >
              {line.text}
              {line.state === 'failed' ? ` (${t('chat.failed')})` : ''}
            </ChatBubble>
          ) : (
            <ApprovalLine
              key={line.id}
              approval={line.approval}
              text={line.text}
              onDecide={decide}
            />
          ),
        )}
      </div>
      <Composer label={t('chat.message')} sendLabel={t('chat.send')} onSend={send} />
    </main>
  );
}
