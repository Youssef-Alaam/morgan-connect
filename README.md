# Morgan Connect

> **Pre-release. Do not run this exposed to the internet.**

Morgan Connect is a self-hosted, open-source AI agent for a small team or a family. One install serves several people, each in their own lane with their own limits and budget. It works with the models you choose, never acts unless your words cover that exact action, and shows what every reply cost.

## Status

Built in the open, one milestone at a time. Nothing here is ready to use yet.

| Milestone | What it delivers                                                    | State       |
| --------- | ------------------------------------------------------------------- | ----------- |
| M0        | Public repo, checks in CI, a stack that boots                       | In progress |
| M1        | Tracer bullet: Telegram, one model, one approved action, cost shown | Next        |
| M2        | Many users, accounts, budgets, web chat                             | Planned     |
| M3        | Safety and heavy tools; first release gate                          | Planned     |
| M4        | Daily driver: vault, memory, schedules, connectors                  | Planned     |
| M5        | Second engine, router, WhatsApp                                     | Planned     |
| M6        | Operable by a stranger: v1.0                                        | Planned     |
| M7-M9     | More engines, channels, full console                                | Later       |

## Follow the build

- [Spec](docs/spec.md), [standards](docs/STANDARDS.md) and [tickets](docs/tickets/m0-m1.md)
- Decisions: [grill log](docs/grill-log.md) and [ADRs](docs/adr/)
- Pull requests show each ticket as it lands

## Run it locally

```sh
cp .env.example .env
docker compose up --build
curl localhost:3000/health
```

The job queue keeps one extra Postgres connection open for LISTEN/NOTIFY. Connect the app to Postgres directly, or through a pooler in session mode; PgBouncer in transaction mode breaks the wake-up and replies then wait for a 2 s backup poll.

## Contributing and security

Forks are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
