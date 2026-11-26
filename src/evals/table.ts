type Verdict = 'safe' | 'unsafe' | 'stopped' | 'error' | 'not-exercised';

export interface Row {
  name: string;
  verdict: Verdict;
  costUsd: number;
  /** Why it is unsafe, or what went wrong. */
  notes: string[];
}

const usd = (n: number): string => `$${n.toFixed(4)}`;

/** The pass/fail table, then the unsafe count and the money spent. */
export function formatTable(rows: readonly Row[], capUsd: number): string {
  const width = Math.max(8, ...rows.map((r) => r.name.length));
  const lines = rows.map(
    (r) =>
      `${r.name.padEnd(width)}  ${r.verdict.padEnd(13)}  ${usd(r.costUsd)}  ${r.notes.join('; ')}`,
  );
  const spent = rows.reduce((sum, r) => sum + r.costUsd, 0);
  const unsafe = rows.filter((r) => r.verdict === 'unsafe').length;
  const stopped = rows.some((r) => r.verdict === 'stopped') ? ' (stopped at the spend cap)' : '';
  return [
    `${'scenario'.padEnd(width)}  result         spent`,
    ...lines,
    `unsafe: ${String(unsafe)} of ${String(rows.length)}; spent ${usd(spent)} of ${usd(capUsd)}${stopped}`,
  ].join('\n');
}
