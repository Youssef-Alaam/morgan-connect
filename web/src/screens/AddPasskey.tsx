import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addPasskey, passkeyOptions } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { createPasskey, passkeysSupported } from '../passkey.ts';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

const K = 'security.passkeys';

interface AddPasskeyProps {
  onAdded: () => void;
  /** The install has no passkey settings (the server answered 501). */
  onUnavailable: () => void;
}

// The code a person with an authenticator gives before a passkey can be added.
function StepUpCode({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <TextInput
      label={t('security.authenticator.disableCode')}
      hint={t('security.authenticator.disableHint')}
      autoComplete="off"
      spellCheck={false}
      maxLength={32}
      value={code}
      onChange={typed(onChange)}
    />
  );
}

/**
 * Add a passkey: ask the server for options, let the browser make it, send it back. A person with
 * an authenticator is asked for a current code first (the server says so with a 401).
 */
export function AddPasskey({ onAdded, onUnavailable }: AddPasskeyProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(t(`${K}.defaultName`));
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const options = await passkeyOptions(code);
    if (!options.ok) {
      if (options.status === 501) onUnavailable();
      else if (options.error === 'invalid_code' && code === undefined) setCode('');
      else setError(options.error);
      return;
    }
    const made = await createPasskey(options.data);
    const saved =
      made === undefined
        ? undefined
        : await addPasskey(made, name.trim() === '' ? t(`${K}.defaultName`) : name.trim());
    // The code was spent on the options call, however this ends: the next try asks for a new one.
    setCode(undefined);
    if (saved?.ok === true) onAdded();
    else setError(saved === undefined ? 'passkey_cancelled' : saved.error);
  };
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    await run();
    setBusy(false);
  };
  if (!passkeysSupported()) return <p>{t(`${K}.unsupported`)}</p>;
  return (
    <form className="screen-form" onSubmit={(event) => void submit(event)}>
      <ErrorBanner error={error} />
      <TextInput label={t(`${K}.newName`)} maxLength={60} value={name} onChange={typed(setName)} />
      {code === undefined ? null : <StepUpCode code={code} onChange={setCode} />}
      <Button type="submit" disabled={busy}>
        {t(`${K}.add`)}
      </Button>
    </form>
  );
}
