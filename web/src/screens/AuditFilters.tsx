import { useTranslation } from 'react-i18next';
import type { AuditFilters, Person } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { Select } from '../components/Select.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { NO_FILTERS } from './useAudit.ts';

const K = 'audit';
const DECISIONS = ['auto', 'ask', 'off'];
const OUTCOMES = ['ok', 'error', 'refused', 'denied', 'expired', 'aborted'];

interface Option {
  value: string;
  label: string;
}

interface Shared {
  filters: AuditFilters;
  onChange: (filters: AuditFilters) => void;
}

function Choice({
  field,
  options,
  filters,
  onChange,
}: Shared & { field: keyof AuditFilters; options: Option[] }) {
  const { t } = useTranslation();
  return (
    <Select
      label={t(`${K}.${field}`)}
      value={filters[field]}
      options={[{ value: '', label: t(`${K}.any.${field}`) }, ...options]}
      onChange={(event) => {
        onChange({ ...filters, [field]: event.target.value });
      }}
    />
  );
}

function Day({ field, filters, onChange }: Shared & { field: 'from' | 'to' }) {
  const { t } = useTranslation();
  return (
    <TextInput
      type="date"
      label={t(`${K}.${field}`)}
      value={filters[field]}
      onChange={(event) => {
        onChange({ ...filters, [field]: event.target.value });
      }}
    />
  );
}

interface BarProps extends Shared {
  people: Person[];
  actions: string[];
}

/** The filters: person, action type, decision, outcome and a date range. */
export function FilterBar({ filters, onChange, people, actions }: BarProps) {
  const { t } = useTranslation();
  const shared = { filters, onChange };
  const named = (values: string[]): Option[] =>
    values.map((one) => ({ value: one, label: t(`${K}.${one}`) }));
  const who = people.map((one) => ({ value: one.id, label: one.email ?? t(`${K}.chatOnly`) }));
  return (
    <form className="filters" aria-label={t(`${K}.filters`)}>
      <Choice field="person" options={who} {...shared} />
      <Choice
        field="action"

        options={actions.map((one) => ({ value: one, label: one }))}
        {...shared}
      />
      <Choice field="decision" options={named(DECISIONS)} {...shared} />
      <Choice field="outcome" options={named(OUTCOMES)} {...shared} />
      <Day field="from" {...shared} />
      <Day field="to" {...shared} />
      <Button
        variant="secondary"
        onClick={() => {
          onChange(NO_FILTERS);
        }}
      >
        {t(`${K}.clear`)}
      </Button>
    </form>
  );
}
