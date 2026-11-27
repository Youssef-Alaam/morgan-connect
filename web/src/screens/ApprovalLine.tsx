import { useTranslation } from 'react-i18next';
import { ApprovalCard } from '../components/ApprovalCard.tsx';
import type { Approval } from '../events.ts';

interface ApprovalLineProps {
  approval: Approval;
  /** The server's text: a first line saying what, then the exact arguments. */
  text: string;
  onDecide: (id: string, decision: 'approved' | 'denied') => void;
}

/** The question as the server wrote it: its first line, and the arguments after it, unchanged. */
export function splitQuestion(text: string): { what: string; args?: string } {
  const at = text.indexOf('\n');
  return at < 0 ? { what: text } : { what: text.slice(0, at), args: text.slice(at + 1) };
}

// A question in the chat: Approve and Deny while it is open, the outcome once it is not.
export function ApprovalLine({ approval, text, onDecide }: ApprovalLineProps) {
  const { t } = useTranslation();
  const { what, args } = splitQuestion(text);
  const outcome = approval.outcome;
  return (
    <ApprovalCard
      title={t('chat.approval.title')}
      approveLabel={t('chat.approval.approve')}
      denyLabel={t('chat.approval.deny')}
      onApprove={() => {
        onDecide(approval.id, 'approved');
      }}
      onDeny={() => {
        onDecide(approval.id, 'denied');
      }}
      {...(args === undefined ? {} : { args })}
      {...(outcome === undefined ? {} : { outcome: t(`chat.approval.${outcome}`) })}
    >
      {what}
    </ApprovalCard>
  );
}
