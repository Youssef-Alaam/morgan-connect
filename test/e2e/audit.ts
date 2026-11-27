import { createDb } from '../../src/data/index.js';

/** The audit rows the console actions write, oldest first, read as the owner role. */
export async function consoleAudit(): Promise<{ tool: string; outcome: string }[]> {
  const db = createDb(process.env['STACK_DATABASE_URL'] ?? '');
  try {
    return await db
      .selectFrom('audit_log')
      .select(['tool', 'outcome'])
      .where('tool', 'in', [
        'admin.account.create',
        'admin.invite.create',
        'admin.invite.revoke',
        'device.unlink',
      ])
      .orderBy('id')
      .execute();
  } finally {
    await db.destroy();
  }
}
