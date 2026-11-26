/** Import order from STANDARDS section 7: a layer may import only layers below it. */
const RANKS = [
  ['channels', 'cadence', 'http'],
  ['core'],
  ['policy', 'safety'],
  ['providers', 'tools'],
  ['identity', 'data', 'ops'],
];
const folder = (name) => `^src/${name}/`;
const group = (names) => `^src/(${names.join('|')})/`;

const rankRules = RANKS.flatMap((names, rank) => {
  const higher = RANKS.slice(0, rank).flat();
  const rules = [];
  if (higher.length > 0) {
    rules.push({
      name: `no-upward-import-from-rank-${rank + 1}`,
      severity: 'error',
      comment: `Rank ${rank + 1} folders (${names.join(', ')}) must not import higher layers.`,
      from: { path: group(names) },
      to: { path: group(higher) },
    });
  }
  if (rank < 4) {
    for (const name of names) {
      const siblings = names.filter((n) => n !== name && !(name === 'policy' && n === 'safety'));
      if (siblings.length > 0) {
        rules.push({
          name: `no-sibling-import-from-${name}`,
          severity: 'error',
          from: { path: folder(name) },
          to: { path: group(siblings) },
        });
      }
    }
  }
  return rules;
});

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    ...rankRules,
    {
      name: 'providers-and-tools-only-via-policy',
      severity: 'error',
      comment: 'Only src/policy may reach providers and tools.',
      from: { path: '^src/', pathNot: '^src/(policy|providers|tools)/' },
      to: { path: '^src/(providers|tools)/' },
    },
    {
      name: 'tools-only-from-policy',
      severity: 'error',
      comment:
        'Only src/policy (the gate and its profile) may import tools, so no tool runs outside the gate.',
      from: { path: '^src/', pathNot: '^src/(tools|policy)/' },
      to: { path: '^src/tools/' },
    },
    {
      name: 'evals-never-imported-by-the-app',
      severity: 'error',
      comment:
        'The eval harness is dev tooling: no app code may import it, so it stays out of the build.',
      from: { path: '^src/', pathNot: '^src/evals/' },
      to: { path: '^src/evals/' },
    },
    {
      name: 'web-and-backend-never-import-each-other',
      severity: 'error',
      from: { path: '^web/' },
      to: { path: '^src/' },
    },
    {
      name: 'backend-never-imports-web',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^web/' },
    },
    {
      name: 'tests-never-import-real-providers',
      severity: 'error',
      from: { path: '^test/' },
      to: { path: '^src/providers/' },
    },
    {
      name: 'no-pg-mem',
      severity: 'error',
      from: {},
      to: { path: 'node_modules/pg-mem/' },
    },
    {
      name: 'pg-only-in-data',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/data/' },
      to: { path: '^node_modules/pg/' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
  },
};
