# Morgan Connect: Spec

Status: **draft 2, 2026-11-24**, awaiting the owner's read. Editable until it is code, then closed (Matt Pocock's rule).
Sources: `grill-log.md` (decisions 1-61, cited as **D12**), `review-2026-11-24.md` (cited as **C3**, **G4**, **R2**), `architecture/`, `research/`.
Next step after approval: tickets (a later session). Words in _italics_ are in `GLOSSARY.md`.

## 1. Problem

People want an assistant they can text from the apps they already use and that does real work: mail, calendar, research, files, a computer, a browser. Today they choose between:

- **Hosted assistants**, where their data and logins live on someone else's servers and one vendor's model is the only choice.
- **Self-hosted agents such as Nod** (n8n Labs, Apache 2.0), which are built for exactly one owner. Nod has no accounts, no roles and no per-person limits ("one assistant and one owner per server"), runs bash without its own safety check, and its safety check proves the user's words exist but not that they cover the action.

Nobody offers a self-hosted agent that a family or a small team can share safely: each person with their own identity, apps, memory, budget and limits, set by an admin, on models each person is actually allowed to use under the providers' terms.

For the owner there are two more problems. He wants a WhatsApp/Telegram-driven Morgan that knows his Obsidian vault, and he wants a serious public project that shows what he can build.

## 2. Solution

**Morgan Connect**: a self-hosted, open-source (Apache 2.0) personal AI agent for many users per install (D1, D2, D43).

- Whoever installs it is the **admin**. The admin invites people, and sets what each person and each of their _devices_ may do through _access profiles_ (D27).
- People text one bot per install on Telegram, WhatsApp, Discord, Slack, or use the web app, which installs on a phone (D22, D23, D34).
- Morgan works through a sandbox computer, a browser, connected apps, files, schedules and memory. Every action passes one safety layer: access profile, then _trust check_, then approval where the profile says "ask" (D19, D27, D30).
- AI models are reached only through routes each provider allows: every provider's own SDK behind one _engine port_, with API keys where no subscription route is legal (D9, D15, D16).
- It runs with Docker Compose on a Linux VPS, a Windows laptop or a Mac, on Postgres, designed so more servers can be added later (D6, D7, D29, D51).
- It is **built in public from the first commit**: the repo is public, anyone may fork, and only the owner merges to `main` (D57).

Built hybrid: our own TypeScript core, with self-contained Nod modules lifted in under Apache 2.0 (D4, D5).

## 3. Users and user stories

**Admin** (installs and runs it)

1. As an admin, I claim a fresh install with a one-time setup code from the server log, so a stranger cannot claim it first.
2. As an admin, I invite a person with a one-time link that carries their role and limits, or create their account with a temporary password (D11).
3. As an admin, I give each person and each of their devices an access profile where every action type is off, ask, or auto, and I see a risk warning on every grant (D27).
4. As an admin, I set a monthly spending limit per person on my API keys, and approve or refuse a top-up when someone hits it (D2, D20, D46).
5. As an admin, I decide who gets the sandbox and the browser, and how many tasks a person may run at once (D24, D25).
6. As an admin, I can require my approval for chosen people or chosen actions (D19).
7. As an admin, I see what every member did, what it cost and what was approved, and I can read their chats and memories; members are told this when they join, and each time I open a member's chat it is written to the audit log (D59).
8. As an admin, I create workspaces (Family, Work team) with their own data, apps and budgets (D21).
9. As an admin, I turn on backups during setup and can restore with one command (D33).
10. As an admin, I am told when an update exists and apply it with one command that backs up first (D47).
11. As an admin, I see every provider route with its terms source and the date it was last checked, and can switch a route off (D15).
12. As an admin, I switch WhatsApp on only after reading and accepting a plain risk notice (D55).

**Member** 13. As a member, I link my Telegram or WhatsApp to my account with a one-time code, and messages from unlinked senders are ignored. 14. As a member, I sign in to the web app with a password and an authenticator app, or a passkey, and I keep backup codes for a lost phone (D12, D14, D61). 15. As a member, I text a request and get an answer about as fast as the model itself produces it (D50). 16. As a member, I am asked before a risky action with the exact content shown, and my yes covers that exact action once (D19). 17. As a member, I connect my own apps, choosing between Composio (easiest, my data passes through Composio) and the install's own sign-in (private), with neither pre-selected (D45, D58). 18. As a member, I add my own provider key or sign in with my own subscription where the provider allows it, and nobody else can use it (D15, D46). 19. As a member, I say "remember this" and it is saved. When Morgan notices something that looks worth keeping, it asks "want me to remember this for later chats?" and saves it only on my yes. It asks at most once per conversation, at the end of a reply, never in the middle of a task. Before an old part of a long chat is dropped from its working context, it offers to keep anything important from that part. I see all my notes on a "notes about me" page and with `/notes`, and can edit and delete them (D37, D62). 20. As a member, I set schedules and quiet hours in my time zone; results wait until morning unless urgent (D38). 21. As a member, I send a voice note and get a text reply (D41). 22. As a member, I type `/team` for a big job, or Morgan escalates by itself and tells me it will take longer (D36). 23. As a member, I tap "ask for more" when my limit is reached (D20). 24. As a member, I export all my data as a zip and delete my account myself (D48). 25. As a member in two workspaces, I switch with `/workspace` and each chat remembers its default.

**Restricted device** (a younger family member's chat, D27, D31) 26. As an admin, I link a younger family member's own number with the Restricted profile, so from that chat Morgan can chat and read but cannot send, share, publish, push, delete or spend. 27. As the person on a restricted device, I get a clear "this is switched off for this chat" when I ask for a blocked action, never a silent failure.

**The owner as user #1** (D28, D42) 28. As the owner, I text Morgan on Telegram from day one and on WhatsApp once the adapter is on, and it answers from my vault by following the vault's own pointer chain. 29. As the owner, I say "capture this" and a new note lands in the vault's `_inbox/` as one clean commit, and no existing note is ever edited. 30. As the owner, I run Claude on my own Anthropic API key, or any self-hosted model through the HTTP engine (`ENGINE=http`), and see what each day cost. 31. As the owner, I connect my Google account through the private path, so my mail does not pass through a third party (C3). 32. As the owner, I get a morning brief on a schedule, held back during quiet hours.

**Contributor** (D57) 33. As a visitor to the repo, I can read the spec, the decisions and the roadmap, fork it, and open a pull request; only the owner merges to `main`. 34. As a visitor, I see plainly whether the current build is safe to run and how to report a security problem.

## 4. Decisions

Full text is in `grill-log.md`. Hard-to-reverse ones also have an ADR in `docs/adr/`.

| Area             | Decision                                                                                                                                                                                                                                      | Refs                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Product          | Self-hosted, open source, Apache 2.0; the installer is the admin; any number of users; several workspaces                                                                                                                                     | D1, D2, D21, D43                  |
| Build            | Hybrid: own TypeScript core plus lifted Nod modules (LICENSE/NOTICE kept, changes marked); monthly upstream review                                                                                                                            | D4, D5; ADR-0001                  |
| Open development | Public repo from the first commit; forks welcome; the owner alone merges to `main`                                                                                                                                                            | D57; ADR-0007                     |
| Stack            | Postgres for data and the job queue; Docker for sandbox and browser; web UI first; Electron deferred                                                                                                                                          | D7, D8; ADR-0002                  |
| Targets          | Linux VPS, Windows (Docker Desktop), Mac, all on one Docker Compose path; Kubernetes plan written before v1.0, Helm chart later                                                                                                               | D6, D29, D51                      |
| Terms rule       | No known breach of any provider's terms. Grey routes are off by default, labelled, and need the admin's opt-in. Where no legal route exists the product says so. A policy file records each route's source and date and can switch it off     | D9, D15, D55; ADR-0004            |
| Engines          | Each provider's own SDK behind one engine port: Pi (generic API keys, official ChatGPT sign-in), Claude Agent SDK on an API key, Google's SDK on a Gemini key, Copilot SDK, Cursor SDK. All five are built; Pi with an Anthropic key is first | D16, D56; ADR-0003                |
| Credentials      | Every credential belongs to one person and is never shared. Spending limits apply to the admin's API keys only                                                                                                                                | D15, D18, D46                     |
| Router           | Fast / strong / boss tiers per provider profile; one agent first, escalating to team mode for big jobs or `/team`; no separate classifier                                                                                                     | D36                               |
| Safety           | Admin-set access profiles per user and per device, every action type off / ask / auto; members approve their own actions unless the admin takes that over; shell gate per profile, default risky-only plus a network allowlist                | D19, D27, D30, D31, D61; ADR-0005 |
| Channels         | One bot per install. Web chat, Telegram, WhatsApp, Discord, Slack. WhatsApp is the official Cloud API on a dedicated number, as an opt-in adapter; Baileys is not shipped                                                                     | D22, D23, D40, D55; ADR-0006      |
| Login            | Password + authenticator (TOTP) + backup codes, passkeys, magic link, Google/GitHub, chat code, QR. The chat can never be both factors                                                                                                        | D11-D14, D61                      |
| Tools            | Sandbox and browser per granted user, own container, started on demand, paused when idle; parallel tasks capped per user, default 2                                                                                                           | D24, D25                          |
| Connected apps   | Per user. Setup shows a choice screen, Composio first ("easiest, data passes through Composio"), own OAuth second ("private"), nothing pre-selected. Every connector action passes the safety layer. MCP servers supported                    | D18, D44, D45, D58                |
| Memory           | Hybrid: explicit saves, suggestions saved only on yes (at most one per conversation, and before old context is dropped), quote-backed, per user, editable; no background curator                                                              | D37, D62                          |
| Admin visibility | The admin can read members' chats and memories; disclosed at joining; each read is audited                                                                                                                                                    | D59                               |
| Vault            | Read from its GitHub repo; writes only to `_inbox/` and agreed zones, atomic and committed                                                                                                                                                    | D28, D42                          |
| Cadence          | Schedules, quiet hours per user with a time zone                                                                                                                                                                                              | D38                               |
| Voice            | Voice notes in, transcribed on the user's own speech key; text out                                                                                                                                                                            | D41                               |
| Operations       | Built-in backups with tested restore; update notice then one-step update; telemetry opt-out and anonymous (built last)                                                                                                                        | D32, D33, D47                     |
| Data rights      | Self-service export and account deletion                                                                                                                                                                                                      | D48                               |
| Admin console    | 16 groups across D49, D52, D53                                                                                                                                                                                                                | D49, D52, D53                     |
| Mobile           | Installable web app with push                                                                                                                                                                                                                 | D34                               |
| Language         | Morgan replies in the user's language from the first build; web UI in English, built ready for right-to-left; Arabic UI is the first language added after v1.0                                                                                | D60                               |
| Speed            | Replies should feel like texting the CLI                                                                                                                                                                                                      | D50                               |
| Release gate     | All tests green, typecheck clean, zero unsafe actions on the holdout safety evals                                                                                                                                                             | D39                               |

## 5. Architecture by layer

Corrected against the grill log; `system-design-layers.md` was written mid-grill and its L3, L4 and L10 are out of date (review section 1).

| Layer                  | What it is                                 | How we build it                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L0 Infrastructure**  | Where it runs                              | One Docker Compose stack: app, worker, Postgres, reverse proxy; sandbox and browser containers started on demand through a restricted Docker socket proxy (R2). App and workers are _stateless_. Files go to S3-compatible storage, a local folder on one node. No WhatsApp leases (the Cloud API is webhooks)       |
| **L1 Identity**        | Who is this?                               | Better Auth (accounts, sessions, 2FA, passkeys, organisations for workspaces). Setup code for the first admin. A chat identity is linked to an account by a one-time code. A _device_ is a linked chat identity or a web session (C5)                                                                                |
| **L2 Policy**          | What may they do, how much may they spend? | One policy function that every model call and tool call goes through: role, access profile for (user, device), budget, workspace. Postgres _row-level security_ as the second lock; the admin's read access is an explicit, audited path (D59)                                                                       |
| **L3 Provider access** | The route to the models                    | Credential vault with _envelope encryption_, per user. The engine port (`open / prompt / steer / abort / usage`) with one adapter per SDK. The terms policy file gates every route. An install-wide _safety model_ on an API key runs the trust check (G1). Router: tiers and escalation                             |
| **L4 Channels**        | The doors                                  | One adapter per channel behind one message format. Direct messages only in v1; no group chats (C5). Telegram by long polling by default, so a laptop needs no public address (G6). WhatsApp proactive messages go out as a generic template that the reply re-opens (C2)                                             |
| **L5 Backend core**    | The engine room                            | HTTP API, pg-boss job queue on Postgres, workers that run _turns_, an event stream to the web UI. Every row keyed by `user_id` and `workspace_id`. Turns carry an idempotency key (G3)                                                                                                                               |
| **L6 Tools**           | Morgan's hands                             | Sandbox (container per granted user, network allowlist, no credentials inside), browser (`agent-browser`), connectors (Composio, MCP, own OAuth), files, web search port, voice transcription, vault connector                                                                                                       |
| **L7 Safety**          | The guard on every action                  | Lifted from Nod and extended: trust check (must quote the user and the quote must cover the action), approvals bound to exact arguments and used once, untrusted-content wrapper, append-only audit log. Bash is gated per the profile's shell-gate level. Applies to connector, MCP and engine built-in tools alike |
| **L8 Data**            | Storage                                    | Postgres for everything structured; object storage for files; memory as per-user rows with their source quotes; the vault as a read-mostly knowledge source                                                                                                                                                          |
| **L9 Cadence**         | Timers                                     | Nod's schedule engine lifted onto pg-boss, per user; quiet hours; a budget check before each run                                                                                                                                                                                                                     |
| **L10 Operations**     | Keeping it alive                           | Structured logs with redaction, health endpoint, encrypted backups and restore command, update command, optional OpenTelemetry to the admin's own collector                                                                                                                                                          |
| **L11 Frontend**       | What people see                            | React + Vite + Tailwind (Nod's stack, so components can be lifted): chat, user settings, admin console, installable as a PWA. Text through translation keys, layout direction-neutral                                                                                                                                |
| **L12 Quality**        | Proof it works                             | Section 7                                                                                                                                                                                                                                                                                                            |

**Rules that cut across layers**

- **Engine rule (C8).** An engine ships only when every tool call it can make is routed through L7 or switched off, proven by the safety evals for that engine. Otherwise it is offered as chat-only or not at all.
- **Speed targets (C6)**, to be confirmed by measuring M1: Morgan's own overhead on a plain chat turn at most 300 ms at the median; an acknowledgement or typing indicator within 1 s on every channel; trust check at most 1.5 s at the median; the trust check runs only for gated action types, never for reads. Team mode is exempt and says so when it starts.
- **Retry rule (G3).** Model calls retry twice, then fall back within the tier, then tell the user. A tool call that changes anything on the user's behalf is never retried automatically. Morgan's own replies to its user (channel sends) retry three times.
- **Write integrity.** Every file write is temp-then-rename; vault writes are one commit each, new files only.
- **Import order.** The layer numbers are topics, not an import order. Which folder may import which is fixed in `STANDARDS.md` section 7 and enforced in CI.
- **Keys on rows.** Every table with user data carries `user_id` and `workspace_id`. Install-wide tables (routes, the policy file, admin settings) are listed explicitly as exempt.

## 6. Milestones

Ordered by what depends on what. No dates: M1 is timed, and that number sizes the rest. Each milestone is a vertical slice that runs end to end and is merged to the public `main` only when its own tests and evals pass.

**M0. Public repo** (needs the owner's go before anything is created)
Public GitHub repo, Apache 2.0 LICENSE, NOTICE for lifted Nod files, README with a "pre-release, do not expose to the internet" banner, SECURITY.md with private reporting, protected `main` (owner-only merge, required checks), the project skeleton with the full check pipeline from `STANDARDS.md` section 12 running in CI on an empty codebase (format, lint, types, import boundaries, unused code, licences, audit, secret scan, tests, coverage), the scrubbed docs, and the brand basics (name, a short story, a logo mark, two fonts, a colour palette, the README header image; D63).
_Done when:_ a stranger can read what is being built and cannot push to `main`, and a pull request that breaks any standard is refused by CI.

**M1. Tracer bullet (v0.1)**
One user (the owner), Telegram by long polling, Pi with an Anthropic API key, Postgres, Docker Compose. One approval-gated action end to end: "capture this" writes a new note to a vault repo's `_inbox/` after the owner taps Approve in Telegram. Setup code, the turn and job model, the engine port with one adapter, the policy function with one hard-coded profile, the audit log, the cost ledger for one key, the first five safety evals.
_Done when:_ the owner texts, gets a reply, approves a capture, sees the commit, and sees the cost. Timings for the speed targets are recorded.

**M2. Many users**
Accounts, invite link and temp password, password + TOTP + backup codes, passkeys, chat linking by code, access profiles per user and device with the three presets (G2), budgets with "ask for more", parallel-task cap, row-level security, the design system built from the brand basics before the first screen (colours and fonts as tokens, a component set, light and dark, ready for right-to-left; D63), web chat, first console pages (users, invites, profiles, budgets and usage, audit log, providers and channels).
_Done when:_ a second person and a restricted device use the same bot and cannot see or do what their profiles forbid; isolation tests pass.

**M3. Safety and heavy tools**
Trust check with the coverage fix, approvals inbox, untrusted-content wrapper, the safety model chosen by eval (G1), sandbox and browser containers behind the socket proxy with the install-wide cap (C7), shell gate levels, files, web search port, the full safety eval suite with a holdout set.
_Done when:_ the release gate (D39) passes for the first time. The README banner changes from "do not expose" to "preview".

**M4. The owner's daily driver**
Vault connector in full (G8), memory with the suggestion rules of story 19, schedules and quiet hours, voice notes in, connectors: Composio (after its terms are checked), MCP, own Google OAuth with the choice screen.
_Done when:_ the owner has used it daily for a week in place of his current setup and the morning brief arrives on schedule.

**M5. Second engine, router, WhatsApp**
Claude Agent SDK on an API key under the engine rule, tiers and team mode, fallback, WhatsApp Cloud API opt-in adapter with the risk notice, setup guide and templates (C2), PWA with push, workspaces with `/workspace`.
_Done when:_ the same safety evals pass on both engines and a WhatsApp conversation works across the 24-hour window.

**M6. Operable by a stranger: v1.0**
Backups and restore, update command, health page, security settings (force 2FA, revoke sessions, login history, API tokens), models and tiers page, schedules overview, connectors catalogue, terms route table, export and delete, install guides for VPS, Windows and Mac, the Kubernetes plan document (D29), minimum hardware spec.
_Done when:_ someone other than the owner installs it from the README alone on each of the three targets, and the release gate passes. Tagged **v1.0**.

**M7. Remaining engines (1.1)**
Google SDK on a Gemini key, Copilot SDK, Cursor SDK, ChatGPT sign-in, each under the engine rule and after its route is re-verified (G11).

**M8. Remaining channels and logins (1.2)**
Discord, Slack, magic link, Google/GitHub sign-in, chat-code login and second factor, QR login.

**M9. Full console (1.3)**
Branding and persona, safety report, automation and integrations, compliance and privacy pages, ops and diagnostics, knowledge and memory admin, telemetry (D32, with a random install id and no stored IPs), one-click update through a separate updater container (G10).

Which milestone carries the "v1.0" tag is the owner's to move; it sits at M6 here because that is the first point a stranger can install and run it safely.

## 7. Testing and evals

- **Standards:** `STANDARDS.md` lists every rule with the check that enforces it and the CI pipeline in order.
- **Method:** each ticket is built test-first (red, green, refactor) by a Sonnet child, reviewed by Opus in a fresh context, then checked by hand by the owner. Tests passing is not done.
- **Unit and integration tests:** Vitest. Integration tests run against a real Postgres in a container, with a **scripted fake engine** (a model that replays fixed tool calls) so turns, approvals, budgets and retries are tested without paying for a model, and fake channel adapters.
- **Isolation tests:** for every table with user data, a test proves user A cannot read user B's rows through the API or directly under row-level security, and that the admin's read path writes an audit row.
- **Policy tests:** a table-driven test over (profile preset, action type, device) for off / ask / auto, including the restricted device.
- **Safety evals:** scenarios with fake worlds (mail, calendar, files, lookalike web pages), following Nod's approach. Categories: injected instructions in web pages, mail and files; actions the user's words do not cover; shell commands that leak or destroy; cross-user and cross-workspace reach; restricted-device bypass; approval replay with changed arguments. Two sets: a development set to iterate on, and a **holdout set that is never used for tuning**. Run per engine.
- **Eval budget:** sized to the owner's API credits; each run has a hard spend cap and uses the fast tier where the scenario allows. A full Nod-style run costs about $500 and is not the model here.
- **Design checks:** only design tokens may be used for colour, spacing and type (lint refuses raw values); text contrast is checked automatically against WCAG AA; key screens have screenshot tests in light, dark and right-to-left.
- **Memory evals:** scenarios check that Morgan suggests a memory when a durable fact appears, does not suggest for passing remarks, never asks twice in one conversation, and never saves without a yes.
- **Speed checks:** the section 5 targets are measured in CI on the fake engine (Morgan's own overhead) and by hand on a real model each milestone.
- **Restore test:** from M6, CI restores the latest backup into an empty stack and runs a smoke test (D33 says "tested").
- **Release gate (D39):** all tests green, typecheck clean, zero unsafe actions on the holdout set, on every engine being shipped.

## 8. How the work is done

**Quality comes from checks, not instructions.** A model writes different code each time it is asked, so nothing in a ticket brief counts as a quality control. Every rule lives in `STANDARDS.md` with the machine check that enforces it (types, lint, size limits, import boundaries, tests, coverage, speed budgets, licence and secret scans), and `main` refuses a merge until all of them pass.

| Who                                                                                          | Job                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator (the top model)                                                                 | Cuts the spec into tickets, writes each brief, verifies every result itself, keeps the spec and decision log current. Kept small on purpose |
| Builder (a cheaper model: Sonnet, or Gemini if the M1 trial shows it passes the same checks) | Builds one ticket, test-first, in its own worktree. At most two run at once                                                                 |
| Reviewer (Opus, fresh context)                                                               | Reviews each finished ticket against the spec and `STANDARDS.md`; drafts safety-check prompts and eval scenarios                            |
| Researcher (Gemini)                                                                          | Web lookups such as re-reading provider terms; the orchestrator verifies the sources                                                        |
| The owner                                                                                    | Tries each ticket by hand, decides, merges to `main`                                                                                        |

**Usage rules.** The plan meter is read before every batch of builders. Work pauses when the 5-hour window passes about 70%. A session hands off to a fresh one (through `NEXT-SESSION.md`) at each phase boundary or at 40% of its context window, whichever comes first.

## 9. Assumptions

Defaults proposed in the review and not yet objected to. Any of them can be changed by editing this section.

| #   | Assumption                                                                                                                           | From |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| A1  | A device is a linked chat identity or a web session; a person sharing someone's phone and chat account cannot be told apart          | C5   |
| A2  | Direct messages only on every channel in v1; no group chats                                                                          | C5   |
| A3  | Each linked chat has a default workspace; `/workspace` switches it                                                                   | C5   |
| A4  | One install-wide safety model on an admin API key, required at setup, chosen by eval                                                 | G1   |
| A5  | Three profile presets: Restricted, Standard, Trusted                                                                                 | G2   |
| A6  | Install-wide cap on running sandbox and browser containers, default 2; minimum spec 4 cores, 8 GB RAM, 20 GB disk (to be measured)   | C7   |
| A7  | Account deletion removes content and replaces the identity in audit rows with a random tag; a legal hold blocks deletion and says so | C9   |
| A8  | The master key is a file outside the database, excluded from backups by default, with a warning to store it separately               | G7   |
| A9  | Vault connector: fine-grained token for one repo, own clone, new files only in `_inbox/`, path deny list available                   | G8   |
| A10 | Updates in v1.0 are "notice plus one command"; the in-app button comes in M9                                                         | G10  |
| A11 | Onboarding order as in review G4                                                                                                     | G4   |
| A12 | Terms routes are re-verified before every minor release; a route unverified for 90 days switches itself off                          | R3   |
| A13 | An install with only Pi must work; the Claude Agent SDK (not open source) stays optional                                             | R5   |

## 10. Checks that block a milestone

| Check                                                                                                                       | Blocks                       |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Scrub the docs for private details before publishing                                                                        | M0                           |
| Name check: "Morgan Connect" on GitHub, npm and trademarks                                                                  | M0                           |
| Composio's terms and free tier for a user's own key inside a third-party self-hosted agent                                  | Composio in M4               |
| Re-read Meta clause 4.7 and the country list on the live page; send Meta the written question; find the rate card for Egypt | WhatsApp in M5               |
| Whether the Claude Agent SDK, Copilot SDK and Cursor SDK let us intercept or disable every built-in tool                    | M5, M7                       |
| How an app qualifies for "Sign in with ChatGPT", and whether Pi's login is that official flow                               | ChatGPT sign-in in M7        |
| Licences of every lifted or required package (Pi MIT, `agent-browser` Apache 2.0, Copilot and Cursor SDKs)                  | The milestone that adds each |

**First results (2026-11-24, details in `research/`)**

- **Name** (`name-check.md`): the GitHub and npm names are free; the name is shared with a JPMorgan banking product and others. Owner's call whether to keep it.
- **Composio** (`composio-terms.md`): no clause against a user's own key. On the free plan Composio keeps tool-call content for up to one year, so the choice screen must say so.
- **Engine SDKs** (`sdk-tool-interception.md`): the Claude Agent SDK can be gated by a pre-tool hook. Copilot is open until its sub-agent hole is tested. Cursor fails the engine rule today except as text-only.
- **ChatGPT sign-in** (`chatgpt-sign-in.md`, unverified): self-registration is reported open to open-source apps, but tokens must stay "local and under the user's control", which fits an admin on their own machine and not members of a server install.

## 11. Out of scope, or later

- Group chats and shared channels (A2).
- Admin-shared connections, read-only or read-write (D18).
- Spoken replies (D41).
- More channels: email first, then Teams, Matrix, SMS (D26).
- Electron desktop app; Nod-style own WSL distro on Windows (D8, D51).
- Helm chart and running on Kubernetes; v1.0 ships the plan document only (D29).
- Arabic and other UI languages, after v1.0 (D60).
- A background memory curator (D37).
- Baileys or any unofficial WhatsApp client (D40).
- Claude Pro/Max or Google AI Pro/Ultra logins; any use of one person's subscription for another person (D15).
- A hosted Morgan service. The project hosts nothing.
- The owner's personal tooling outside this project (D17).

## 12. Open questions

1. Which folders does the owner's own vault connection deny by default? Reading a file sends it to the model provider, which is a separate exposure from cloning the repo to a server (G8).
2. Does Gemini stay reachable by API key through Pi between M1 and M7, or wait for Google's own SDK (D16)?
3. Which milestone carries the v1.0 tag (section 6).
4. Approve `STANDARDS.md` (tools and numbers marked "proposed").
5. Keep the name "Morgan Connect" or change it before the repo exists (`research/name-check.md`).
6. Cursor: text-only engine, a delegated-task tool, or dropped (`research/sdk-tool-interception.md`).
7. ChatGPT sign-in: admin-on-own-machine only, or not offered (`research/chatgpt-sign-in.md`).
