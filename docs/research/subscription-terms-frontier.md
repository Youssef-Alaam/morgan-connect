# Subscription Terms: Frontier Providers

Access date for every URL: 2026-11-24. Quotes are under 15 words and come from the live pages. Terms change often. Re-check before any release (see "Re-check list" at the end).

Source grading: **[P]** = the provider's own terms, docs or help centre. **[S]** = forum, blog, news or third-party write-up. [S] material is not binding and never decides a verdict here.

Scenarios: **S1** = the subscriber installs Morgan and only they use their own subscription through it. **S2** = another user of the same install consumes that subscriber's subscription.

## Summary table

| Provider | Routes that exist | S1 (own use) | S2 (others consume it) |
|---|---|---|---|
| Anthropic Claude Pro/Max | Official CLI (`claude`, `claude -p`), Agent SDK, `claude setup-token`. No third-party OAuth programme for subscriptions. API key (incl. Max/Ultra monthly API credits) | **Subscription login: Forbidden** as a Morgan feature (Grey at best if the user privately wires their own unmodified `claude`). **API key: Allowed** | **Forbidden** |
| OpenAI ChatGPT Plus/Pro | **Official in-app OAuth for open-source apps** (Sign in with ChatGPT, "ChatGPT plan usage"), Codex CLI / app-server, Codex SDK | **Allowed with conditions** (official OSS flow, self-hosted, one account per user) | **Forbidden** |
| Google AI Pro/Ultra (Gemini) | Antigravity App/CLI/IDE (consumer OAuth, first-party only). Antigravity SDK = API key / Vertex only. Jules API (user key, coding tasks). Gemini API key | **Forbidden** for using the consumer plan as Morgan's model. Jules API: Allowed with conditions, narrow (coding tasks on GitHub repos) | **Forbidden** |
| Cursor Pro/Ultra | Official CLI (`agent`) with browser login or user API key; Cursor SDK (TS/Python) with user API key; Cloud Agents API | **Allowed with conditions** (official SDK/CLI, user's own key; you get Cursor's coding agent, not a raw model API) | **Grey, treat as Forbidden** |
| GitHub Copilot Pro/Pro+ | Copilot SDK with per-user GitHub OAuth (documented for multi-user apps), Copilot CLI with fine-grained PAT, OpenCode partnership. App-based Copilot Extensions are sunset | **Allowed** (official SDK, user's own OAuth or PAT) | **Forbidden** (but each user connecting their own Copilot is explicitly supported) |

Bottom line: three of five have a written, sanctioned way for a self-installed open-source agent to use the user's own subscription (OpenAI, GitHub Copilot, Cursor). Anthropic and Google consumer plans have no legal route for Morgan; use API keys there. No provider allows S2.

---

## 1. Anthropic: Claude Pro / Max / Ultra

### Routes that exist
- **Claude Code CLI** (`claude`, headless `claude -p`) and the **Agent SDK** (a library that runs the Claude Code binary). Both accept a claude.ai subscription login or an API key.
- **`claude setup-token`**: mints a one-year OAuth token for `CLAUDE_CODE_OAUTH_TOKEN`, meant for CI and scripts.
- **API key** from the Claude Console. Since 7 Oct 2026, Max ($100/mo) and Ultra ($200/mo) include monthly API credits claimable into a Console org, usable by the Agent SDK and `claude -p` with an API key.
- **Linked billing** (beta) lets a platform bill a customer's Console org via OAuth, but subscription plans "can't be linked". Not a subscription route.
- No third-party "Sign in with Claude" for subscription rate limits.

### What the primary sources say
- Agent SDK overview [P]: "Anthropic does not allow third party developers to offer claude.ai login or rate limits", "including agents built on the Claude Agent SDK", prefixed "Unless previously approved". (https://code.claude.com/docs/en/agent-sdk/overview)
- Legal and compliance [P], "Authentication and credential use":
  - OAuth "is designed to support ordinary use of Claude Code and other native Anthropic applications."
  - Developers building products, "including those using the Agent SDK, should use API key authentication".
  - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications".
  - Nor "route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users."
  - "developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
  - Carve-out: it does not "prevent an end user from signing in to the unmodified Claude Code binary". That carve-out sits in the section on companies offering Claude Code in their products, which requires agreeing to the Commercial Terms, an unmodified binary, and "Each end user must authenticate with their own" credentials.
  - "Anthropic reserves the right to take measures to enforce these restrictions".
  - Usage limits "assume ordinary, individual usage of Claude Code and the Agent SDK."
  (https://code.claude.com/docs/en/legal-and-compliance)
- Help centre, "Use the Claude Agent SDK with your Claude plan" [P]: 15 Jun 2026 update, Agent SDK, `claude -p` "and third-party app usage still draw from your subscription limits." This is billing information, not a permission. (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- Monthly API credits [P]: credits "cover `claude -p` and the Claude Agent SDK when you run them yourself with an API key". Max, Ultra, Team only; Pro not eligible. (https://support.claude.com/en/articles/17154008)
- Authentication docs [P]: `setup-token` token "authenticates with your Claude subscription"; it is for "CI pipelines, scripts". (https://code.claude.com/docs/en/authentication)
- Consumer Terms [P]: no automated access "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it". And "You may not share your Account login information" / "make your Account available to anyone else." (https://www.anthropic.com/legal/consumer-terms)
- Linked billing [P]: "Claude subscription plans (Pro, Max, Ultra, Team, and Enterprise) can't be linked". (https://support.claude.com/en/articles/18467110)

### February 2026 clarification [S only]
- On 19-20 Feb 2026 Anthropic updated the docs to the wording above. News coverage: The Register, "Anthropic clarifies ban on third-party tool access" (https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access), The New Stack (https://thenewstack.io/anthropic-agent-sdk-confusion/).
- Anthropic's Thariq Shihipar reportedly posted that the update was confusing and that personal use and local experimentation are fine, while businesses on the Agent SDK should use API keys. **This rests only on news and social posts; it is not in any terms or docs page I could find.** Do not rely on it.
- Reports of a planned separate "Agent SDK credit" from 15 Jun 2026 are superseded: the help centre says that change was paused and "That credit isn't available."

### Verdict
- **S1, subscription login offered by Morgan: Forbidden.** Morgan is a third-party product. Offering "use your Claude Pro/Max" in Morgan, whether through the Agent SDK, `claude -p`, or a `setup-token` token pasted into Morgan, is "offering claude.ai login or rate limits" and storing a session token. The written carve-out covers a user signing in to the *unmodified binary*, framed for platforms that have accepted the Commercial Terms. It does not say a third-party agent may drive that binary as its model backend.
- **S1, the user privately points their own install at their own logged-in `claude`: Grey.** Nothing says it is allowed, the "ordinary, individual usage" and anti-automation clauses cut against an always-on WhatsApp agent, and enforcement is "without prior notice". This does not meet the zero-risk bar, so Morgan must not ship or document it as a supported option.
- **S1, API key (including the Max/Ultra monthly API credits): Allowed.** This is the route Anthropic tells developers to use, and a Max subscriber gets $100/month of it at no extra cost.
- **S2: Forbidden.** Account sharing ban plus the explicit ban on routing plan credentials "on behalf of their users".

### What Morgan must do or avoid
- Ship Anthropic as **API key only** (`ANTHROPIC_API_KEY` / Agent SDK with key). Setup copy should point Max/Ultra users to claiming their monthly API credits.
- Never offer a "Sign in with Claude" button, never accept or store a `CLAUDE_CODE_OAUTH_TOKEN` or `~/.claude/.credentials.json`, never spawn `claude -p` relying on a subscription login.
- If the Agent SDK is used, run it with `ANTHROPIC_API_KEY` set so it never falls back to a stored claude.ai login (subscription OAuth is lowest in the precedence list, so an explicit key wins).
- Branding: may say "Powered by Claude"; may not call Morgan "Claude Code" or mimic it.
- If the owner wants a subscription route anyway, the only legal path is Anthropic's prior approval: contact sales (linked from the legal page).

---

## 2. OpenAI: ChatGPT Plus / Pro (and Go, Business)

### Routes that exist
- **Sign in with ChatGPT, "ChatGPT plan usage in your open-source app"** [P]: an official OAuth (OIDC + PKCE, dynamic client registration) flow that gives an open-source app an access token for Responses API requests billed to the user's plan. No API key or client secret.
- **Codex CLI / Codex app-server** with ChatGPT sign-in; the SIWC docs include a page for configuring app-server with a SIWC token. Codex SDK sits on the same auth.
- **API key** (separate pay-as-you-go billing).

### What the primary sources say
- SIWC quickstart [P]: "ChatGPT plan usage is available to all open-source partners and selected private clients." For open-source developers: "Let users run AI workloads in your tools with their ChatGPT plan". (https://developers.openai.com/siwc/quickstart)
- OSS overview [P]: "These docs explain ChatGPT plan usage for open-source and locally hosted apps." Paid or remotely hosted apps must "complete the interest form". Each issued `client_id` "is bound to the authenticated user and the workspace". An agent host may be "a laptop installation or a self-hosted VM". (https://developers.openai.com/siwc/token-sharing-open-source)
- Self-hosted VMs [P]: complete OAuth locally, then transfer credentials "over a secure channel such as SSH". (https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- Accounts and sessions [P]: keep tokens "out of browser storage, source control, logs, analytics"; "Never put access or refresh tokens in URLs"; serialise refreshes; revoke on sign-out; link users to ChatGPT Settings > Usage. Plus users share one five-hour limit across all apps. (https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- Preview limitations [P]: `store: false`, `stream: true`; no hosted tools (image gen, file search, code interpreter, hosted MCP); no audio input. (https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- Help centre [P]: "Supported open-source tools remain available to all ChatGPT users." "If you're an open source developer, explore our developer docs." Users can cap each app's weekly share in Settings > Usage. (https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)
- Partner directory [P] lists open-source integrations OpenClaw, OpenCode, Pi, T3. Nod is not listed. (https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- Codex auth [P]: `codex login` (browser or device code); treat `~/.codex/auth.json` "like a password"; "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD". (https://learn.chatgpt.com/docs/auth)
- Terms of Use [P]: "You may not share your account credentials or make your account available to anyone else". Also no circumventing "any rate limits or restrictions". (https://openai.com/policies/terms-of-use/)

### Nod (n8n)
- n8n's launch post [S, but first-party for Nod]: you connect your provider "with an API key or your ChatGPT plan", and "Each installation has one owner." (https://blog.n8n.io/meet-nod, 10 Nov 2026)
- OpenAI does not name Nod anywhere I found. Nod's legitimacy comes from the public OSS flow, which is self-serve ("available to all open-source partners"), not from a named partnership. So the permission Morgan relies on is the same public policy, not a Nod-specific deal.
- [S only] AICoder reported (Sep 2026) that OpenAI's Codex lead said third-party clients using Sign in with ChatGPT for Codex need a partnership, but pure open-source clients are supported. (https://www.aicoder.com/news/news-20260908-openai-codex-sign-in-policy). Consistent with the docs; not binding.

### Verdict
- **S1: Allowed with conditions.** OpenAI publishes an official route for exactly this case (open-source, locally or self-hosted).
- **S2: Forbidden.** Account-sharing ban; the client registration is bound to one user. A second user must sign in with their own ChatGPT account.

### What Morgan must do or avoid
- Implement the **official SIWC OSS flow**: dynamic client registration, PKCE, loopback callback, a persisted opaque `ext_agent_host_id` per install (UUID or JWK thumbprint, never an email).
- Do **not** reuse Codex CLI's client ID, scrape `~/.codex/auth.json`, or call private ChatGPT endpoints. If Morgan uses Codex app-server, feed it the SIWC token as the docs describe.
- Keep Morgan **free and open source and self-hosted**. A paid or Morgan-hosted (SaaS) version needs OpenAI's interest form and approval first.
- Store tokens in the OS keyring or a 0600 file, never in logs, chat transcripts or the web UI's browser storage. Serialise refreshes; revoke on sign-out.
- Bind the ChatGPT connection to the install owner. In multi-user mode, each user connects their own account.
- Respect the preview limits (`store:false`, streaming, no hosted tools) and show a link to ChatGPT Settings > Usage.
- Use the recommended labels "Sign in with ChatGPT" / "Continue with ChatGPT" and approved branding.

---

## 3. Google: Gemini under Google AI Pro / Ultra

### Routes that exist
- **Antigravity App / CLI (`agy`) / IDE extensions** with personal Google OAuth (Free, Pro, Ultra). First-party clients only.
- **Gemini CLI**: for Google One (AI Pro/Ultra) and unpaid users it "was replaced by Antigravity CLI on June 18th, 2026". That banner is why Gemini CLI no longer accepts an AI Pro sign-in. (https://geminicli.com/)
- **Antigravity SDK** (Python): Gemini API key, Gemini Enterprise / Vertex, or local models. No consumer-plan OAuth.
- **Gemini Code Assist** (individuals / with AI Pro or Ultra): reached through the same first-party clients.
- **Jules API** (alpha): a user creates an API key in Jules settings; it runs Jules coding sessions on connected GitHub repos.
- **Gemini API key** (Google AI Studio) or Vertex: separate billing.

### What the primary sources say
- Antigravity Additional Terms [P]: "You must not abuse, harm, interfere with, or disrupt the Service." That "includes ... using the Service in connection with products not provided by us." "Using third party software, tools, or services to access the Service ... is a breach". Consequence: "suspension or termination of your Antigravity and/or Gemini CLI accounts." (https://antigravity.google/terms?hl=en)
- Gemini CLI terms [P, last updated 10 Apr 2026]: directly accessing the services behind Gemini CLI "using third-party software, tools, or services" "is a violation of applicable terms and policies", with OpenClaw + Gemini CLI OAuth as the example. (https://geminicli.com/docs/resources/tos-privacy/)
- Antigravity auth docs [P]: SDK methods are "Gemini API Key", "Gemini Enterprise (Google Cloud / Vertex AI)", and local models. For headless/CI use of `agy`, the docs point to a Gemini API key or ADC, not the personal login. (https://antigravity.google/docs/install.md)
- Jules API [P]: keys are created on the Jules Settings page; "The Jules API is in an alpha release". No terms page or plan-limit statement on that page. (https://developers.google.com/jules/api)

### Forum material [S only]
- Many threads on discuss.ai.google.dev ask whether a third-party tool may run the official `agy` headless. Answers conflict: some say wrapping `agy -p` inside another vendor's agent is a Section 6 breach; others say headless use under your own account is fine. None is an official ruling. (e.g. https://discuss.ai.google.dev/t/is-it-allowed-for-an-open-source-tool-to-call-the-official-agy-cli-in-headless-mode/183429, https://discuss.ai.google.dev/t/can-a-third-party-desktop-app-run-the-official-antigravity-cli-with-the-user-s-own-google-ai-pro-ultra-subscription/190447)

### Verdict
- **S1, consumer plan as Morgan's model (OAuth, or driving `agy`/Gemini CLI from Morgan): Forbidden.** "Using the Service in connection with products not provided by us" covers Morgan calling `agy` as its backend, even with the unmodified binary and the user's own login. Penalty is account suspension.
- **S1, Jules API with the user's own key: Allowed with conditions, narrow.** It is an official programmatic API, but only for Jules coding sessions on GitHub repos, in alpha, and Google does not state how API use counts against the plan. Not a general chat model for Morgan.
- **S1, Gemini API key / Vertex: Allowed** (separate pay-as-you-go billing).
- **S2: Forbidden** on every consumer route.

### What Morgan must do or avoid
- Ship Gemini as **API key (AI Studio) or Vertex only**. Never offer Google sign-in for model access, never read `~/.gemini` credentials, never spawn `agy` or `gemini` as a model backend.
- Optional, later: a "Jules" tool that delegates a coding task to the user's own Jules API key. Label it alpha.

---

## 4. Cursor: Pro / Ultra

### Routes that exist
- **Cursor CLI** (`agent`, formerly `cursor-agent`): browser login, or a user API key "For automation, scripts, or CI environments". (https://cursor.com/docs/cli/reference/authentication)
- **Cursor SDK** (`@cursor/sdk`, Python SDK): local or cloud runtime, authenticated with a user or service-account API key; `Cursor.auth.login()` mints a 90-day user key through a browser login.
- **Cloud Agents API** (formerly Background Agents API) at `api.cursor.com/v1/agents`, same keys.
- No separate OAuth programme for third-party apps; the user API key is the mechanism.

### What the primary sources say
- SDK docs [P]: "User API keys bill to that user's plan." SDK runs follow "the same pricing, request pools, and Privacy Mode rules" as IDE runs. The docs name "embedded in-product agents, and orchestrators" as intended uses. "All inference goes through Cursor's hosted models in both modes." (https://cursor.com/docs/sdk/typescript)
- Terms of Service [P, updated 3 Sep 2026], 1.5: you may not "rent, lease, lend, or sell the Service", "harvest, scrape, or extract data", or build a competing model. 1.1 describes the Service as "coding tools". (https://cursor.com/terms-of-service)
- Acceptable Use Policy [P, updated 11 Aug 2026]: applies "regardless of subscription tier or how the Service is accessed". "If you allow others to use the Service under your account, you are responsible". Prohibited: "circumventing any rate limits", interfering with "usage-metering systems", "Exploiting account provisioning ... to avoid or reduce fees", "reselling any Input or Suggestion". (https://cursor.com/acceptable-use-policy)

### Verdict
- **S1: Allowed with conditions.** Cursor ships an SDK and CLI for programmatic use, bills user keys to the user's plan, and names embedded agents and orchestrators as use cases. Caveat: Morgan gets Cursor's *coding agent* (with its own tools and sandbox), not a raw Claude/GPT/Gemini chat API. The owner's idea of reaching those models "through Cursor" works only in that shape. Using it as Morgan's general chat brain is not prohibited in writing but is outside the "coding tools" purpose, and request pools drain fast.
- **S2: Grey, treat as Forbidden.** The AUP tolerates others using your account under your responsibility, but bans fee avoidance through account provisioning and "lend" / "sell" of the Service. A multi-user install riding one Pro seat is close to both. Use one key per user, or a Teams plan with service accounts.

### What Morgan must do or avoid
- Integrate through the **official `@cursor/sdk`** (or the `agent` CLI) with the user's own `CURSOR_API_KEY` or `Cursor.auth.login()`. Never read the Cursor IDE's local session or call private endpoints.
- Expose it as a **"delegate a coding task to Cursor" tool**, not as Morgan's default model provider.
- One key per Morgan user; show `Agent.getUsage()` cost per task; no retry loops that dodge rate limits.

---

## 5. GitHub Copilot: Pro / Pro+

### Routes that exist
- **Copilot SDK** with **per-user GitHub OAuth** (OAuth App or GitHub App): documented for multi-user apps. Also BYOK.
- **Copilot CLI** with a user-owned fine-grained PAT carrying the "Copilot Requests" permission (`COPILOT_GITHUB_TOKEN` / `GH_TOKEN`); classic PATs are ignored. (https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli)
- **OpenCode**: formal partnership, device login, for all paid Copilot plans.
- **Copilot Extensions** (GitHub App-based): sunset on 10 Nov 2025, replaced by MCP. Not a route. (https://github.blog/changelog/2025-09-24-deprecate-github-copilot-extensions-github-apps/)

### What the primary sources say
- Copilot SDK GitHub OAuth setup [P]: "Let users authenticate with their GitHub accounts to use Copilot through your application." Best for "Multi-user apps ... SaaS products". "Copilot usage is billed to each user's subscription." "Each user needs an active Copilot subscription". "Your application is responsible for token storage, refresh, and expiration handling." (https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)
- OpenCode changelog [P, 16 Jan 2026]: Copilot "fully supports authentication with OpenCode through a formal partnership". (https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/)
- GitHub Terms of Service [P]: "Your login may only be used by one person". Copilot is governed by Section J (AI Features), which has no third-party-client ban. (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
- Acceptable Use Policies [P]: no "excessive automated bulk activity", no placing "undue burden on our servers through automated means", no reselling access "without our express written permission". (https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- Billing [P]: since 1 Jun 2026 Copilot is usage-based (GitHub AI Credits), except legacy annual Pro/Pro+ plans. (https://docs.github.com/en/copilot/concepts/copilot-billing)

### On "third-party agents using a Copilot token"
- Sanctioned: the Copilot SDK with the user's own OAuth or fine-grained PAT, and OpenCode's partner flow.
- Not sanctioned: the older community trick of using VS Code's OAuth client ID and the internal `copilot_internal` token endpoint. I found no GitHub page permitting it, and it falls under the AUP's automated-access limits. **Avoid.** (That this trick exists rests on community code and forums [S].)

### Verdict
- **S1: Allowed.** GitHub documents this exact integration.
- **S2: Forbidden.** One login, one person. A second user connects their own GitHub account with Copilot, which the SDK supports directly.

### What Morgan must do or avoid
- Use the **Copilot SDK** with a Morgan-registered GitHub OAuth App using the device flow, so no client secret ships in an open-source repo. Offer a fine-grained PAT with "Copilot Requests" as a fallback.
- Set the SDK so it does not silently reuse Copilot CLI's stored login (`useLoggedInUser: false` per SDK docs [S: SDK repo docs]); Morgan owns its own token.
- One GitHub identity per Morgan user; never pool tokens; respect rate limits; surface AI-credit usage.

---

## What Morgan should build

1. **Three-tier provider adapters, decided by written policy, not by what works technically.**
   - **Tier A, subscription routes with written permission:** OpenAI (SIWC OSS flow), GitHub Copilot (Copilot SDK OAuth/PAT), Cursor (SDK user key, as a coding-task tool).
   - **Tier B, API keys:** Anthropic (incl. Max/Ultra monthly API credits), Gemini (AI Studio / Vertex), OpenAI API, others. Zero ToS risk.
   - **Tier X, never ship:** Claude subscription login or `setup-token`; Google consumer OAuth; wrapping `claude -p`, `agy`, `gemini`, or Cursor IDE sessions on a consumer login; reading other tools' credential files (`~/.claude`, `~/.codex/auth.json`, `~/.gemini`); private endpoints or borrowed client IDs.
2. **Credential ownership model.** Every credential belongs to one Morgan user identity, and each WhatsApp, Telegram or web identity maps to exactly one Morgan user. Default to single-owner installs (Nod's rule: one owner per install). Multi-user mode requires each user to connect their own accounts. No fallback to another user's credential, ever. This one rule makes every S2 verdict moot.
3. **Morgan never handles Anthropic or Google consumer tokens.** For OpenAI, Copilot and Cursor, Morgan does hold tokens: store them in the OS keyring (or a 0600 file on Linux VPS), keep them out of logs, transcripts, analytics and browser storage, serialise refreshes, and revoke on sign-out.
4. **Honest setup UX.** Per provider, say plainly: "Claude: API key only (Max/Ultra: claim your monthly API credits here)", "Gemini: API key only; your Google AI Pro plan cannot be used by third-party agents", "ChatGPT: sign in to use your plan", "Copilot: sign in with GitHub". Link to each provider's usage page and show cost per task.
5. **Stay open-source and self-hosted.** A Morgan-hosted or paid edition changes the OpenAI verdict (interest form needed) and the Anthropic one (Commercial Terms). Re-run this research before any hosted offering.
6. **Policy registry with a kill switch.** Keep a `providers/policy.json` listing each route, its source URL, and the date checked. Disable a route remotely by release if terms change, and re-check every release or monthly.

## Re-check list (volatile items)
- Anthropic legal page and Agent SDK note (changed Feb 2026; enforcement "without prior notice").
- OpenAI SIWC open-source eligibility (preview; partner directory changes).
- Antigravity Additional Terms and any official answer on headless `agy`.
- Cursor AUP (updated Aug 2026) and SDK billing.
- Copilot SDK auth docs and billing (usage-based since Jun 2026).
