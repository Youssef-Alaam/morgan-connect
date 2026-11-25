# Fork Nod vs Build Our Own: The Numbers

Measured 2026-11-24 on Nod commit 8f679e9 (local clone) and the GitHub API. Effort figures are estimates for one person working with coding agents, and are marked as such.

## What Nod is today (measured)

| Metric                     | Value                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App source (`src/`)        | 484 TS files, ~141k lines (server 51k, web UI 56k, providers 24k, shared 5k, runtime 3.7k, ports 1.9k)                                                                                                |
| Desktop shell (`desktop/`) | ~36k lines (Electron)                                                                                                                                                                                 |
| Tests / evals              | 30 test files (~122k lines incl. fixtures), 463 eval files (~75k lines)                                                                                                                               |
| Dependencies               | 47 runtime + 53 dev packages                                                                                                                                                                          |
| Database                   | 55 PostgreSQL tables                                                                                                                                                                                  |
| HTTP API                   | 102 `/api` routes                                                                                                                                                                                     |
| Multi-user readiness       | Data is already keyed by `owner_id` (1,416 references in 111 files). The one-owner limit sits in access/auth ("one assistant and one owner per server", `docs/deploy/index.md:10`), not in the schema |
| Upstream pace              | Repo created 25 Sep 2026. 888 commits in the last 30 days (~30/day), 41 contributors, 21 releases in 14 days (v0.6.0 on 9 Nov to v0.9.5 on 23 Nov)                                                    |
| Popularity                 | 3,262 stars, 523 forks, 80 open issues                                                                                                                                                                |
| Footprint (Windows)        | ~2.1 GB install, 20 GB free disk for setup, WSL 2 plus 3 containers plus Postgres, ~4-6 GB RAM when busy                                                                                              |

## Side by side

|                                                                               | Fork Nod                                                                                                                                | Build our own                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Features on day 1                                                             | All 19 areas (chat, WhatsApp/Telegram, browser, sandbox, schedules, memory, voice, trust check, cost ledger, UI, evals)                 | None. Patterns and selected files are copied in                                   |
| Multi-user (admin, roles, per-user limits)                                    | Upgrade auth/access, add roles and per-user budgets on the existing `owner_id` keys. **Estimate 3-5 weeks**                             | Design it in from the start. Part of the build                                    |
| Claude Code subscription provider                                             | New provider that works against Nod's own refusal of subscriptions. **Estimate 1-2 weeks**, plus a permanent merge conflict area        | Native: the Claude Agent SDK / CLI is the loop. **Estimate 1 week**               |
| Time to first useful version (multi-user + chat channel + router + approvals) | **~4-7 weeks**                                                                                                                          | **~4-6 weeks**                                                                    |
| Time to Nod's feature parity                                                  | Day 1, minus the time to rework or replace what breaks                                                                                  | **~3-6 months**                                                                   |
| Code you own and must understand                                              | ~180k lines app+desktop (+~200k test/eval lines)                                                                                        | Only what you write (est. 15-30k lines at parity)                                 |
| Staying current                                                               | Upstream moves ~30 commits/day. After a few weeks of divergence, merging upstream is impractical, so you effectively own the whole fork | Only your code; borrow new Nod ideas by hand when useful                          |
| Stack weight                                                                  | Electron, WSL, Docker containers, Postgres                                                                                              | Your choice: Node + SQLite (Postgres optional), no WSL needed for the core        |
| Licence duty                                                                  | Apache 2.0: keep LICENSE and NOTICE, mark changed files                                                                                 | Same duty only for files you copy (e.g. `whatsapp.ts`)                            |
| Portfolio story                                                               | "Forked and extended n8n's agent to multi-user + subscription routing": impressive but shared credit                                    | "Built a multi-user self-hosted agent from scratch, informed by Nod": fully yours |
| Main risk                                                                     | Drowning in someone else's 180k lines that keep moving                                                                                  | Long road to parity; the browser/sandbox/voice parts are the hard ones            |

## A third option: hybrid

Build our own core (loop, multi-user, router, channels, approvals) and vendor whole Nod modules where they are self-contained and good: the Baileys WhatsApp wrapper, the trust-check prompt and quote verification, the schedule engine, the untrusted-content wrapper, and possibly the `agent-browser` integration. Licence duty is only on the vendored files. The estimate to a first useful version is ~4-6 weeks, and parity drops to ~2-3 months because the hardest pieces are lifted rather than written.

## Decided so far (grill, 2026-11-24)

- Product: self-hosted open source. Each installer is the admin of their own install.
- Multi-user: the admin can add any number of senders, each with a spending limit and permissions.
- Billing: the install's admin chooses (API keys, subscriptions, or both). The product shows a clear warning when one person's subscription is used for someone else's requests.
- Subscription use is tied to the person, not to the admin role. All of one person's devices count as that person. The warning appears only when one person's subscription answers someone else's messages.
- **Base: hybrid** (owner's leaning, 2026-11-24). Build our own core and lift Nod modules into it, keeping LICENSE/NOTICE on copied files and marking changes. Review Nod's upstream once a month and port the improvements we want, rewritten to fit.
- Correction to the table above: the "15-30k lines at parity" figure was too low. A realistic estimate is **~30-60k lines** for our own codebase at Nod parity, written from scratch and not added on top of Nod's 180k. Nod is larger because of its Electron desktop app (36k), about 40 model providers and a lot of edge-case polish.
- Proposed stack (pending the owner's confirmation): TypeScript/Node, **PostgreSQL** (multi-user, VPS, and Nod's modules are Postgres-native), **Docker** for the per-user sandbox and browser (isolation), web UI first. WSL is only how Windows runs those containers during development and is not needed on a Linux VPS. **Electron is deferred** (an optional desktop installer later).
