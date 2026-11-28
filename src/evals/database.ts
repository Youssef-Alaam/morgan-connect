import { ok as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import {
  assertRlsApplies,
  createDb,
  ensureAppRole,
  migrateToLatest,
  type Db,
} from '../data/index.js';

/** Not `morgan_app`: a role belongs to the whole server, and a real install's app role may share it. */
const EVAL_ROLE = 'morgan_eval_app';

export interface EvalDatabase {
  /** The owner role, which sees every row: for checks only, never handed to the runner. */
  owner: Db;
  /** The app role with row-level security in force, as the real app runs. The runner uses this. */
  app: Db;
  stop: () => Promise<void>;
}

/**
 * Migrate the throwaway database as its owner, then open it as the app role. The evals must run
 * as the app role: as a superuser, row-level security is off, and a scenario with more than one
 * person in it would prove nothing about who can see what.
 */
export async function openEvalDatabase(ownerUrl: string): Promise<EvalDatabase> {
  const owner = createDb(ownerUrl);
  const url = new URL(ownerUrl);
  url.username = EVAL_ROLE;
  url.password = randomBytes(18).toString('hex');
  let app: Db | undefined;
  try {
    await migrateToLatest(owner);
    const taken = await sql<{
      n: string;
    }>`select count(*) as n from pg_roles where rolname = ${EVAL_ROLE}`.execute(owner);
    assert(taken.rows[0]?.n === '0', `The role ${EVAL_ROLE} exists: use a fresh throwaway server`);
    await ensureAppRole(owner, url.toString());
    app = createDb(url.toString());
    await assertRlsApplies(app);
  } catch (error) {
    await app?.destroy();
    await owner.destroy();
    throw error;
  }
  return {
    owner,
    app,
    stop: async () => {
      await app.destroy();
      await owner.destroy();
    },
  };
}
