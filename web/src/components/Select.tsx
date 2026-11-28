import { useId } from 'react';
import type { SelectHTMLAttributes } from 'react';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: { value: string; label: string }[];
  /** The label stays for screen readers but is not shown (a table column already names it). */
  hideLabel?: boolean;
}

export function Select({ label, options, className, hideLabel, ...rest }: SelectProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel === true ? 'visually-hidden' : undefined}>
        {label}
      </label>
      <select
        {...rest}
        id={id}
        className={['input', className].filter((c) => c !== undefined).join(' ')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
