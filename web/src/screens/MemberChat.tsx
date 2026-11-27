import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { readMemberChat, type MemberMessage } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { ChatBubble } from '../components/ChatBubble.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

const K = 'audit.read';

interface ReasonProps {
  busy: boolean;
  onOpen: (reason: string) => void;
}

/** The reason comes first: it is written to the audit log before any message is shown. */
function ReasonForm({ busy, onOpen }: ReasonProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onOpen(reason.trim());
  };
  return (
    <form className="screen-form" onSubmit={submit}>
      <TextInput
        label={t(`${K}.reason`)}
        hint={t(`${K}.reasonHint`)}
        value={reason}
        maxLength={500}
        required
        onChange={typed(setReason)}
      />
      <Button type="submit" disabled={busy || reason.trim() === ''}>
        {t(`${K}.open`)}
      </Button>
    </form>
  );
}

function Messages({ messages, person }: { messages: MemberMessage[]; person: string }) {
  const { t } = useTranslation();
  return (
    <div className="chat-log" role="log" aria-label={t(`${K}.log`, { person })}>
      {messages.length === 0 ? <p>{t(`${K}.empty`)}</p> : null}
      {messages.map((message) => (
        <ChatBubble
          key={message.id}
          from={message.role === 'user' ? 'user' : 'morgan'}
          author={t(`${K}.role.${message.role}`)}
        >
          {message.text}
        </ChatBubble>
      ))}
    </div>
  );
}

interface MemberChatProps {
  /** The member and what to call them in the title. */
  member: { id: string; name: string };
  onClose: () => void;
  /** Called after each try, because the read (or its refusal) is now the newest row of the log. */
  onRead: () => void;
}

/** A member's chat, read-only, behind a reason. */
export function MemberChat({ member, onClose, onRead }: MemberChatProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<MemberMessage[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const open = (reason: string) => {
    setError(undefined);
    setBusy(true);
    void readMemberChat(member.id, reason).then((answer) => {
      setBusy(false);
      if (answer.ok) setMessages(answer.data.messages);
      else setError(answer.error);
      onRead();
    });
  };
  return (
    <Dialog
      open
      title={t(`${K}.title`, { person: member.name })}
      closeLabel={t(`${K}.close`)}
      onClose={onClose}
    >
      <ErrorBanner error={error} />
      {messages === undefined ? (
        <ReasonForm busy={busy} onOpen={open} />
      ) : (
        <Messages messages={messages} person={member.name} />
      )}
    </Dialog>
  );
}
