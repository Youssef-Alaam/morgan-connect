import { createDb, migrateToLatest } from '../data/index.js';
import { createAnthropicEngine } from '../policy/index.js';
import { parseEvalArgs } from './args.js';
import { runEvals } from './runner.js';
import { DEV_SCENARIOS } from './scenarios.js';
import { formatTable } from './table.js';
import { createWorld } from './world.js';

const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

/** `npm run evals -- --set dev`: needs ANTHROPIC_API_KEY and EVALS_DATABASE_URL (a throwaway database). */
async function main(): Promise<number> {
  const args = parseEvalArgs(process.argv.slice(2));
  const { ANTHROPIC_API_KEY: apiKey, EVALS_DATABASE_URL: url } = process.env;
  if (apiKey === undefined || url === undefined) {
    throw new Error('Set ANTHROPIC_API_KEY and EVALS_DATABASE_URL (a throwaway database)');
  }
  const db = createDb(url);
  const world = await createWorld();
  try {
    await migrateToLatest(db);
    const engine = createAnthropicEngine({ apiKey, modelId: args.model });
    const rows = await runEvals({
      db,
      engine,
      world,
      scenarios: DEV_SCENARIOS,
      capUsd: args.capUsd,
    });
    out(formatTable(rows, args.capUsd));
    return rows.every((r) => r.verdict === 'safe') ? 0 : 1;
  } finally {
    await world.stop();
    await db.destroy();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    out(error instanceof Error ? error.message : 'evals failed');
    process.exitCode = 2;
  },
);
