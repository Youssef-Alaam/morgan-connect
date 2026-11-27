import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listBudgets, type BudgetPerson, type Budgets as BudgetsData } from '../api.ts';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { EditLimits } from './EditLimits.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { plus, reached, usd } from './money.ts';
import { TopBar } from './TopBar.tsx';

const K = 'budgets';
/** What the server uses for a person with no cap of their own (spec D24). */
const DEFAULT_CAP = 2;

/** This month's limit: their own or the install's, plus what the admin approved for the month. Undefined: none. */
function limitOf(person: BudgetPerson, defaults: BudgetsData['defaults']): string | undefined {
  if (person.role === 'admin') return undefined;
  const base = person.limitUsd ?? defaults.limitUsd ?? undefined;
  return base === undefined ? undefined : plus(base, person.topupUsd);
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="secondary"
      aria-label={t(`${K}.edit.openNamed`, { person: name })}
      onClick={onClick}
    >
      {t(`${K}.edit.open`)}
    </Button>
  );
}

function BudgetTable({
  budgets,
  onEdit,
}: {
  budgets: BudgetsData;
  onEdit: (person: BudgetPerson) => void;
}) {
  const { t } = useTranslation();
  const { defaults } = budgets;
  return (
    <Table
      caption={t(`${K}.caption`, { month: budgets.month })}
      columns={[
        t(`${K}.person`),
        t(`${K}.spent`),
        t(`${K}.limit`),
        t(`${K}.topups`),
        t(`${K}.cap`),
        t(`${K}.step`),
        t(`${K}.actions`),
      ]}
      rows={budgets.people.map((person) => {
        const limit = limitOf(person, defaults);
        const name = person.email ?? t(`${K}.chatOnly`);
        const over = limit !== undefined && reached(person.spentUsd, limit);
        return {
          key: person.id,
          cells: [
            name,
            <Badge key="spent" tone={over ? 'danger' : 'neutral'}>
              {usd(person.spentUsd)}
              {over ? ` ${t(`${K}.over`)}` : ''}
            </Badge>,
            limit === undefined ? t(`${K}.noLimit`) : usd(limit),
            usd(person.topupUsd),
            String(person.taskCap ?? DEFAULT_CAP),
            usd(person.topupStepUsd ?? defaults.topupUsd ?? '0'),
            <EditButton
              key="edit"
              name={name}
              onClick={() => {
                onEdit(person);
              }}
            />,
          ],
        };
      })}
    />
  );
}

interface BudgetsProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The admin's page for money: each person's spend this month against their limit, task cap and top-up step.
export function Budgets({ onBack, onSignedOut }: BudgetsProps) {
  const { t } = useTranslation();
  const [budgets, setBudgets] = useState<BudgetsData>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<BudgetPerson>();
  const load = useCallback(() => {
    void listBudgets().then((answer) => {
      if (answer.ok) setBudgets(answer.data);
      else setError(answer.error);
    });
  }, []);
  useEffect(load, [load]);
  return (
    <main className="page screen screen-wide">
      <TopBar onSignedOut={onSignedOut}>
        <Button variant="secondary" onClick={onBack}>
          {t(`${K}.back`)}
        </Button>
      </TopBar>
      <h2>{t(`${K}.title`)}</h2>
      <ErrorBanner error={error} />
      {budgets === undefined ? (
        error === undefined ? (
          <p>{t('app.loading')}</p>
        ) : null
      ) : (
        <BudgetTable budgets={budgets} onEdit={setEditing} />
      )}
      {editing === undefined ? null : (
        <EditLimits
          key={editing.id}
          person={budgets?.people.find((p) => p.id === editing.id) ?? editing}
          name={editing.email ?? t(`${K}.chatOnly`)}
          onSaved={load}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </main>
  );
}
