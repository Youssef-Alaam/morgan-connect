import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listPeople, type AuditRow, type Person } from '../api.ts';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { FilterBar } from './AuditFilters.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { TopBar } from './TopBar.tsx';
import { useAudit } from './useAudit.ts';

const K = 'audit';
const BAD = new Set(['refused', 'denied', 'error']);

/** A moment as `year-month-day hour:minute`, UTC, the same wherever the admin is. */
const when = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

function Rows({ rows }: { rows: AuditRow[] }) {
  const { t } = useTranslation();
  const name = (email: string | null, id: string | null, none: string) =>
    email ?? (id === null ? none : t(`${K}.chatOnly`));
  return (
    <Table
      caption={t(`${K}.caption`)}
      columns={[
        t(`${K}.when`),
        t(`${K}.person`),
        t(`${K}.action`),
        t(`${K}.decision`),
        t(`${K}.outcome`),
      ]}
      rows={rows.map((row) => ({
        key: row.id,
        cells: [
          <span key="when" dir="ltr">
            {when(row.at)}
          </span>,
          <span key="person">
            {name(row.person, row.personId, t(`${K}.stranger`))}
            {row.subjectId === null ? null : (
              <span className="field-hint">
                {' '}
                {t(`${K}.about`, { who: name(row.subject, row.subjectId, '') })}
              </span>
            )}
          </span>,
          <span key="action">
            {row.actionType}
            {row.reason === null ? null : <span className="field-hint"> {row.reason}</span>}
          </span>,
          t(`${K}.${row.decision}`),
          <Badge key="outcome" tone={BAD.has(row.outcome) ? 'danger' : 'neutral'}>
            {t(`${K}.${row.outcome}`)}
          </Badge>,
        ],
      }))}
    />
  );
}

interface AuditProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The admin's read-only audit log: filter it, page back through it.
export function Audit({ onBack, onSignedOut }: AuditProps) {
  const { t } = useTranslation();
  const page = useAudit();
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    void listPeople().then((answer) => {
      if (answer.ok) setPeople(answer.data.people);
    });
  }, []);
  return (
    <main className="page screen screen-wide">
      <TopBar onSignedOut={onSignedOut}>
        <Button variant="secondary" onClick={onBack}>
          {t(`${K}.back`)}
        </Button>
      </TopBar>
      <h2>{t(`${K}.title`)}</h2>
      <ErrorBanner error={page.error} />
      <FilterBar
        filters={page.filters}
        people={people}
        actions={page.actions}
        onChange={page.setFilters}
      />
      {page.rows === undefined ? (
        page.error === undefined ? (
          <p>{t('app.loading')}</p>
        ) : null
      ) : page.rows.length === 0 ? (
        <p>{t(`${K}.none`)}</p>
      ) : (
        <Rows rows={page.rows} />
      )}
      {page.more ? <Button onClick={page.older}>{t(`${K}.older`)}</Button> : null}
    </main>
  );
}
