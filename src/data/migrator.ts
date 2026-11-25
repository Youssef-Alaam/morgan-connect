import { Migrator } from 'kysely/migration';
import type { Db } from './db.js';
import { migrations } from './migrations/index.js';

/** Run every pending migration. Returns the names applied, oldest first. */
export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error !== undefined) throw error instanceof Error ? error : new Error('Migration failed');
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
