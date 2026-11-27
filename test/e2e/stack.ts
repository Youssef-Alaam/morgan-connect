import { start } from '../../src/boot.js';
import { createDb, migrateToLatest } from '../../src/data/index.js';
import { createPasswordHasher } from '../../src/identity/password.js';
import { linkChats } from '../helpers/link-chats.js';
import { roleUrls, startPostgres } from '../helpers/postgres.js';

/** One account the browser smoke test signs in with; web/e2e-stack/smoke.spec.ts uses the same pair. */
const SMOKE_EMAIL = 'smoke@example.test';
const SMOKE_PASSWORD = 'smoke test password 1';
/** Where the backend listens; web/vite.config.ts proxies /api to the same port. */
const API_PORT = 4310;

/**
 * Playwright global setup for the real-stack smoke test: a real Postgres, the real app (no engine
 * set, so it answers with an echo: the fake engine) and one account. Returns the teardown.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const postgres = await startPostgres();
  const owner = createDb(postgres.url);
  await migrateToLatest(owner);
  const person = await linkChats(owner, []);
  const passwordHash = await createPasswordHasher().hash(SMOKE_PASSWORD);
  await owner
    .insertInto('credentials')
    .values({
      user_id: person.userId,
      workspace_id: person.workspaceId,
      email: SMOKE_EMAIL,
      password_hash: passwordHash,
    })
    .execute();
  await owner.destroy();
  const running = await start({
    ...roleUrls(postgres.url),
    PORT: String(API_PORT),
    LOG_LEVEL: 'silent',
  });
  return async () => {
    await running.stop();
    await postgres.stop();
  };
}
