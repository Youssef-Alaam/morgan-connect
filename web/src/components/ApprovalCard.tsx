import { useId } from 'react';
import type { ReactNode } from 'react';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';

interface ApprovalCardProps {
  title: string;
  approveLabel: string;
  denyLabel: string;
  onApprove: () => void;
  onDeny: () => void;
  // Set once decided: the card shows it in place of the buttons.
  outcome?: string;
  children: ReactNode;
}

export function ApprovalCard(props: ApprovalCardProps) {
  const { title, approveLabel, denyLabel, onApprove, onDeny, outcome, children } = props;
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="approval">
      <h3 id={titleId}>{title}</h3>
      <p>{children}</p>
      {outcome === undefined ? (
        <div className="approval-actions">
          <Button onClick={onApprove}>{approveLabel}</Button>
          <Button variant="secondary" onClick={onDeny}>
            {denyLabel}
          </Button>
        </div>
      ) : (
        <Badge>{outcome}</Badge>
      )}
    </div>
  );
}
