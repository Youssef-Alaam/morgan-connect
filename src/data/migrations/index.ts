import type { Migration } from 'kysely/migration';
import { up as schemaInfo } from './0001-schema-info.js';
import { up as turns } from './0002-turns.js';
import { up as identity } from './0003-identity.js';
import { up as chatMessages } from './0004-chat-messages.js';
import { up as auditLog } from './0006-audit-log.js';
import { up as usageLedger } from './0007-usage-ledger.js';
import { up as chatMessageToolData } from './0008-chat-message-tool-data.js';
import { up as chatConversations } from './0009-chat-conversations.js';
import { up as tenancy } from './0010-tenancy.js';
import { up as approvals } from './0011-approvals.js';
import { up as systemPaths } from './0012-system-paths.js';
import { up as rowLevelSecurity } from './0013-row-level-security.js';
import { up as chatMessageSummaries } from './0014-chat-message-summaries.js';
import { up as adminRead } from './0015-admin-read.js';
import { up as webAccounts } from './0016-web-accounts.js';
import { up as invites } from './0017-invites.js';
import { up as webEvents } from './0018-web-events.js';
import { up as linkCodes } from './0019-link-codes.js';
import { up as unlinkDevice } from './0020-unlink-device.js';
import { up as secondFactor } from './0021-second-factor.js';
import { up as passkeys } from './0022-passkeys.js';
import { up as accessProfiles } from './0023-access-profiles.js';

/** Applied in key order. Add new migrations here with the next number. */
export const migrations: Record<string, Migration> = {
  '0001-schema-info': { up: schemaInfo },
  '0002-turns': { up: turns },
  '0003-identity': { up: identity },
  '0004-chat-messages': { up: chatMessages },
  '0006-audit-log': { up: auditLog },
  '0007-usage-ledger': { up: usageLedger },
  '0008-chat-message-tool-data': { up: chatMessageToolData },
  '0009-chat-conversations': { up: chatConversations },
  '0010-tenancy': { up: tenancy },
  '0011-approvals': { up: approvals },
  '0012-system-paths': { up: systemPaths },
  '0013-row-level-security': { up: rowLevelSecurity },
  '0014-chat-message-summaries': { up: chatMessageSummaries },
  '0015-admin-read': { up: adminRead },
  '0016-web-accounts': { up: webAccounts },
  '0017-invites': { up: invites },
  '0018-web-events': { up: webEvents },
  '0019-link-codes': { up: linkCodes },
  '0020-unlink-device': { up: unlinkDevice },
  '0021-second-factor': { up: secondFactor },
  '0022-passkeys': { up: passkeys },
  '0023-access-profiles': { up: accessProfiles },
};
