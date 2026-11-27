import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { setBudget, setTaskCap, setTopupStep, type BudgetPerson } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { planOf, startOf, type Change, type Typed } from './editPlan.ts';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

const K = 'budgets.edit';

const send = (id: string, change: Change) => {
  if (change.field === 'limit') return setBudget(id, change.value);
  return change.field === 'cap' ? setTaskCap(id, change.value) : setTopupStep(id, change.value);
};

interface FieldsProps {
  fields: Typed;
  wrong: string[];
  onChange: (key: keyof Typed, value: string) => void;
}

function Fields({ fields, wrong, onChange }: FieldsProps) {
  const { t } = useTranslation();
  const box = (key: keyof Typed, mode: 'decimal' | 'numeric') => (
    <TextInput
      label={t(`${K}.${key}`)}
      hint={t(`${K}.${key}Hint`)}
      inputMode={mode}
      value={fields[key]}
      onChange={typed((value) => {
        onChange(key, value);
      })}
      {...(wrong.includes(key) ? { error: t(`${K}.${key}Invalid`) } : {})}
    />
  );
  return (
    <>
      {box('limit', 'decimal')}
      {box('cap', 'numeric')}
      {box('step', 'decimal')}
    </>
  );
}

interface EditProps {
  person: BudgetPerson;
  name: string;
  onSaved: () => void;
  onClose: () => void;
}

/** One person's limit, task cap and top-up step in one dialog. Only what changed is sent, in order, stopping at the first refusal. */
export function EditLimits({ person, name, onSaved, onClose }: EditProps) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Typed>(startOf(person));
  const [wrong, setWrong] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const save = async (event: SyntheticEvent) => {
    event.preventDefault();
    setError(undefined);
    const plan = planOf(person, fields);
    setWrong(plan.ok ? [] : plan.wrong);
    if (!plan.ok) return;
    for (const change of plan.changes) {
      const answer = await send(person.id, change);
      if (!answer.ok) {
        // What was saved before the refusal is real: show it, and keep the dialog open for the rest.
        setError(answer.error);
        onSaved();
        return;
      }
    }
    onSaved();
    onClose();
  };
  return (
    <Dialog
      open
      title={t(`${K}.title`, { person: name })}
      closeLabel={t('users.cancel')}
      onClose={onClose}
    >
      <ErrorBanner error={error} />
      <form className="screen-form" onSubmit={(event) => void save(event)}>
        <Fields
          fields={fields}
          wrong={wrong}
          onChange={(key, value) => {
            setFields((now) => ({ ...now, [key]: value }));
          }}
        />
        <Button type="submit">{t(`${K}.save`)}</Button>
      </form>
    </Dialog>
  );
}
