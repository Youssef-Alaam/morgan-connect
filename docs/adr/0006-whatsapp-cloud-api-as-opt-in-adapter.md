# WhatsApp is the official Cloud API, shipped as an opt-in adapter

Decided 24 Nov 2026 (grill decisions 40, 55). WhatsApp is reached only through Meta's Cloud API on a dedicated number owned by the install's admin. The adapter is off until the admin switches it on and accepts a notice explaining that Meta's terms bar "AI Providers" whose AI is the primary functionality, that Meta decides this at its own discretion, and that the number and business portfolio can be suspended. Baileys and every other unofficial client are not shipped or documented.

## Considered Options

- Baileys on a personal number: free and easy, but breaks WhatsApp's terms and the ban hits a real phone number.
- No WhatsApp in v1: safest, but it is the owner's main channel.
- WhatsApp on by default with a note: contradicts the terms rule (ADR-0004).

## Consequences

Telegram is the default channel. Messages Morgan starts outside WhatsApp's 24-hour window go out as a generic approved template that the user's reply re-opens. Each admin sets up their own Meta portfolio, number, webhook address and templates, with a guide.
