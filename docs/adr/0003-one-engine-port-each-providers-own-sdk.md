# One engine port; each provider through its own SDK

Decided 24 Nov 2026 (grill decisions 16, 56). Every model provider is reached through the SDK its owner publishes: Pi for generic API keys and the official ChatGPT sign-in, the Claude Agent SDK on an Anthropic API key, Google's SDK on a Gemini key, the Copilot SDK, the Cursor SDK. All sit behind one internal port (`open / prompt / steer / abort / usage`) so approvals, costs and memory are written once. Pi with an Anthropic key is built first; the other four follow.

An engine ships only when every tool call it can make is routed through Morgan's safety layer or switched off, proven by the safety evals for that engine.

## Considered Options

- Vercel AI SDK as the single engine: largest community, but no legal subscription routes and Nod's modules would need adapting.
- Pi alone: fewest paths to test, but it does not cover Copilot's and Cursor's sanctioned routes.

## Consequences

Five adapters must behave the same under the same evals; that is the main testing cost. Some SDKs are agents with their own built-in tools, so an engine may ship as chat-only. The Claude Agent SDK is not open source, so an install with only Pi must work.
