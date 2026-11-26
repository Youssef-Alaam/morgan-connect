/**
 * Install-wide tables that hold nobody's data, so they are not under row-level security: the
 * workspace list, the migration books and the one-time setup code. Every other table in `public`
 * must have RLS enabled, forced and a policy; the migration test fails on any table in neither group.
 */
export const RLS_EXEMPT_TABLES: readonly string[] = [
  'workspaces',
  'schema_info',
  'kysely_migration',
  'kysely_migration_lock',
  'setup_codes',
];

/** Schemas outside `public` that are install-wide as a whole: the queue (pg-boss) keeps only ids. */
export const RLS_EXEMPT_SCHEMAS: readonly string[] = ['pgboss'];
