import type { Migration } from 'kysely/migration';
import { up as schemaInfo } from './0001-schema-info.js';

/** Applied in key order. Add new migrations here with the next number. */
export const migrations: Record<string, Migration> = {
  '0001-schema-info': { up: schemaInfo },
};
