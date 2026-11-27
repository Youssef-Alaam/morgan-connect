import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import { TextInput } from '../components/TextInput.tsx';

interface CopyableProps {
  label: string;
  hint: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
}

// A value shown once (a link, a temporary password) in a read-only field with a Copy button.
export function Copyable({ label, hint, value, copyLabel, copiedLabel }: CopyableProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  };
  return (
    <div className="screen-form">
      <TextInput label={label} hint={hint} readOnly value={value} />
      <Button variant="secondary" onClick={copy}>
        {copyLabel}
      </Button>
      <p role="status">{copied ? copiedLabel : ''}</p>
    </div>
  );
}
