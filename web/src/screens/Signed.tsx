import { useState } from 'react';
import { Chat } from './Chat.tsx';
import { Security } from './Security.tsx';

// The screens of a signed-in person: the chat, and the account's security page one button away.
export function Signed({ onSignedOut }: { onSignedOut: () => void }) {
  const [view, setView] = useState<'chat' | 'security'>('chat');
  const show = (next: typeof view) => () => {
    setView(next);
  };
  return view === 'security' ? (
    <Security onBack={show('chat')} onSignedOut={onSignedOut} />
  ) : (
    <Chat onSignedOut={onSignedOut} onSecurity={show('security')} />
  );
}
