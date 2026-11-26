import { createHash, randomBytes } from 'node:crypto';
import { issueAdminLink, type Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';

/** How long the admin's first-password link works. */
const LINK_TTL_SECONDS = 24 * 60 * 60;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * While the admin has no password, make a one-time link and print it in the log, like the setup
 * code. The token sits after `#`, so a browser never sends it to a server or a proxy log.
 * Returns true when a link was printed.
 */
export async function announceAdminLink(
  db: Db,
  logger: Logger,
  publicUrl: string,
): Promise<boolean> {
  const token = randomBytes(32).toString('base64url');
  if (!(await issueAdminLink(db, sha256(token), LINK_TTL_SECONDS))) return false;
  logger.info(`Set your password within 24 hours: ${publicUrl}/set-password#token=${token}`);
  return true;
}
