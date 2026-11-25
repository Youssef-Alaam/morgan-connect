# WhatsApp Business: can Morgan use it?

Researched 2026-11-24. Access date for every URL below is 2026-11-24 unless stated.

**Method caveat.** Pages were read through a fetch tool that summarises, so quotes are as reported by that tool, not checked character by character. Some Meta pages came back in Arabic (account locale) and were translated; the English quotes in section 1 came from the `?locale=en_US` copy. Re-read the clauses on the live pages before any legal reliance. Sources marked **[S]** are secondary (news or third-party); all others are primary Meta/WhatsApp pages.

## Verdict table

| Route | Allowed for Morgan? | Conditions | Cost | Ban risk |
|---|---|---|---|---|
| WhatsApp Business Platform (Cloud API), admin deploys Morgan for own household/team | **Grey, not safely.** Not clearly banned, not clearly allowed; Meta decides "in its sole discretion" | Admin is the Meta "business"; the Morgan project must not act as an AI Provider offering the assistant as the product; business portfolio, dedicated number, valid-TLS webhook | Probably $0 at a few hundred messages/month (1,000 free service messages per number, per Meta pricing page) | Medium to high. Number and account can be suspended; Meta may terminate "for any reason" |
| Cloud API, Morgan offered as a hosted/shared bot to many customers | **No** (the ban's core case) | Only if the user's number is in an exempt country (Italy, EU/EEA list, Brazil, Turkiye) | n/a | Near certain |
| WhatsApp Business app on a phone + Baileys or similar unofficial library | **No** (breaks WhatsApp Terms and the unofficial-apps rule) | None that make it legal | $0 | High; the ban hits the phone number, which may be the owner's real number |
| Official WhatsApp app, human typing | Yes, but no bot | n/a | $0 | None |
| Messenger / Instagram Messaging API (Page-based) | **Plausibly yes**; no general-purpose-AI ban found in the policy text read | Facebook Page + app; "automated" bots must answer within 30s; disclose bot where law requires; app review for live use | $0 found | Low to medium (policy silent on general AI; read full Developer Policies) |
| Non-Meta channels (Telegram, Signal, Matrix, own web app) | Yes | No Meta terms apply (out of scope here) | Varies | Low |

**Bottom line.** Do not make WhatsApp the default channel. Ship Telegram (or similar) first and treat the WhatsApp Cloud API as an optional adapter that the admin enables at their own risk, with a clear warning. Do not ship or document a Baileys adapter as supported.

## 1. WhatsApp Business Platform (Cloud API)

**Primary source:** Meta Terms for WhatsApp Business Platform, https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform (page shows "last modified" 23 September 2026; read via `?locale=en_US`). The old URL `whatsapp.com/legal/business-solution-terms` redirects here.

**Section 4.7 "AI Providers" (wording as reported):**
- "Providers and developers of artificial intelligence or machine learning technologies" are "strictly prohibited from accessing or using the WhatsApp Business Platform" when their technology is the "primary (rather than incidental or ancillary) functionality" made available. Examples named: large language models, generative AI platforms, general-purpose AI assistants.
- Meta decides what is an AI Provider and what is primary functionality "in its sole discretion."
- Allowed: a business may use an AI Provider as its Solution Provider, but may not let platform data train or improve AI models. Fine-tuning a model for its own exclusive use is allowed if the data does not improve any other model.
- Exception: the ban does not apply where such technology "may be made available to businesses in certain countries," listed at https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers
  - Listed markets: Italy (from 16 Feb 2026), EU/EEA markets (11 Mar 2026), Brazil (11 Mar 2026), Turkiye (listed 15 Oct 2026; the page also says the policy "took effect February 16, 2026", so the Turkiye date is inconsistent; verify). Egypt and Saudi Arabia are not listed.
  - Conditions: service messages only, inside the 24-hour window, only where Meta is legally required to permit it.
  - Webhooks tag this traffic `general_purpose_ai` and the Pricing Analytics API uses `AI_BOT`, so Meta can see and classify it.

**Effective date.** Secondary **[S]** reporting (TechCrunch, 18 Oct 2025, https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/ ) says new API users were bound from 15 Oct 2025 and everyone from **15 Jan 2026**. The primary pricing page refers to the Terms "updated January 15, 2026". The terms page itself shows no separate effective date. The earlier check's date (15 Jan 2026) is correct.

**Correction to the earlier check.** The ban is not on every "general-purpose AI assistant". It is on "AI Providers" whose AI is the "primary functionality" made available. A business using AI inside its own customer service is not the target (secondary reports say so; the platform policy at https://whatsappbusiness.com/policy/, last updated 23 Sept 2026, allows automation in the 24-hour window if there are prompt escalation paths).

**Would a self-hosted Morgan fall under it? (my reading, not Meta's)**
- For the ban: the assistant would be the whole product the WhatsApp users get, which is the "primary functionality" test. The platform is built around businesses and consumer "WhatsApp Users"; a household is not a business.
- Against: the definition targets those who offer the technology. Each admin deploys their own instance and is the Meta customer; they are not distributing an assistant to the public. The open-source Morgan project hosts nothing, so it is not itself a Solution Provider.
- No household/"personal use" carve-out exists, and I found no clause forbidding personal use either (the only business-purpose wording found concerns Service Credits, section 3.4). Absence of a ban is not a safe harbour: Meta may terminate "at any time for any reason upon notice" (5.2) and suspend access (3.2).
- Net: grey area, decided case by case by Meta. A small admin using it with their own team for their own business is the most defensible; a family-only bot is the weakest fit.

## 2. WhatsApp Business app + Baileys (unofficial client)

- WhatsApp Terms of Service, https://www.whatsapp.com/legal/terms-of-service (the copy fetched showed "January 4, 2021"; may be old, check for newer). Reported prohibitions: creating "software or APIs that function substantially the same as our Services" for unauthorised use; creating accounts "through unauthorized or automated means"; "bulk messaging, auto-messaging, auto-dialing"; reverse engineering.
- Unofficial apps, https://faq.whatsapp.com/1217634902127718/ (read in Arabic, translated): third-party apps made without WhatsApp's approval violate the Terms, and the account "may also be banned, temporarily or permanently", with limits on linking devices.
- Baileys is an unofficial client of the multi-device protocol, which is what these pages describe. No exemption for the Business app. The ban hits the phone number. The Business-app ban FAQ (https://faq.whatsapp.com/723378546580115) did not list automation in the text I could read.
- Verdict: breaks the terms; high ban risk; the cost is the number itself. Not supportable for a multi-user product.

## 3. Pricing (Cloud API)

Sources: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing and .../pricing/non-template-messages.md.
- Per-message billing since 1 July 2025; "Businesses are only charged when a message is delivered." User-to-business messages are never charged.
- Categories: marketing, utility, authentication (templates, any time); service (free-form, inside the 24-hour window a user message opens); Meta Business Agent ($2.00 per 1M tokens).
- Free: 1,000 free service messages per business phone number per month (main pricing page). Click-to-WhatsApp-ad windows are free for up to 7 days.
- **1 Oct 2026:** service messages beyond the free tier, and in-window utility messages, became chargeable; a payment method must be on file or Meta "will stop delivering service messages". The earlier check was right about Oct 2026 but missed the 1,000-message free tier. The non-template page does not mention that tier, so confirm in WhatsApp Manager.
- Service rate equals that market's utility/authentication rate. Only benchmark found: Brazil 0.68 US cents. The per-market USD rate cards (CSV/PDF) were not reachable; interactive rates at https://business.whatsapp.com/products/platform-pricing#rates. Third-party figures **[S]** (SleekFlow, eesel) were not verified.
- **Estimate:** 300 replies/month sits inside the free 1,000, so about $0. If the free tier did not apply: 300 x roughly 0.5 to 1 cent = about $1.50 to $3. Proactive messages outside the 24-hour window (briefings, reminders) need approved templates and are charged at utility/marketing rates.
- AI Providers are exempt from the Oct 2026 service pricing and follow their own country policy.

## 4. Requirements

- Meta business portfolio, created during app setup (https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started).
- Phone number (.../business-phone-numbers/phone-numbers): owned by you, can receive SMS/voice, must not already be on WhatsApp (delete first), and registration needs an explicit register call. So the bot needs its own number, not the admin's personal WhatsApp.
- Display name is required at registration; status values include PENDING_REVIEW and DECLINED; the approval criteria were not on the page read. Unconfirmed.
- Webhook: public endpoint with a "valid TLS or SSL digital security certificate"; "Self-signed certificates are not supported." (.../webhooks/create-webhook-endpoint). Self-hosters need a domain plus a reverse proxy or tunnel.
- Business verification is not needed to start. A new portfolio can message 250 unique users per rolling 24h outside service windows, rising to 2,000 by verifying or by sending 2,000 delivered template messages in 30 days; two numbers max until then (.../messaging-limits and the phone-numbers page). Replies to users who messaged first are not that limited kind, so a small private bot likely never needs verification. The verification rules themselves could not be read on a Meta page; third-party guides **[S]** (e.g. https://help.sleekflow.io/whatsapp/facebook-business-verification) say a "Sole Proprietorship" option exists and accepted documents vary by country. Unconfirmed whether someone with no registration can pass.
- Net: a self-hoster without a registered company can probably set up and run a small bot unverified, but cannot count on getting verified.

## 5. Alternatives

- **Messenger / Instagram API**, https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy: written for Pages and businesses. Automated bots must answer "within 30 seconds"; disclose a bot where law requires; hybrid bots can hand to humans. The text read does not address general-purpose AI, so no ban found, and it does not say whether individuals without a Page may use it. Read the full Developer Policies (https://developers.facebook.com/devpolicy). Poor reach for family use compared with WhatsApp.
- **Official WhatsApp route for a personal/general assistant:** none found. The only sanctioned general-AI path is the country exception (Italy, EU/EEA, Brazil, Turkiye), which is for AI Providers, not a household.
- **Meta Business Agent** is Meta's own business-support AI, not a personal assistant.
- Practical: Telegram Bot API, Signal, Matrix or an own web/PWA chat carry no such restriction.

## Open items to verify before committing

1. Live wording of 4.7 and the country list (Turkiye date conflict).
2. USD rate card for the admin's market; whether the 1,000 free service tier still applies after 1 Oct 2026.
3. Display-name criteria and whether a non-company can pass business verification.
4. A newer WhatsApp Terms of Service version than the January 2021 copy fetched.
5. If WhatsApp matters, ask Meta/WhatsApp support in writing whether a self-hosted personal assistant counts as an AI Provider.

## Sources

Primary: Meta Terms for WhatsApp Business Platform (above); https://whatsappbusiness.com/policy/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ; .../pricing/non-template-messages.md ; .../pricing/ai-providers ; .../messaging-limits ; .../business-phone-numbers/phone-numbers ; .../webhooks/create-webhook-endpoint ; https://www.whatsapp.com/legal/terms-of-service ; https://faq.whatsapp.com/1217634902127718/ ; https://faq.whatsapp.com/723378546580115 ; https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy

Secondary **[S]**: TechCrunch 18 Oct 2025 (above); SleekFlow business-verification guide (above); eesel and SleekFlow rate summaries (not relied on).
