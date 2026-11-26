import { useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { Button } from './Button.tsx';

// Enter sends; Shift+Enter is a new line; Enter that confirms an input-method choice is not a send.
export function shouldSend(key: string, shift: boolean, composing: boolean): boolean {
  return key === 'Enter' && !shift && !composing;
}

interface ComposerProps {
  label: string;
  sendLabel: string;
  onSend: (text: string) => void;
}

export function Composer({ label, sendLabel, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const send = () => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    onSend(trimmed);
    setText('');
  };
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSend(event.key, event.shiftKey, event.nativeEvent.isComposing)) return;
    event.preventDefault();
    send();
  };
  return (
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        className="input composer-text"
        aria-label={label}
        rows={2}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <Button type="submit">{sendLabel}</Button>
    </form>
  );
}
