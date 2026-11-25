# Grill Log

Decisions from the grill sessions (Matt Pocock step 1), newest at the bottom. Each line gives the decision, the date, and where the detail lives. These become the ADRs and the spec.

## 2026-11-24
1. **Product:** self-hosted open source. Each installer is the admin of their own install. (`architecture/system-design-layers.md`)
2. **Users:** unlimited senders per install. The admin sets each user's permissions and spending limit.
3. **Billing:** the admin chooses (API keys and/or subscriptions), with a warning when one person's subscription serves someone else's requests. A subscription is tied to the person who owns it; all of their devices count as them.
4. **Base:** hybrid. Our own core, with Nod modules lifted in (Apache 2.0, keep LICENSE/NOTICE on copied files, mark changes), and a monthly upstream review. (`architecture/fork-vs-build.md`)
5. **Language:** TypeScript.
6. **Targets:** Linux VPS, Windows laptop, Mac / Mac mini.
7. **Scale:** designed multi-server-ready from v1 (stateless app, Postgres, Postgres job queue, object storage, pluggable sandbox runner, WhatsApp session leases), run as one node by default; Kubernetes is a later milestone. The owner gives time daily.
8. **Stack direction:** Postgres, Docker for the sandbox and browser, web UI first, Electron deferred. Not locked yet: the loop engine and provider access are still open.
9. **Terms-of-service rule (hard):** no breach of any provider's terms and no user account put at risk. Every subscription is used only through a route the provider allows. Where no legal route exists, the product says so and doesn't offer it. This replaces decision 3's "warning" approach for terms questions. Research is in `research/subscription-terms.md`.
10. **Claude subscriptions:** only through the Claude Agent SDK / Claude Code under the person's own login (subject to the terms research).
11. **Onboarding:** both (a) a one-time admin invite link (role and limits preset; the link dies once the account is created) and (b) the admin creates the account with a temporary password that must be changed at first login.
12. **Web login v1:** email + password + 2FA, passkeys, magic link by email, Google/GitHub sign-in. The owner asked for more options to be listed.
13. **Extra web login:** a one-time login code sent to the linked WhatsApp/Telegram chat, and QR login from a phone that is already signed in.
14. **2FA types:** authenticator app via the TOTP standard (works with Microsoft Authenticator, Google Authenticator, Authy and 1Password), plus a code sent to the linked chat. **Rule:** the chat can never count as both factors. Logging in with a chat code requires TOTP or a passkey as the second factor, and chat-code 2FA applies only to password or passkey logins. Backup codes added by default for recovery (recommended, to confirm).
15. **Terms research done** (`research/subscription-terms-frontier.md`, `research/subscription-terms-others.md`). Legal subscription routes for S1 (the subscriber uses only their own plan): **OpenAI ChatGPT** (official "Sign in with ChatGPT", free self-hosted open-source apps only), **GitHub Copilot** (Copilot SDK, per-user GitHub sign-in), **Cursor** (official SDK/CLI, with Cursor's agent rather than raw models), plus some coding plans with conditions (xAI, Kimi via API key, MiniMax). **Forbidden:** Claude Pro/Max login in any third-party product (including the Agent SDK, `claude -p` and `setup-token`), and Google AI Pro/Ultra via `agy` or Gemini CLI. **No provider allows S2.** This **reverses decision 10**: in Morgan, Claude and Gemini run on API keys only (Max includes $100/month of API credits). Every credential belongs to one person and is never shared. A policy file records each route's source and date and can switch a route off.
16. **Engine principle: each provider's own SDK.** Pi (MIT) for the generic API-key providers and the official ChatGPT sign-in; the **Copilot SDK** (the user's own GitHub sign-in); the **Cursor SDK** (the user's own Cursor key); the **Claude Agent SDK** on an Anthropic **API key** only (Max's $100/month credits count); **Gemini through Google's own SDK on a Gemini API key**. All of them sit behind one internal engine port, so approvals, costs and memory are written once.
17. **The owner's personal tooling** outside this project is not part of the Morgan product.
18. **Connected apps:** strictly per user in v1. Admin sharing of a connection (read-only or read-write) is logged as a later feature.
19. **Approver:** by default each member approves their own risky actions. The admin can require admin approval for chosen users or chosen actions.
20. **Spending limit reached:** work pauses, the user can tap "ask for more", and the admin gets a message to approve a top-up.
21. **Workspaces:** multiple workspaces per install (e.g. Family, Work team). Users can belong to several, and data, apps and budgets are scoped per workspace.
22. **Bot identity:** one bot per install. WhatsApp on a WhatsApp Business account plus a Telegram bot (free). The owner assumes an AI bot on WhatsApp Business is fine within its terms. This **conflicts with the earlier finding** that Meta's Business Solution Terms bar general-purpose AI assistants from 15 Jan 2026, so it goes to research (`research/whatsapp-business-terms.md`).
23. **Channels v1:** web chat, Telegram, WhatsApp, Discord, Slack. The owner asked for more recommendations.
24. **Parallel tasks:** the admin sets a cap per user, default 2.
25. **Heavy tools (sandbox, browser):** granted per user by the admin. Each granted user gets their own isolated container, started on demand and paused when idle.
26. **More channels:** the owner has no preference. Email (IMAP/SMTP), Microsoft Teams, Matrix and SMS are logged as later candidates, with email first, and are not in v1.
27. **Safety = admin-set access profiles, not a fixed list.** Every action type (send, post, reply as the user, delete, overwrite, share, publish, push, money) is supported. The admin sets per **user and per device/linked chat** whether each one is off, ask-every-time, or auto. Modes work like Claude Code's (ask / auto / bypass), and every grant shows a risk warning. Example: a device used by a younger family member gets a restricted profile.
28. **Vault:** v1. Morgan reads the Obsidian vault from its GitHub repo and writes only to `_inbox/` and agreed zones, with every write atomic and committed.
29. **Scale delivery:** ship on Docker Compose. A written Kubernetes plan (how the stateless app, queue, leases, sandboxes and storage map onto a cluster) is a required design doc before v1, and the Helm chart comes later.
30. **Shell gate:** the admin chooses the level per access profile (strict / risky-only / off). The suggested default for new profiles is risky-only plus a container network allowlist (to confirm at spec).
31. **Restricted-device example clarified:** a restricted device can chat and read. Share, publish, push, money, delete and send are all off.
32. **Telemetry:** opt-out, as Nod does. Anonymous aggregate usage only (counts of installs, users and features), never content or identities, and disclosed at onboarding. The admin can turn it off at any time. (Constraint for the spec: identifiable data would need opt-in consent under GDPR, so keep it anonymous.)
33. **Backups:** built-in and switchable. Offered during onboarding (daily or weekly; nightly encrypted dump of Postgres and files to a folder or S3-compatible storage) with a tested one-command restore. The admin may decline.
34. **Mobile:** an installable web app (PWA) with push notifications; chat apps cover the rest.
35. **Name: Morgan Connect.**
36. **Router: tiers + escalation.** Each provider profile defines fast / strong / boss tiers. Every message starts as one agent on the user's default model, which escalates to **team mode** (boss plans, managers and workers execute, boss reviews) for big jobs or on `/team`. There is no separate classifier. Owner and user can set preferred models.
37. **Memory: hybrid.** "Remember this" saves at once. Morgan may suggest a memory and saves it only on yes. Memories are quote-backed, per user, viewable, editable and deletable. There is no background curator.
38. **Quiet hours:** per user, with a time zone. Scheduled results wait until morning unless urgent.
39. **Release gate:** all tests green, typecheck clean, and zero unsafe actions on the holdout safety eval set.
40. **WhatsApp:** the official **Cloud API in v1**, on a dedicated number, with an onboarding guide for the Meta business portfolio and a clear note on the AI-provider clause. **Baileys dropped** (it breaks WhatsApp's terms). Telegram ships alongside. This settles 22 and 23. (`research/whatsapp-business-terms.md`)
41. **Voice v1:** incoming voice notes are transcribed on the user's own speech API key (OpenAI / Google / ElevenLabs) and replies come back as text. Spoken replies come later.
42. **Owner's own vault:** how the owner deploys his private vault repo on his own server is his decision and not part of the product.
43. **Licence:** Apache 2.0 (same as Nod).
44. **Connectors:** MCP servers plus the install's own OAuth apps, with Composio optional per user on that user's own key. Which one is the *default* path is still open (the owner wants Composio-level ease).
45. **Default connection path: Composio** on the user's own Composio key, with Morgan's security layer: every Composio action passes through the access profiles, approvals and safety check. Own OAuth apps plus MCP (with a guided per-provider wizard) are offered as the private upgrade. Onboarding must say plainly that data and tokens pass through Composio.
46. **Spending limits apply to the admin's API keys only.** Subscriptions are never shared (decision 15), so no subscription "quota share" is needed. A user's own subscription is limited only by their own plan.
47. **Updates:** notify, then a one-click update (new images and migrations, after an automatic backup).
48. **Data rights:** every user can export all their data (zip) and delete their account themselves.
49. **Admin console v1:** users, invites and access profiles; budgets and usage dashboard; providers and channels setup; audit log viewer. The owner asked what else is missing.
50. **Speed goal (owner):** replies on WhatsApp should feel like texting the CLI, close to the model's own speed. This is a design constraint for every layer.
51. **Windows:** Docker Desktop + Compose in v1 (one code path for all targets). Nod-style own WSL distro is a possible later option.
52. **Admin console v1 additions:** system health and backups/updates; security settings (force 2FA, revoke sessions/devices, API tokens, login history); workspaces and the connectors catalogue; models, tiers and a schedules overview.
53. **Admin console v1 also includes:** an approvals inbox; branding and the bot persona; the safety report; network and email settings; knowledge and memory admin; automation and integrations (webhooks, API keys, n8n/Zapier, scheduled admin reports, settings import/export); compliance and privacy (consent records, notice editor, export/delete log, legal hold, the terms-of-service route table); and ops and diagnostics (redacted logs and traces, feature flags, rate limits, maintenance mode, version and attribution page).
54. **Scope note for the spec:** v1 as decided is large. The spec must cut it into milestones (a tracer-bullet v0.1, then vertical slices), and "v1" means the first public release, not the first runnable build.

55. **WhatsApp is an opt-in adapter.** It stays in v1 but is off until the admin switches it on and accepts a written risk notice. **Rule 9 is reworded:** no *known* breach of any provider's terms; grey routes are off by default, labelled, and need the admin's opt-in. A written question goes to Meta. (spec session; `review-2026-11-24.md` C1)
56. **First engine:** Pi with an Anthropic API key for the v0.1 tracer bullet. All five engines of decision 16 are still built.
57. **Built in public:** the GitHub repo is public from the first commit, as a journey shared on video. Anyone may fork; only the owner merges to `main`.
58. **Composio presentation:** a choice screen with nothing pre-selected. Composio first ("easiest, data passes through Composio"), own OAuth second ("private"). Refines decision 45.
59. **Admin visibility:** the admin can read members' chats and memories, and members are told when they join.
60. **Arabic web UI:** after v1.0. The UI is built on translation keys and direction-neutral layout so it can be added without rework. Morgan replies in the user's language from the first build.
61. **Confirmed (no objection):** backup codes on by default (closes 14); shell gate default risky-only plus a container network allowlist (closes 30).

62. **Memory suggestions, rules:** Morgan asks "want me to remember this?" at most once per conversation, at the end of a reply, never mid-task; before old chat context is dropped it offers to keep what matters from it; notes are visible on a "notes about me" page and with `/notes`. Refines decision 37.
63. **Brand and front end are not left to the end:** brand basics (name, story, logo mark, two fonts, palette, README header) before the repo goes up; a design system built from them before the first screen in M2.

64. **Brand strategy approved:** the owner signed the set-up, research and strategy gates of the brand work on a one-page brief. Visual work (directions in words, then routes) starts only from that brief. Most lines are wording proposed by the AI and picked by the owner; each is marked as such in the brief.
65. **Brand audience:** the brand speaks first to the admin of a small team that pays for several AI models and wants one controlled front door; families come next. Self-hosting developers and larger organisations still use it.
66. **Brand purpose:** sharing an agent without a vendor, plus a controlled workspace that tracks and limits each model, which benefits any organisation.
67. **Vision and mission:** a household or small team runs its own agent the way it runs its own router, set up once by one person and used safely by everyone; built in public as one open-source install where an admin sets each person's limits and every action passes one safety check.
68. **Positioning and promise:** shared safely with the team, within each provider's terms, self-hosted on any model so no one vendor holds the data or the choice. Promise: it never acts unless the user's own words cover that exact action, and the user sees what it cost.
69. **Brand values:** within the rules (no known terms breach, even at a feature's cost); your yes, one action; nothing pre-selected where data is at stake; open by default.
70. **Personality:** calm but not sleepy; capable but not reckless; plain but not cheap. Voice: short, exact sentences that say what it does and what it costs, no hype.
71. **Identity requirements:** the mark works in one colour and at favicon / chat-avatar size; light and dark at WCAG AA contrast; no AI clichés (sparkles, robots, brains, glowing orbs); nothing that reads as a bank.
72. **Brand languages:** English first. The Arabic name and voice follow the Arabic UI after v1.0; Morgan's replies in Arabic are unaffected.

## Grill status
Closed on 2026-11-24 with an empty frontier at the decision level. Decisions 55-61 were added the same day in the spec session (
eview-2026-11-24.md, spec.md). Smaller choices (exact libraries, the trust-check model from evals, default profile values) are settled in the spec or by evals.
