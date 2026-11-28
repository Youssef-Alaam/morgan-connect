import { randomBytes } from 'node:crypto';
import {
  assertRlsApplies,
  createDb,
  ensureAppRole,
  migrateToLatest,
  type Db,
} from '../data/index.js';

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
  url.username = 'morgan_app';
  url.password = randomBytes(18).toString('hex');
  try {
    await migrateToLatest(owner);
    await ensureAppRole(owner, url.toString());
  } catch (error) {
    await owner.destroy();
    throw error;
  }
  const app = createDb(url.toString());
  try {
    await assertRlsApplies(app);
  } catch (error) {
    await app.destroy();
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
