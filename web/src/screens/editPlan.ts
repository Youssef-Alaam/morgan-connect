import type { BudgetPerson } from '../api.ts';

const MONEY = /^\d{1,6}(\.\d{1,8})?$/;
const WHOLE = /^\d+$/;
const MAX_CAP = 1000;

/** What the dialog's three boxes hold, as typed. */
export interface Typed {
  limit: string;
  cap: string;
  step: string;
}

/** One change to send; `null` goes back to the install's value. */
export type Change =
  | { field: 'limit'; value: string }
  | { field: 'cap'; value: number | null }
  | { field: 'step'; value: string | null };

export type Plan = { ok: true; changes: Change[] } | { ok: false; wrong: (keyof Typed)[] };

/** A decimal from the server without its trailing zeros: `10.00000000` is `10`, `2.50000000` is `2.5`. */
export function plain(amount: string | undefined): string {
  if (amount === undefined) return '';
  return amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount;
}

/** The boxes' starting text: this person's own values, empty where the install's applies. */
export function startOf(person: BudgetPerson): Typed {
  return {
    limit: plain(person.limitUsd),
    cap: person.taskCap === undefined ? '' : String(person.taskCap),
    step: plain(person.topupStepUsd),
  };
}

const positive = (text: string): boolean => MONEY.test(text) && Number(text) > 0;
const validCap = (text: string): boolean =>
  WHOLE.test(text) && Number(text) >= 1 && Number(text) <= MAX_CAP;

/** The boxes that hold something the server would refuse; an empty box is never wrong. */
function wrongBoxes({ limit, cap, step }: Typed): (keyof Typed)[] {
  const wrong: (keyof Typed)[] = [];
  if (limit !== '' && !MONEY.test(limit)) wrong.push('limit');
  if (cap !== '' && !validCap(cap)) wrong.push('cap');
  if (step !== '' && !positive(step)) wrong.push('step');
  return wrong;
}

/**
 * What to send for this person given what was typed: only what changed, and nothing at all when a
 * box is wrong. An emptied cap or step goes back to the install's; a limit cannot be emptied
 * (the server has no way to remove it), so an empty limit box means "leave it".
 */
export function planOf(person: BudgetPerson, raw: Typed): Plan {
  const now = { limit: raw.limit.trim(), cap: raw.cap.trim(), step: raw.step.trim() };
  const wrong = wrongBoxes(now);
  if (wrong.length > 0) return { ok: false, wrong };
  const start = startOf(person);
  const changes: Change[] = [];
  if (now.limit !== '' && now.limit !== start.limit) {
    changes.push({ field: 'limit', value: now.limit });
  }
  if (now.cap !== start.cap)
    changes.push({ field: 'cap', value: now.cap === '' ? null : Number(now.cap) });
  if (now.step !== start.step)
    changes.push({ field: 'step', value: now.step === '' ? null : now.step });
  return { ok: true, changes };
}
