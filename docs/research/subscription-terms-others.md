# Subscription Terms: Non-Frontier Providers

Access date for every URL: 2026-11-24. Quotes are under 15 words. Pages were read through a summarising fetch tool, so quotes are as returned by it; the x.ai consumer ToS and Mistral consumer ToS could not be fetched (403 / error), so those clauses are not verified.

Source grading: **[P]** = provider's own page. **[S]** = forum, blog, news or third-party docs (not binding).

## Summary table

| Provider                        | Routes that exist                                                                | S1 (own use, self-installed)                                                                   | S2 (other users consume it)                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| xAI SuperGrok                   | In-app OAuth (subscription), official Grok Build CLI, API key (separate billing) | Allowed with conditions (xAI itself promotes OAuth in OpenCode; no written third-party policy) | Grey, leaning forbidden (no clause found either way; ToS not fetched)            |
| Moonshot Kimi Code              | API key included in plan; official CLI/Desktop/VS Code login                     | Allowed with conditions (API key, honest User-Agent; Morgan not on the named-tools list)       | Grey, leaning forbidden (membership is personal; no explicit sharing rule found) |
| Z.ai GLM Coding Plan            | API key (dedicated coding endpoint) in supported tools only                      | Grey (only "officially supported" tools; general agent tools "best effort")                    | Forbidden ("Account sharing or multi-user access is prohibited")                 |
| MiniMax M Plan (ex Coding Plan) | OAuth in OpenClaw, API key (M Plan key)                                          | Allowed with conditions (plan is "individual, interactive developer use")                      | Forbidden / Grey (individual use; account-sharing ban in subscription terms)     |
| Alibaba Qwen                    | Free Qwen OAuth is dead (2026-04-15). Coding/Token Plan API key                  | Allowed with conditions: interactive use only, NO scripts, backends, scheduled tasks           | Forbidden ("must not be shared")                                                 |
| Mistral Le Chat/Vibe Pro        | Vibe CLI included; API key; BYOK                                                 | Allowed in Vibe CLI; third-party app use of the key is Grey                                    | Grey, leaning forbidden (consumer terms unverified)                              |
| DeepSeek                        | API key only, prepaid balance, no subscription                                   | No subscription route; API is plain pay-as-you-go (Allowed)                                    | Allowed with conditions (owner's own key and balance; not resale)                |
| OpenRouter                      | API credits (not a subscription); official OAuth PKCE mints a user key           | Allowed (official route)                                                                       | Grey/Forbidden if it amounts to reselling or transferring access                 |
| Perplexity Pro                  | None. Pro does not bundle API credit                                             | No subscription route                                                                          | No subscription route                                                            |
| OpenCode Go (extra)             | API key, explicitly for "OpenCode and other coding agents"                       | Allowed with conditions (typical coding-agent traffic)                                         | Forbidden (covers the subscriber; invited members get free models/balance)       |

Product consequence: the only providers where "use my own subscription in a third-party agent" is plainly sanctioned in writing are Kimi (API key, listed agents), MiniMax (OpenClaw OAuth/key), Z.ai (listed tools), Alibaba (interactive tools), OpenCode Go and, by public announcement, xAI. None allow S2. Pay-as-you-go API keys (DeepSeek, OpenRouter, Mistral API, xAI API) are the zero-risk route for multi-user installs.

## pi-ai OAuth vs official policy

- **OpenRouter**: matches. OpenRouter documents OAuth PKCE for apps; the user gets a key and "Their requests are billed to their own OpenRouter credits." [P] https://openrouter.ai/docs/guides/overview/auth/oauth. pi docs describe the same: "creates a user-controlled OpenRouter API key" [S/P-ish] https://unpkg.com/@earendil-works/pi-coding-agent@0.83.0/docs/providers.md
- **xAI**: partly matches. xAI announced "Use your SuperGrok or X Premium subscription inside OpenCode" (21 May 2026) [P] https://x.ai/news/grok-opencode, so subscription OAuth in third-party agents is publicly endorsed for named integrations. But I found no xAI document that opens it to arbitrary apps; pi's xAI login reportedly reuses the official Grok CLI public client id [S] https://cdn.jsdelivr.net/npm/pi-xai@0.17.1/xai-oauth.ts (a third-party package, not pi-ai itself). Reusing another product's client id is the Grey part. Also xAI reportedly 403s some tiers on the OAuth surface [S] https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth
- **Kimi Coding**: does NOT clearly match. Kimi's own docs say that for third-party tools "需要手动配置 API Key 完成认证" (manually configure an API key) [P] https://www.kimi.com/help/kimi-code/membership-guide; OAuth /login is described only for official clients. pi's own docs list Kimi only as an API-key provider [P-ish] https://unpkg.com/@earendil-works/pi-coding-agent@0.83.0/docs/providers.md. I could not read pi-ai's OAuth source (404 on the guessed path); community packages implement a device flow on auth.kimi.com [S] https://docs.rs/imp-llm/0.1.2/src/imp_llm/oauth/kimi_code.rs.html. Treat Kimi OAuth in a third-party app as unsanctioned; use the API key route. Kimi also treats User-Agent tampering as a violation.
- Not verified: that Nod actually uses pi-ai (no source found).

## xAI SuperGrok / Grok

Routes: (1) Grok Build CLI, "Available now to all SuperGrok and X Premium Plus subscribers" (25 May 2026) [P] https://x.ai/news/grok-build-cli. (2) Subscription OAuth in OpenCode, Kilo, Warp, Hermes, OpenClaw [P for OpenCode] https://x.ai/news/grok-opencode ; Warp: "xAI determines eligible tiers and usage limits" [S] https://docs.warp.dev/agents/inference/grok-subscription.md . (3) Separate API key, billed.
Terms: I could not fetch the current consumer ToS (403). A search snippet of archived versions shows bans on access "through any technology or means other than those provided by the Service or authorized by us" and on scraping/reselling outputs [S] https://x.ai/legal/terms-of-service/previous-2024-12-20 (archived, may be superseded). No SuperGrok-specific third-party clause found.
S1: Allowed with conditions: xAI promotes it for named tools; a custom agent is not named, and the OAuth allowlist may 403 you. S2: Grey, leaning forbidden; consumer subscription is personal and no multi-user right is granted.

## Moonshot Kimi Code

Routes: API key created in the Kimi Code console (up to 5) for third-party tools; /login for official CLI, Desktop, VS Code. Members "use their benefits in both the official client and third-party platforms" [P] https://www.kimi.com/en/help/kimi-code/membership-guide. Named agents: Claude Code, OpenCode, Codex, Hermes Agent [P] https://www.kimi.com/en/help/kimi-code/third-party-agents. Rule: "Tampering with the client identifier (User-Agent) is considered a violation" [P] same page.
Conflict: a search result summary said other Kimi pages call unlisted tools "abuse" and list only Kimi CLI, Claude Code and Roo Code; I did not reproduce that wording on a page I read, so treat as [S] until checked. The docs have changed across versions.
S1: Allowed with conditions: own API key, honest client identity, ideally an agent on the list; Morgan is not listed, so there is residual risk. S2: Grey, leaning forbidden; docs mention "quota sharing" only in passing and give no multi-user right.

## Zhipu Z.ai GLM Coding Plan

Routes: API key on the dedicated coding endpoint only. Scope: plan is "limited to use within the following officially supported tools" and users "may not use their subscription benefits for tools or scenarios outside of this scope" [P] https://docs.z.ai/devpack/tool/others ; general-purpose agent tools (OpenClaw) are served "on a best-effort basis" [P] same. Usage policy: plan "may only be used within officially supported tools and products"; "Account sharing or multi-user access is prohibited" [P] https://docs.z.ai/devpack/usage-policy (undated).
S1: Grey: legitimate only if Morgan counts as a supported/general agent tool; best-effort and risk-control (rate limiting, freezing). S2: Forbidden.

## MiniMax (M Plan, formerly Coding Plan / Token Plan)

Routes: OpenClaw OAuth ("No M Plan API key is required for OAuth sign-in") and M Plan API key for any OpenAI/Anthropic-compatible tool [P] https://platform.minimax.io/docs/token-plan/openclaw.md . FAQ: plan "designed for individual, interactive developer use"; "do not share" the key; use pay-as-you-go for production [P] https://platform.minimax.io/docs/token-plan/faq.md . MiniMax Agent subscription terms ban lending or sharing an account [P, but for the MiniMax Agent product] https://agent.minimax.io/doc/en/payment-policy.html . Plan keys cannot replace pay-as-you-go keys.
S1: Allowed with conditions: personal, interactive use; a 24/7 automated agent drifts toward "production". S2: Forbidden by the "individual" scope (Grey on exact clause).

## Alibaba Qwen

Free Qwen OAuth: "discontinued on 2026-04-15" [P] https://qwenlm.github.io/qwen-code-docs/en/users/support/tos-privacy/ . Qwen Code CLI itself is free/open source and uses your own API key. Its ToS mention a Plus/Pro subscription login separate from the old free tier; I could not confirm details.
Coding Plan: "for interactive use in programming tools"; "Do not use the plan's API key for automated scripts, application backends"; "The plan is for your use only and must not be shared"; breach "may result in subscription suspension or API key revocation" [P] https://www.alibabacloud.com/help/en/model-studio/coding-plan . Token Plan (replaces Lite plan): "production automated services, batch scripts, or scheduled background tasks is not allowed"; "sharing the same account or API key among multiple people is not allowed" [P] https://www.alibabacloud.com/help/en/model-studio/token-plan-faq . Workflow platforms (n8n, Dify) are listed as unsupported [S-grade summary of P] https://www.alibabacloud.com/help/en/model-studio/other-tools-coding-plan
S1: Allowed with conditions, but Morgan's cron/scheduled/autonomous tasks would breach "interactive only". S2: Forbidden.

## Mistral (Le Chat / Vibe Pro, Vibe CLI)

Vibe CLI is on Pro/Team; a plan allowance is shared across Studio, API and Vibe Code, with pay-as-you-go or bring-your-own key beyond it [P] https://docs.mistral.ai/vibe/code/cli/api-keys-profiles , https://docs.mistral.ai/admin/billing-usage/subscriptions (via search summary; direct fetch failed). Free mode has no API access [P] https://docs.mistral.ai/admin/billing-usage/usage-limits (search summary). EEA consumer terms cover Vibe but exclude Studio/API, which are for business customers [P] https://legal.mistral.ai/terms/eu-consumers-terms-of-service/ (search summary only; not read).
No Mistral statement found on third-party apps using the plan's allowance. S1: Allowed in Mistral's own CLI; elsewhere Grey. S2: Grey leaning forbidden (consumer terms not verified). Safe route: pay-as-you-go API key.

## DeepSeek

API only. Billed per token from a prepaid balance; pricing page mentions no subscription [P] https://api-docs.deepseek.com/quick_start/pricing . Open Platform terms: user "solely responsible for any fees incurred and losses caused by sharing or leaking the API key" [P via search] https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html (not read in full; no resale clause found).
S1: no subscription route; API key use is fine. S2: Allowed with conditions (operator's own key and balance, no resale).

## OpenRouter

Confirmed API billing, not a subscription: prepaid credits, "non-transferable, including between accounts" (§4.4); resale banned: "reselling API access to Models" (§7.4); "sell or otherwise transfer the access" (§7.14) [P] https://openrouter.ai/terms . OAuth PKCE officially supported [P] link above.
S1: Allowed. S2: Grey; free sharing is not clearly resale, but charging others or transferring access is forbidden.

## Perplexity Pro

Help center: Pro features list no API credit; the API Platform section says "No complimentary API credits" [P] https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you . News says the $5/month credit was removed around Feb 2026 [S] https://goosed.ie/news/perplexity-pro-quietly-removes-free-api-credits . No subscription route either scenario; the Sonar API is separate prepaid billing.

## Other providers selling plans for third-party agents

- **OpenCode Go** ($10/month [S]): "designed for OpenCode and other coding agents"; "Traffic is monitored for abuse" [P] https://opencode.ai/docs/go/ . Go and Go Plus cover the subscriber and the workspace's API keys; invited members get free models or workspace balance, so S2 is Forbidden. S1: Allowed with conditions (typical coding-agent traffic, send a session id header). General ToS: services for "internal use" [S] https://opencode.ai/legal/terms-of-service
- **Ollama Cloud** (Pro/Max): ToS bans "automated means to access our services without permission" and multiple accounts to circumvent limits [P] https://ollama.com/terms ; docs say it works with coding agents [S]. S1 Grey, S2 Forbidden/Grey. Not deeply checked.
- Not researched: Cerebras Code, Synthetic, Fireworks, Chutes, GitHub Copilot. Check before listing.

## Open items

1. Fetch the current xAI consumer ToS and AUP in a browser (403 to the tool).
2. Read the Kimi benefits page (the 301 redirect hid the "unlisted tools = abuse" claim).
3. Read Mistral consumer terms and pi-ai source for Kimi OAuth in the pi-mono repo.
4. Write to each provider's support for a written yes if Morgan wants S1 certainty: none publish an explicit rule on custom self-hosted agents.
