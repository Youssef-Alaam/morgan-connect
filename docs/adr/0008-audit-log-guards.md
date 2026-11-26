# The audit log is append-only against app bugs, not against a compromised app

On 25 Nov 2026 the review of M1-5 found that the app's database role can disable the triggers that make `audit_log` append-only.

Status: done on 26 Nov 2026 (ticket A2). Role separation shipped; the sections below are the original decision record.

## Considered Options

- Separate database roles now: an owner role that runs migrations, and an app role that may only INSERT and SELECT on `audit_log`. Strongest, but needs a second connection string and setup steps before M1 is done.
- Triggers only, with the limit written down. Stops a bug, a wrong query or a stray migration from rewriting history.

## Decision

Triggers only for M1. The log is trustworthy against mistakes in the app, not against someone who already controls it.

## Consequences

Role separation is planned before the log is offered to other users (M2): migrations run as the owner role, the app role gets INSERT and SELECT only, and the integration test then proves an UPDATE from the app role fails on privilege, not on a trigger. Until then the README's pre-release banner stays.

## Outcome (26 Nov 2026)

Set `MIGRATION_DATABASE_URL` (the owner role) next to `DATABASE_URL` (the app role). At boot the owner role migrates, then creates or refreshes the app role from the name and password in `DATABASE_URL` and grants it normal reads and writes everywhere except `audit_log`, where it gets INSERT and SELECT only. The app role is not a superuser and owns nothing, so it cannot disable the triggers either. The integration test connects as the app role and shows UPDATE, DELETE and TRUNCATE fail with a privilege error (42501). With `MIGRATION_DATABASE_URL` unset one role does both and the app logs a warning; that setup is for development only. The app role also gets CREATE on the database so the queue can keep its own `pgboss` schema. The README pre-release banner stays until the release gate passes.
