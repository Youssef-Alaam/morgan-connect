import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmTwoFactor, startTwoFactor, twoFactorStatus, type Result } from '../api.ts';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { CodeInput } from '../components/CodeInput.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

type Step =
  | { name: 'loading' | 'unavailable' | 'failed' | 'off' | 'on' }
  | { name: 'setup'; secret: string; uri: string }
  | { name: 'codes'; codes: string[] };

const K = 'security.authenticator';

/** Ask the server what is on; a failure shows only the error: nothing is known to switch. */
function useStatus(setStep: (step: Step) => void, fail: (error: string) => void): () => void {
  return useCallback(() => {
    setStep({ name: 'loading' });
    void twoFactorStatus().then((answer) => {
      if (!answer.ok) {
        fail(answer.error);
        setStep({ name: 'failed' });
      } else if (!answer.data.available) setStep({ name: 'unavailable' });
      else setStep({ name: answer.data.enabled ? 'on' : 'off' });
    });
  }, [setStep, fail]);
}

interface CodeFormProps {
  label: string;
  hint?: string;
  submitLabel: string;
  numeric: boolean;
  onSubmit: (code: string) => Promise<Result<unknown>>;
  onDone: (answer: Result<unknown>) => void;
  onCancel: () => void;
}

// One code field: six digits when `numeric`, else an authenticator or backup code.
function CodeForm(props: CodeFormProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    props.onDone(await props.onSubmit(code));
    setBusy(false);
  };
  const field = { label: props.label, ...(props.hint === undefined ? {} : { hint: props.hint }) };
  return (
    <form className="screen-form" onSubmit={(event) => void submit(event)}>
      {props.numeric ? (
        <CodeInput {...field} value={code} onChange={setCode} />
      ) : (
        <TextInput
          {...field}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          value={code}
          onChange={typed(setCode)}
        />
      )}
      <div className="page-bar-actions">
        <Button type="submit" disabled={busy}>
          {props.submitLabel}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {t(`${K}.cancel`)}
        </Button>
      </div>
    </form>
  );
}

interface SetupProps {
  secret: string;
  uri: string;
  onConfirmed: (codes: string[]) => void;
  onFail: (error: string | undefined) => void;
  onCancel: () => void;
}

// The key to put in the app, and the first code it shows: that code switches it on.
function Setup({ secret, uri, onConfirmed, onFail, onCancel }: SetupProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t(`${K}.secretHint`)}</p>
      <p>
        {t(`${K}.secret`)}: <code dir="ltr">{secret}</code>
      </p>
      <a href={uri}>{t(`${K}.open`)}</a>
      <CodeForm
        label={t(`${K}.code`)}
        submitLabel={t(`${K}.confirm`)}
        numeric
        onSubmit={confirmTwoFactor}
        onDone={(answer) => {
          if (!answer.ok) onFail(answer.error);
          else onConfirmed((answer.data as { backupCodes: string[] }).backupCodes);
        }}
        onCancel={onCancel}
      />
    </>
  );
}

/** The state of the switch (a badge), and the button that turns it on while it is off. */
function Switch({ on, onPress }: { on: boolean; onPress?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="page-bar-actions">
      <Badge>{t(`${K}.${on ? 'on' : 'off'}`)}</Badge>
      {onPress === undefined ? null : <Button onClick={onPress}>{t(`${K}.turnOn`)}</Button>}
    </div>
  );
}

// Shown once, right after the first code: the server never gives them out again.
function BackupCodes({ codes, onSaved }: { codes: string[]; onSaved: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t(`${K}.codesHint`)}</p>
      <pre dir="ltr" aria-label={t(`${K}.codesTitle`)}>
        <code>{codes.join('\n')}</code>
      </pre>
      <Button onClick={onSaved}>{t(`${K}.saved`)}</Button>
    </>
  );
}

// The authenticator app: turn it on (key, first code, backup codes shown once) or off (needs a code).
export function Authenticator() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ name: 'loading' });
  const [error, setError] = useState<string>();
  const load = useStatus(setStep, setError);
  useEffect(load, [load]);
  const back = (name: 'off' | 'on') => () => {
    setError(undefined);
    setStep({ name });
  };
  const turnOn = () => {
    setError(undefined);
    void startTwoFactor().then((answer) => {
      if (answer.ok) setStep({ name: 'setup', ...answer.data });
      else setError(answer.error);
    });
  };
  const confirmed = (codes: string[]) => {
    setError(undefined);
    setStep({ name: 'codes', codes });
  };
  return (
    <section aria-labelledby="authenticator-title" className="screen-form">
      <h3 id="authenticator-title">{t(`${K}.title`)}</h3>
      <ErrorBanner error={error} />
      {step.name === 'loading' || step.name === 'unavailable' ? (
        <p>{t(`${K}.${step.name}`)}</p>
      ) : null}
      {step.name === 'off' ? <Switch on={false} onPress={turnOn} /> : null}
      {step.name === 'on' ? <Switch on /> : null}
      {step.name === 'setup' ? (
        <Setup {...step} onConfirmed={confirmed} onFail={setError} onCancel={back('off')} />
      ) : null}
      {step.name === 'codes' ? <BackupCodes codes={step.codes} onSaved={load} /> : null}
    </section>
  );
}
