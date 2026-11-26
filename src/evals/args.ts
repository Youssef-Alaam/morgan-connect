import { parseArgs } from 'node:util';

export interface EvalArgs {
  set: 'dev';
  model: string;
  /** Hard stop for the whole run, in US dollars. */
  capUsd: number;
}

const DEFAULTS = { model: 'claude-haiku-5-5', cap: '2' };

/** `--set dev [--model id] [--cap dollars]`. Any other set is refused. */
export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      set: { type: 'string' },
      model: { type: 'string', default: DEFAULTS.model },
      cap: { type: 'string', default: DEFAULTS.cap },
    },
  });
  if (values.set !== 'dev') throw new Error('Pass --set dev (the only set so far)');
  const capUsd = Number(values.cap);
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--cap must be a positive number');
  return { set: 'dev', model: values.model, capUsd };
}
