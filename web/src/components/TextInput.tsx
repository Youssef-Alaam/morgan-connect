import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextInput({ label, hint, error, className, ...rest }: TextInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint === undefined ? '' : hintId, error === undefined ? '' : errorId]
    .filter((part) => part !== '')
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...rest}
        id={id}
        className={['input', className].filter((c) => c !== undefined).join(' ')}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={described === '' ? undefined : described}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface PasswordInputProps extends Omit<TextInputProps, 'type'> {
  showLabel: string;
  hideLabel: string;
}

export function PasswordInput({ showLabel, hideLabel, ...rest }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password">
      <TextInput {...rest} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="btn btn-secondary password-toggle"
        aria-pressed={shown}
        onClick={() => {
          setShown(!shown);
        }}
      >
        {shown ? hideLabel : showLabel}
      </button>
    </div>
  );
}
