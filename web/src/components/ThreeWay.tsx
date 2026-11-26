import { useId } from 'react';
import type { KeyboardEvent } from 'react';

type Mode = 'off' | 'ask' | 'auto';
const MODES: Mode[] = ['off', 'ask', 'auto'];

// The mode an arrow or Home/End key moves to, or undefined for any other key. Left and right
// swap in right-to-left pages so the arrow points the way the options are laid out.
export function nextMode(from: Mode, key: string, dir: 'ltr' | 'rtl'): Mode | undefined {
  const horizontal = dir === 'rtl' ? -1 : 1;
  const steps: Record<string, number> = {
    ArrowRight: horizontal,
    ArrowLeft: -horizontal,
    ArrowDown: 1,
    ArrowUp: -1,
  };
  if (key === 'Home') return 'off';
  if (key === 'End') return 'auto';
  const step = steps[key];
  if (step === undefined) return undefined;
  const index = MODES.indexOf(from) + step;
  return MODES[Math.min(Math.max(index, 0), MODES.length - 1)];
}

interface ThreeWayProps {
  label: string;
  value: Mode;
  labels: Record<Mode, string>;
  onChange: (mode: Mode) => void;
  // Text about what the chosen mode risks; the caller decides when to show it.
  risk?: string;
}

export function ThreeWay({ label, value, labels, onChange, risk }: ThreeWayProps) {
  const riskId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const dir = getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr';
    const next = nextMode(value, event.key, dir);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  };
  return (
    <div className="field">
      <div
        role="radiogroup"
        aria-label={label}
        aria-describedby={risk === undefined ? undefined : riskId}
        className="three-way"
        onKeyDown={onKeyDown}
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            data-mode={mode}
            aria-checked={mode === value}
            tabIndex={mode === value ? 0 : -1}
            className="three-way-option"
            onClick={() => {
              onChange(mode);
            }}
          >
            {labels[mode]}
          </button>
        ))}
      </div>
      {risk === undefined ? null : (
        <p id={riskId} className="risk">
          {risk}
        </p>
      )}
    </div>
  );
}
