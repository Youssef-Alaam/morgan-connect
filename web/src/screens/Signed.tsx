import { useState } from 'react';
import { Chat } from './Chat.tsx';
import { Security } from './Security.tsx';

interface SignedProps {
  onSignedOut: () => void;
}

// The screens of a signed-in person: the chat, and the account's security page one button away.
export function Signed({ onSignedOut }: SignedProps) {
  const [view, setView] = useState<'chat' | 'security'>('chat');
  if (view === 'security') {
    return (
      <Security
        onBack={() => {
          setView('chat');
        }}
        onSignedOut={onSignedOut}
      />
    );
  }
  return (
    <Chat
      onSignedOut={onSignedOut}
      onSecurity={() => {
        setView('security');
      }}
    />
  );
}
