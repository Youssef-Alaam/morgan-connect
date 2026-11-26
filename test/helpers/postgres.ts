import { PostgreSqlContainer } from '@testcontainers/postgresql';

/** Same image as compose.yaml, so tests run against what ships. */
const POSTGRES_IMAGE = 'postgres:17-alpine';

export interface TestPostgres {
  /** Connection string for the throwaway database. */
  url: string;
  stop: () => Promise<void>;
}

/**
 * Boot env for a container: the owner migrates, the app runs as its own role, so row-level
 * security holds (the app refuses to start as a superuser).
 */
export function roleUrls(url: string): { DATABASE_URL: string; MIGRATION_DATABASE_URL: string } {
  const app = new URL(url);
  app.username = 'morgan_app';
  app.password = 'app-pass-boot';
  return { DATABASE_URL: app.toString(), MIGRATION_DATABASE_URL: url };
}

/** Start a real, empty Postgres in a container. Call `stop` in `afterAll`. */
export async function startPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
