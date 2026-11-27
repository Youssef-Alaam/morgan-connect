import { useState, type Dispatch, type SetStateAction } from 'react';
import { decideApproval } from '../api.ts';
import type { Approval, Line } from '../events.ts';

/** Still waiting for the person, or for the server to take the answer. */
const stillOpen = (outcome: Approval['outcome']): boolean =>
  outcome === undefined || outcome === 'sending';

/**
 * The person's answer to a question in the chat. The card shows `sending` at once, so a second
 * click has nothing to press. A 409 means the question is over. What the stream says about how it
 * ended is never overwritten by the answer's own result.
 */
export function useDecide(setLines: Dispatch<SetStateAction<Line[]>>) {
  const [error, setError] = useState<string>();
  const show = (id: string, outcome: Approval['outcome']) => {
    setLines((now) =>
      now.map((line) =>
        line.approval?.id === id && stillOpen(line.approval.outcome)
          ? { ...line, approval: outcome === undefined ? { id } : { id, outcome } }
          : line,
      ),
    );
  };
  const decide = (id: string, decision: 'approved' | 'denied') => {
    setError(undefined);
    show(id, 'sending');
    void decideApproval(id, decision).then((answer) => {
      if (answer.ok) show(id, decision);
      else if (answer.status === 409) show(id, 'invalid');
      else {
        show(id, undefined);
        setError(answer.error);
      }
    });
  };
  return { decide, error };
}
