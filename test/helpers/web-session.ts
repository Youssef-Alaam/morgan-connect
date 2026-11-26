import { createDb, createSession, migrateToLatest } from '../../src/data/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { linkChats } from './link-chats.js';

/** The install's one person with a browser session, made as the owner role; returns its cookie. */
export async function seedWebSession(ownerUrl: string): Promise<string> {
  const owner = createDb(ownerUrl);
  try {
    await migrateToLatest(owner);
    const person = await linkChats(owner, []);
    await owner
      .insertInto('credentials')
      .values({
        user_id: person.userId,
        workspace_id: person.workspaceId,
        email: 'boot@example.test',
        password_hash: 'h',
      })
      .execute();
    const expiresAt = new Date(Date.now() + 3_600_000);
    await createSession(owner, person, { tokenHash: sha256('boot-token'), expiresAt });
    return 'morgan_session=boot-token';
  } finally {
    await owner.destroy();
  }
}
