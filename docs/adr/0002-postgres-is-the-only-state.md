# Postgres holds all state, including the job queue

Decided 24 Nov 2026 (grill decisions 7, 8). App servers and workers keep nothing in memory between requests. Postgres is the single source of truth for users, turns, memory, schedules and the job queue (pg-boss); files go to S3-compatible storage, which is a local folder on a single node. The system runs as one node by default and is designed so more can be added.

## Considered Options

- SQLite: lighter for one owner, but wrong for many users, a VPS and several workers, and Nod's modules are written for Postgres.
- A separate queue service (Redis): one more thing to run, back up and secure.

## Consequences

A backup is one Postgres dump plus the files folder. Workers can be scaled from 1 to many without code changes. Every table carries `user_id` and `workspace_id`, and row-level security is the second lock behind the policy function.
