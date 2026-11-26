import { TextInput } from './TextInput.tsx';

const LENGTH = 6;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, LENGTH);
}

interface CodeInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}

// One input, not six boxes: phones can fill it from a text message and screen readers read one field.
export function CodeInput({ value, onChange, ...rest }: CodeInputProps) {
  return (
    <TextInput
      {...rest}
      className="code-input"
      value={value}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={LENGTH}
      onChange={(event) => {
        onChange(digitsOnly(event.target.value));
      }}
    />
  );
}
