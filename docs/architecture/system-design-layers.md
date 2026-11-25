# System Design by Layers

> Written mid-grill on 2026-11-24. Where it differs from `spec.md` (notably L3 provider access, L4 WhatsApp and L10 telemetry), the spec is right.

Written for a junior developer: every layer says what it is in plain words before it gets technical. Each layer lists its sub-components, how Nod does it (with the feature doc to read), the options, a recommendation, and the open questions for the grill. Words in _italics_ are defined in the glossary at the end.

## Decided so far (grill, 2026-11-24)

- Self-hosted open source. Whoever installs it is the **admin** of that install.
- Any number of users per install. The admin sets each user's permissions and spending limit.
- Base: **hybrid**. Our own core, with Nod modules lifted in (Apache 2.0, NOTICE kept), and a monthly upstream review.
- Language: **TypeScript**.
- Targets: Linux VPS, Windows laptop, Mac / Mac mini.
- Billing: the admin chooses, and gets a warning when one person's subscription serves someone else.
- Goal: let as many people as possible use their **own direct subscriptions** (ChatGPT, Claude, Copilot...) and not only API keys.

## The layer map

```
            ┌──────────────── Channels (L4) ────────────────┐
 WhatsApp · Telegram · Web chat · API · (later: email, voice)
            └───────────────┬───────────────────────────────┘
                            ▼
  L1 Identity: who is this?  →  L2 Policy: what may they do, how much may they spend?
                            ▼
  L5 Backend core: API server → job queue → workers → loop engine port
                            ▼
  L3 Provider access (API keys / subscriptions / CLIs, router)   L6 Tools (sandbox, browser, apps, files, voice)
                            ▼
  L7 Safety (trust check, approvals, untrusted content, audit) wraps every tool call
                            ▼
  L8 Data (Postgres, file storage, memory, git vault)   L9 Cadence (schedules, background jobs)
                            ▼
  L0 Infrastructure (containers, servers)   L10 Operations (logs, backups, updates)   L11 UI   L12 Quality
```

---

## L0 Infrastructure: where it runs

**Plain words:** the computers and containers the system lives on.
**Sub-components:** the app server process, Postgres, the job queue, sandbox containers (one per user or task), browser containers, file storage, a reverse proxy (HTTPS), and an installer per target (Docker Compose for VPS/Mac; WSL 2 + Docker for Windows).
**Nod:** Electron on the desktop; WSL distro plus 3 containers on Windows; Compose stack for self-hosting (doc 17, report 03).
**The scale question explained:** "2-3x cost" meant three costs, not only time:

1. **Build time.** Every feature must work when it is split across machines. Example: a WhatsApp connection is one live socket and can only live on one machine, so you need _sticky_ routing and failover. Schedules must fire exactly once even with 5 workers. Files can't sit on one server's disk. Each of these is extra code and extra tests.
2. **Complexity forever.** Bugs in distributed systems are the hardest kind (race conditions, partial failures). As a junior you'd be debugging Kubernetes networking alongside agent bugs. Agents can write the code 24/7, but **you** still have to understand, QA and review it (Matt's rule: human QA stays).
3. **Running cost.** A cluster has a floor cost (several nodes, a managed database, load balancer) even with one user. A single server is ~$5-24/month.
   **Recommendation:** you said time isn't the limit, so build **multi-server-ready from v1**, but run it as **one node** by default: stateless app servers, Postgres as the only source of truth, a Postgres-based job queue, object storage for files (S3-compatible; a local folder on a single node), and a sandbox runner interface with "local Docker" and "remote Docker host" drivers. WhatsApp sessions get a lease in Postgres so exactly one worker owns each number. Add a Kubernetes Helm chart as a later milestone, tested in CI. You get the scale design without paying the cluster complexity on day one.
   **Open questions:** Kubernetes support in v1 or a later milestone? Minimum spec we promise to run on?

## L1 Identity and authentication: who is this?

**Plain words:** before Morgan does anything it must know which person sent the message, whether from the web, WhatsApp or Telegram.
**Sub-components:**

- **Accounts:** the admin, plus members created or invited by the admin.
- **Web login:** password + 2FA, passkeys, or a magic link by email. Optional sign-in with Google/GitHub (OIDC).
- **Channel identity linking:** a WhatsApp number or Telegram user id is linked to an account by a one-time code (Nod does this with "chat verification", doc 12). Unknown senders are ignored.
- **Sessions and tokens:** web session cookies (short-lived, rotated), personal API tokens for scripts, device tokens for the desktop app.
- **Bootstrap:** the first person to open a fresh install sets up the admin (with a one-time setup code printed in the server log, so a stranger can't claim it first).
  **Nod:** one static owner key used as a 400-day cookie, no users, no rotation (doc 16). This is the single biggest rewrite.
  **Recommendation:** use an auth library rather than writing crypto ourselves. **Better Auth** (TypeScript, MIT, has an admin plugin, organisations, 2FA, passkeys, API keys) fits. Lucia is deprecated, and Auth.js is weaker for non-Next.js apps. Channel linking by one-time code, as Nod does it.
  **Open questions:** login methods for v1? Can members sign up themselves with an invite link, or does only the admin create accounts? Multiple _workspaces_ (teams) per install, or one?

## L2 Authorization and policy: what may they do?

**Plain words:** once we know who you are, this decides what you're allowed to do and how much you may spend.
**Sub-components:**

- **Roles:** admin, member, plus maybe a "guest" (chat only, no tools).
- **Permissions per user:** which tools (browser, sandbox, apps, files), which connected accounts (the admin's Gmail? only their own?), which models and providers.
- **Spending limits:** per user per month in dollars (API keys), and in _quota share_ for subscriptions (e.g. "max 20% of the admin's Claude 5-hour window").
- **Approval rules:** which actions always ask, which may run on the trust check's quote (L7).
- **Data isolation:** user A can never read user B's chats, memory or files (enforced in every database query, and ideally by Postgres _row-level security_ as a second lock).
  **Nod:** single owner, so none of this exists. Data rows already carry `owner_id` (1,416 references), which helps isolation.
  **Recommendation:** role + permission table + per-user budget table, checked in one _policy_ function that every tool call and model call goes through. Postgres row-level security on all user data.
  **Open questions:** do users share any connected app (e.g. a team Notion)? Who approves a member's risky action: the member, or the admin? What happens at a limit: hard stop, or ask the admin?

## L3 Provider access: how we reach the AI models

**Plain words:** the "fuel line" to the AI. Some people have API keys (pay per use), some have subscriptions (ChatGPT Plus, Claude Max, Copilot). This layer stores those credentials safely and picks which one each request uses.
**Sub-components:**

- **Credential vault:** stores API keys and subscription logins (OAuth tokens), encrypted, per user.
- **Subscription adapters**, three kinds:
  1. _Direct OAuth_: log in to the provider inside Morgan. Pi (MIT, the engine Nod uses) already ships logins for **Anthropic, OpenAI ChatGPT, OpenAI Codex, GitHub Copilot, Kimi Coding, xAI, OpenRouter** (verified in `@earendil-works/pi-ai` 1.6.0, `dist/auth/oauth/`). Nod switches all of them off except ChatGPT.
  2. _Official CLI driver_: Morgan drives the vendor's own CLI under the person's own login (Claude Code via the Claude Agent SDK; Codex CLI; Antigravity for Gemini).
  3. _API key_: any of ~40 providers.
- **Terms status per subscription** (what the product shows):
  | Provider                          | In-app login                                                                        | Official CLI route                                      | Note                                               |
  | --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
  | OpenAI ChatGPT / Codex            | Allowed (OpenAI supports "Sign in with ChatGPT" in third-party tools; Nod ships it) | Codex CLI                                               | Green                                              |
  | Anthropic Claude Pro/Max          | **Forbidden** for third-party apps (Feb 2026 clarification)                         | Claude Code / Agent SDK under own login, individual use | Use the CLI route; in-app login = account-ban risk |
  | Google AI Pro (Gemini)            | Not offered by Google                                                               | Antigravity CLI: grey zone                              | Warn                                               |
  | GitHub Copilot                    | Used by several open tools; terms unclear                                           | -                                                       | Warn (verify)                                      |
  | Kimi / GLM / MiniMax coding plans | Many are sold for use in third-party coding tools                                   | -                                                       | Usually green (verify per plan)                    |
- **Router/orchestrator:** picks provider + model per request: cheapest adequate path, the user's allowed models, remaining quota, fallback when a provider is down or a quota window is exhausted.
- **Usage and quota tracking:** dollars for API keys; for subscriptions, rate-limit headers and "usage limit reached" errors turn into a quota state.
  **Nod:** Pi with ~40 providers, ChatGPT-only subscription, up to 3 fallbacks, custom OpenAI-compatible endpoints (doc 10).
  **Recommendation (changes the loop-engine pick):** because you want the **most subscriptions**, use **Pi as the main engine** (it already speaks all those logins and ~40 providers, and Nod's code is built on it), plus the **Claude Agent SDK** as the Claude route that stays inside Anthropic's terms. A per-provider "terms status" table in the code drives the warnings. Note that `loop-engine.md` recommended the AI SDK before this requirement was known.
  **Open questions:** ship the Anthropic in-app login at all (with a warning, as you prefer), or only the CLI route? Who maintains the terms table: us, in code, reviewed monthly?

## L4 Channels: how messages get in and out

**Plain words:** the doors people use to talk to Morgan.
**Sub-components:** WhatsApp (Baileys: unofficial, a ban risk the user accepts; Cloud API: official, paid, no general assistants), Telegram (official bot API, free), web chat, REST API + webhooks, later email and voice calls. A normaliser turns every channel's message into one internal format. Per-channel limits (file sizes, formatting).
**Nod:** chat-sdk adapters for WhatsApp/Telegram, one allowed sender (doc 12).
**Recommendation:** Telegram and web chat as the safe defaults; WhatsApp via Baileys behind a clear risk warning. One Morgan bot can serve many users. Each channel identity maps to one account (L1).
**Open questions:** one shared bot number for all users of an install, or one per user? Is Discord or Slack needed?

## L5 Backend core: the engine room

**Plain words:** the server code that receives messages, queues work, runs the agent, and streams progress back.
**Sub-components:** HTTP API server (Fastify or Hono), _job queue_ (pg-boss: Postgres-based, the one Nod uses, so no extra service), workers that run _turns_, the loop-engine port (`open / prompt / steer / abort / usage`), and an event stream to the UI (SSE).
**Nod:** turns table + pg-boss + one turn per session, no retries (doc 01).
**Recommendation:** copy Nod's turn model nearly as-is, with every row keyed by `user_id` and `workspace_id`. Workers stay stateless so you can run 1 or 50.
**Open questions:** how many turns may one user run in parallel? Per-user and global concurrency caps?

## L6 Tools and capabilities: what Morgan can do

**Plain words:** Morgan's hands: a private computer, a browser, connected apps, files, voice.
**Sub-components:** sandbox (Docker container per user, network-filtered), browser (`agent-browser`, Apache 2.0), apps (MCP servers, Composio or self-hosted alternatives), files (object storage), voice (speech-to-text and text-to-speech).
**Nod:** docs 06-09, 11.
**Recommendation:** a sandbox per user, created on demand and paused when idle. Bash commands **do** go through the trust check (Nod skips this, a gap we verified at `src/runtime/index.ts:794`). Lift Nod's browser integration.
**Open questions:** does every user get a sandbox and browser, or only by permission? Self-host Composio-like connectors or keep n8n's hosted proxy?

## L7 Safety: keeping it from doing harm

**Plain words:** the guard on every action, so a bad web page or a wrong model guess can't send, delete, pay or leak.
**Sub-components:** trust check (a separate model call must quote the user's words), approvals (tied to exact arguments, run once), "always ask" list, untrusted-content wrapper, outbound network rules, and an append-only _audit log_ per user.
**Nod:** docs 03-04. Gaps: bash isn't gated, and the quote check proves existence, not coverage.
**Recommendation:** keep Nod's design, close both gaps, add the per-user policy from L2, and test it with our own evals (L12) before release.
**Open questions:** which actions are "always ask" by default? Is the admin allowed to approve on a member's behalf?

## L8 Data: where things are stored

**Plain words:** the memory of the system: users, chats, settings, files, and Morgan's long-term memory.
**Sub-components:** Postgres schema (~55 tables in Nod, plus users, roles, budgets, workspaces), file/object storage, per-user memory, credentials (encrypted with a server key; _envelope encryption_), and optional git-vault sync (your Obsidian vault as a user's knowledge base).
**Nod:** docs 08, 13, 15.
**Recommendation:** Postgres for everything structured; S3-compatible storage for files; memory per user as rows, not one 256 KiB document; the git vault as an optional "knowledge source" connector, read-mostly, with writes only in agreed zones.
**Open questions:** must the vault sync be in v1? Backups: who runs them, and how often?

## L9 Cadence: things that happen on a timer

**Plain words:** reminders, daily briefs and recurring tasks.
**Sub-components:** schedule definitions per user, the job queue firing them exactly once, missed-run policy, quiet hours, and budget checks before firing.
**Nod:** doc 14.
**Recommendation:** lift Nod's schedule engine onto pg-boss, keyed per user.

## L10 Operations: keeping it alive

**Plain words:** what the admin needs to run it: logs, health checks, backups, updates, error alerts.
**Sub-components:** structured logs, OpenTelemetry (optional), a health endpoint, backup/restore commands, signed releases with an update notice, and **no telemetry by default** (Nod's is on by default, doc 18).
**Open questions:** opt-in anonymous telemetry, or none at all?

## L11 Frontend: what people see

**Plain words:** the web app for chat, settings, and the admin console (users, limits, providers, logs).
**Sub-components:** React + Vite + Tailwind (Nod's stack, so components can be lifted), the admin console, the user settings, a mobile-friendly layout, and an optional Electron/desktop wrapper later.
**Open questions:** is mobile web enough, or is a native app wanted later?

## L12 Quality: proving it works

**Plain words:** automated tests plus _evals_ that check the AI behaves safely.
**Sub-components:** unit tests (Vitest), API tests, the safety eval suite (lift Nod's approach, doc 19), CI on GitHub Actions, and a release checklist.
**Recommendation:** no release unless there are zero unsafe actions on the holdout eval set.

---

## Glossary

- **Stateless app server:** keeps nothing in its own memory between requests, so you can run many copies; all state lives in Postgres or storage.
- **Job queue:** a to-do list in the database; workers pick jobs, and a job is never lost if a worker dies.
- **Sticky:** a connection (like WhatsApp's socket) that must stay on one specific machine.
- **Orchestration (Kubernetes):** software that runs many containers across many machines and restarts them when they fail.
- **Turn:** everything Morgan does from your message to its final reply.
- **Row-level security:** a database rule that lets a query see only the rows of the current user, a second lock behind the code.
- **Envelope encryption:** each secret is encrypted with its own key, and those keys are encrypted with one master key kept outside the database.
- **Quota share:** the portion of a subscription's usage window one person may consume.
- **Workspace:** a group (family, team) inside one install, with its own shared settings.
- **Evals:** test scenarios for the AI itself ("a web page tells it to email your files: does it refuse?").
