# Composio: terms, price and data handling for a user's own key

Checked 2026-11-24. Lookup by Gemini; the lines marked **[read]** were then read on the live page by the reviewer. Everything else is as reported by the lookup and must be re-read before the Composio path ships (M4). Not legal advice.

Use case checked: each user of a self-hosted install creates their own Composio account and pastes their own key; the project hosts nothing.

## Verdict: allowed as far as the terms go, with a real privacy cost on the free plan

| Question                                                                     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do the terms forbid a user's own key inside a third-party self-hosted agent? | **No clause found either way.** The licence covers "both personal and commercial purposes" **[read]**, and excludes "resale or commercial use of the platform or its contents" **[read]**. A user using their own account for themselves is not resale. A separate Fair Usage Policy is referenced **[read]** but its text was not found                                                                               |
| Is tool-call content stored?                                                 | **Yes, by default.** Payload data (the inputs and outputs of tool calls, so email bodies and file contents) "is retained for up to one year and then automatically deleted" **[read]**                                                                                                                                                                                                                                 |
| Can storage be switched off?                                                 | Zero data retention exists but is **not included on the free plan** **[read]**; it is on the paid plan                                                                                                                                                                                                                                                                                                                 |
| Are sign-in tokens held by Composio?                                         | Yes, encrypted at rest (as reported)                                                                                                                                                                                                                                                                                                                                                                                   |
| Is content used to train models?                                             | Reported no, on any plan                                                                                                                                                                                                                                                                                                                                                                                               |
| Google apps without the user's own Google Cloud project?                     | Reported yes: Composio's own verified Google sign-in covers Gmail, Calendar and Drive, including Gmail's restricted scopes                                                                                                                                                                                                                                                                                             |
| Price                                                                        | **Two price lists disagree.** The pricing page read today shows Free at 10,000 tool calls a month and Standard at $18 per seat a month **[read]**, and points developers using the SDK to a separate "Platform pricing" page. The lookup reported different developer figures (free 100,000 calls a month of which 20,000 on Composio's own app sign-ins; a $29 paid plan). Confirm on the platform pricing page at M4 |

## What this means for the product

1. The Composio path can ship under the terms rule as "no known breach". Each user must use their own account for their own use, which is already decision 18.
2. The choice screen's wording (decision 58) must be stronger than "data passes through Composio". On the free plan the honest line is: **"Composio keeps a copy of what your tools read and send for up to one year."** The private path's advantage is larger than the grill assumed.
3. The setup guide should tell users who stay on Composio how to turn on zero data retention if they pay for it.

## Still unverified

- The Fair Usage Policy text and the full "Restrictions on Use" section.
- Whether Composio staff can read stored payloads.
- The developer (platform) price list and free allowance.
