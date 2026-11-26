import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

export function Button({ variant = 'primary', type = 'button', className, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, className].filter((c) => c !== undefined);
  // `type` has a safe default so a button inside a form never submits by accident.
  return <button {...rest} type={type} className={classes.join(' ')} />;
}
