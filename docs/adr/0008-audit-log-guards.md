# The audit log is append-only against app bugs, not against a compromised app

On 25 Nov 2026 the review of M1-5 found that the app's database role can disable the triggers that make `audit_log` append-only.

## Considered Options

- Separate database roles now: an owner role that runs migrations, and an app role that may only INSERT and SELECT on `audit_log`. Strongest, but needs a second connection string and setup steps before M1 is done.
- Triggers only, with the limit written down. Stops a bug, a wrong query or a stray migration from rewriting history.

## Decision

Triggers only for M1. The log is trustworthy against mistakes in the app, not against someone who already controls it.

## Consequences

Role separation is planned before the log is offered to other users (M2): migrations run as the owner role, the app role gets INSERT and SELECT only, and the integration test then proves an UPDATE from the app role fails on privilege, not on a trigger. Until then the README's pre-release banner stays.
