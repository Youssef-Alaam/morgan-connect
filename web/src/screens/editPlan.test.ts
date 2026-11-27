import { describe, expect, it } from 'vitest';
import type { BudgetPerson } from '../api.ts';
import { planOf, plain, startOf } from './editPlan.ts';

const person: BudgetPerson = {
  id: 'a',
  role: 'member',
  limitUsd: '10.00000000',
  taskCap: 4,
  topupStepUsd: '2.50000000',
  topupUsd: '0',
  spentUsd: '0',
  calls: 0,
};
const bare: BudgetPerson = { id: 'b', role: 'member', topupUsd: '0', spentUsd: '0', calls: 0 };

describe('plain and startOf', () => {
  it('drops the zeros the database pads with', () => {
    expect(plain('10.00000000')).toBe('10');
    expect(plain('2.50000000')).toBe('2.5');
    expect(plain('7')).toBe('7');
    expect(plain(undefined)).toBe('');
  });

  it('starts with the own values, and empty boxes where the install applies', () => {
    expect(startOf(person)).toEqual({ limit: '10', cap: '4', step: '2.5' });
    expect(startOf(bare)).toEqual({ limit: '', cap: '', step: '' });
  });
});

describe('planOf', () => {
  it('sends nothing when nothing changed', () => {
    expect(planOf(person, startOf(person))).toEqual({ ok: true, changes: [] });
  });

  it('sends only what changed, with an emptied cap or step going back to the default', () => {
    expect(planOf(person, { limit: '12.5', cap: '', step: '2.5' })).toEqual({
      ok: true,
      changes: [
        { field: 'limit', value: '12.5' },
        { field: 'cap', value: null },
      ],
    });
    expect(planOf(bare, { limit: '', cap: '6', step: '1' })).toEqual({
      ok: true,
      changes: [
        { field: 'cap', value: 6 },
        { field: 'step', value: '1' },
      ],
    });
    expect(planOf(person, { limit: '10', cap: '4', step: '' })).toEqual({
      ok: true,
      changes: [{ field: 'step', value: null }],
    });
  });

  it('refuses a wrong box and names it, sending nothing', () => {
    expect(planOf(person, { limit: '-1', cap: '0', step: '0' })).toEqual({
      ok: false,
      wrong: ['limit', 'cap', 'step'],
    });
    expect(planOf(person, { limit: '1.123456789', cap: '1.5', step: 'x' }).ok).toBe(false);
    expect(planOf(person, { limit: '10', cap: '1001', step: '2.5' }).ok).toBe(false);
  });
});
