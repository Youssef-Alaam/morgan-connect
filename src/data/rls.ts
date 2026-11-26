/**
 * Install-wide tables that hold nobody's data, so they are not under row-level security: the
 * workspace list, the migration books, the one-time setup code and the access-profile presets. Every other table in `public`
 * must have RLS enabled, forced and a policy; the migration test fails on any table in neither group.
 */
export const RLS_EXEMPT_TABLES: readonly string[] = [
  'workspaces',
  'schema_info',
  'kysely_migration',
  'kysely_migration_lock',
  'setup_codes',
  'access_profiles',
];

/** Schemas outside `public` that are install-wide as a whole: the queue (pg-boss) keeps only ids. */
export const RLS_EXEMPT_SCHEMAS: readonly string[] = ['pgboss'];

/**
 * Tables the admin may read through the audited path (src/data/admin-read.ts). Each needs an
 * `expectAuditedAdminRead('<table>', ...)` call in an isolation test; the checker enforces it.
 * Memory joins this list in M4.
 */
export const ADMIN_READABLE_TABLES: readonly string[] = ['chat_messages', 'usage_ledger'];
