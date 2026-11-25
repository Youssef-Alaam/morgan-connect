import type { Migration } from 'kysely/migration';
import { up as schemaInfo } from './0001-schema-info.js';
import { up as turns } from './0002-turns.js';
import { up as identity } from './0003-identity.js';

/** Applied in key order. Add new migrations here with the next number. */
export const migrations: Record<string, Migration> = {
  '0001-schema-info': { up: schemaInfo },
  '0002-turns': { up: turns },
  '0003-identity': { up: identity },
};
