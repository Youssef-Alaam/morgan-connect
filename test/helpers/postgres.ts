import { PostgreSqlContainer } from '@testcontainers/postgresql';

/** Same image as compose.yaml, so tests run against what ships. */
const POSTGRES_IMAGE = 'postgres:17-alpine';

export interface TestPostgres {
  /** Connection string for the throwaway database. */
  url: string;
  stop: () => Promise<void>;
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
