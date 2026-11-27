import { useEffect, useState } from 'react';
import { whoAmI } from '../api.ts';
import { Audit } from './Audit.tsx';
import { Budgets } from './Budgets.tsx';
import { Chat } from './Chat.tsx';
import { Profiles } from './Profiles.tsx';
import { Security } from './Security.tsx';
import { Users } from './Users.tsx';

interface SignedProps {
  onSignedOut: () => void;
}

type View = 'chat' | 'security' | 'users' | 'profiles' | 'budgets' | 'audit';

// The screens of a signed-in person: the chat, the account's security page and, for the admin, the people and access pages.
export function Signed({ onSignedOut }: SignedProps) {
  const [view, setView] = useState<View>('chat');
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void whoAmI().then((answer) => {
      if (answer.ok) setAdmin(answer.data.user?.role === 'admin');
    });
  }, []);
  const go = (next: View) => () => {
    setView(next);
  };
  if (view === 'security') return <Security onBack={go('chat')} onSignedOut={onSignedOut} />;
  if (view === 'users') return <Users onBack={go('chat')} onSignedOut={onSignedOut} />;
  if (view === 'profiles') return <Profiles onBack={go('chat')} onSignedOut={onSignedOut} />;
  if (view === 'budgets') return <Budgets onBack={go('chat')} onSignedOut={onSignedOut} />;
  if (view === 'audit') return <Audit onBack={go('chat')} onSignedOut={onSignedOut} />;
  return (
    <Chat
      onSignedOut={onSignedOut}
      onSecurity={go('security')}
      {...(admin
        ? {
            onUsers: go('users'),
            onProfiles: go('profiles'),
            onBudgets: go('budgets'),
            onAudit: go('audit'),
          }
        : {})}
    />
  );
}
