# The admin reads members' chats only through one audited path

Status: accepted, M2-2 (D59: the admin can read everything; members are told when they join).

## Decision

Two database functions (`admin_read_chat`, `admin_read_usage`, migration 0015) are the only way to
read another person's rows. Each writes an `admin.read` audit row (who, whose, why) before it
returns anything, in the caller's transaction. The app role may execute those two by name and
cannot execute the gate that writes the audit row. The audit row names the person set on the
transaction (`app.user_id`), never an id the caller passed, so a refused attempt is recorded under
whoever actually made it. Only `src/data/admin-read.ts` calls the functions; dependency-cruiser and a
unit test keep every other module away.

## Residual risk

The guard is the import rule, not the database. Code that can run raw SQL in a transaction can call
`admin_read_chat` as an admin, read the rows, then roll the transaction back, and the audit row
goes with it. The database cannot stop that, because an audit row written in a transaction that
rolls back is gone. This protects against mistakes and stray code paths, not against a compromised
app. Closing it fully needs the audit write outside the caller's transaction (a separate
connection or a queue), which is not planned for M2.
