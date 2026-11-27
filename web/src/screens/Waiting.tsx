import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { answerTopup, listTopups, type WaitingTopup } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { usd } from './money.ts';

const K = 'budgets.waiting';

type Decision = 'approved' | 'refused';
interface Asking {
  topup: WaitingTopup;
  decision: Decision;
}

/** A moment as `year-month-day hour:minute`, UTC, the same wherever the admin is. */
const when = (iso: string): string => iso.slice(0, 16).replace('T', ' ');
const nameOf = (topup: WaitingTopup, none: string): string => topup.email ?? none;

interface ListProps {
  topups: WaitingTopup[];
  onAsk: (asking: Asking) => void;
}

function WaitingTable({ topups, onAsk }: ListProps) {
  const { t } = useTranslation();
  return (
    <Table
      caption={t(`${K}.caption`)}
      columns={[
        t(`${K}.person`),
        t(`${K}.amount`),
        t(`${K}.month`),
        t(`${K}.asked`),
        t(`${K}.actions`),
      ]}
      rows={topups.map((topup) => {
        const person = nameOf(topup, t('budgets.chatOnly'));
        const button = (decision: Decision) => (
          <Button
            variant="secondary"
            aria-label={
              decision === 'approved'
                ? t(`${K}.approveNamed`, { amount: usd(topup.amountUsd), person })
                : t(`${K}.refuseNamed`, { person })
            }
            onClick={() => {
              onAsk({ topup, decision });
            }}
          >
            {t(`${K}.${decision === 'approved' ? 'approve' : 'refuse'}`)}
          </Button>
        );
        return {
          key: topup.id,
          cells: [
            person,
            usd(topup.amountUsd),
            topup.month,
            when(topup.createdAt),
            <span key="actions">
              {button('approved')} {button('refused')}
            </span>,
          ],
        };
      })}
    />
  );
}

interface AskProps {
  asking: Asking | undefined;
  onConfirm: (asking: Asking) => void;
  onCancel: () => void;
}

/** The question before an answer is given: both answers are final, and each names the person and the amount. */
function AskAnswer({ asking, onConfirm, onCancel }: AskProps) {
  const { t } = useTranslation();
  if (asking === undefined) return null;
  const { topup, decision } = asking;
  const approve = decision === 'approved';
  return (
    <ConfirmDialog
      title={t(`${K}.${approve ? 'confirmApprove' : 'confirmRefuse'}`)}
      message={t(`${K}.${approve ? 'confirmApproveText' : 'confirmRefuseText'}`, {
        amount: usd(topup.amountUsd),
        person: nameOf(topup, t('budgets.chatOnly')),
        month: topup.month,
      })}
      confirmLabel={t(`${K}.${approve ? 'approve' : 'refuse'}`)}
      tone={approve ? 'primary' : 'danger'}
      onConfirm={() => {
        onConfirm(asking);
      }}
      onCancel={onCancel}
    />
  );
}

/** The requests for more waiting for the admin; `onAnswered` lets the page reload what an approval changed. */
export function Waiting({ onAnswered }: { onAnswered: () => void }) {
  const { t } = useTranslation();
  const [topups, setTopups] = useState<WaitingTopup[]>();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<Asking>();
  const load = useCallback(() => {
    void listTopups().then((answer) => {
      if (answer.ok) setTopups(answer.data.topups);
      else setError(answer.error);
    });
  }, []);
  useEffect(load, [load]);
  const answer = ({ topup, decision }: Asking) => {
    setAsking(undefined);
    setError(undefined);
    void answerTopup(topup.id, decision).then((done) => {
      if (!done.ok) setError(done.error);
      // Whatever the answer, what is waiting and what each person may spend have changed.
      load();
      onAnswered();
    });
  };
  return (
    <section>
      <h3>{t(`${K}.title`)}</h3>
      <ErrorBanner error={error} />
      {topups === undefined || topups.length > 0 ? null : <p>{t(`${K}.none`)}</p>}
      {topups !== undefined && topups.length > 0 ? (
        <WaitingTable topups={topups} onAsk={setAsking} />
      ) : null}
      <AskAnswer
        asking={asking}
        onConfirm={answer}
        onCancel={() => {
          setAsking(undefined);
        }}
      />
    </section>
  );
}
