import type { InputHTMLAttributes } from 'react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export function Checkbox({ label, ...rest }: CheckboxProps) {
  return (
    <label className="choice">
      <input {...rest} type="checkbox" className="choice-box" />
      {label}
    </label>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <label className="choice">
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        onClick={() => {
          onChange(!checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}
