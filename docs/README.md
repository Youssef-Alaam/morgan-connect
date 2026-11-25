# Morgan Connect: Docs

Morgan Connect is a self-hosted, open-source (Apache 2.0) personal AI agent for many users per install, modelled on n8n Labs' Nod. It is being built in public, following Matt Pocock's five steps: grill, spec, tickets, implement, review.

**Status:** pre-release. Grill and spec are done, tickets for M0 and M1 are drafted; no code yet.

## Start here
| File | What it is |
|---|---|
| [spec.md](spec.md) | The spec: problem, solution, user stories, decisions, architecture, milestones M0-M9, testing |
| [grill-log.md](grill-log.md) | Every decision, numbered. The source of truth |
| [review-2026-11-24.md](review-2026-11-24.md) | Review of the decisions before the spec: contradictions, gaps, risks |
| [STANDARDS.md](STANDARDS.md) | Coding standards: every rule with the machine check that enforces it (draft) |
| [GLOSSARY.md](GLOSSARY.md) | One meaning per word |
| [adr/](adr/) | Short records of the hard-to-reverse decisions |

## Background
| File | What it is |
|---|---|
| [architecture/system-design-layers.md](architecture/system-design-layers.md) | The system in 13 layers, in plain words (written mid-grill; the spec wins where they differ) |
| [architecture/fork-vs-build.md](architecture/fork-vs-build.md) | Fork Nod or build our own: the measured numbers |
| [architecture/loop-engine.md](architecture/loop-engine.md) | Comparison of agent loop engines |
| [research/subscription-terms-frontier.md](research/subscription-terms-frontier.md) | Which AI subscriptions may legally be used in a third-party agent (Anthropic, OpenAI, Google, Cursor, GitHub) |
| [research/subscription-terms-others.md](research/subscription-terms-others.md) | The same for ten more providers |
| [research/whatsapp-business-terms.md](research/whatsapp-business-terms.md) | Whether a personal assistant may run on WhatsApp |
| [research/composio-terms.md](research/composio-terms.md) | Composio's terms, price and data handling for a user's own key |
| [research/sdk-tool-interception.md](research/sdk-tool-interception.md) | Whether each agent SDK lets a safety layer gate every tool call |
| [research/chatgpt-sign-in.md](research/chatgpt-sign-in.md) | Sign in with ChatGPT for open-source apps (unverified) |
| [research/name-check.md](research/name-check.md) | Is the name free |
| [tickets/m0-m1.md](tickets/m0-m1.md) | Tickets for the first two milestones (draft) |

Some of these files cite "doc 01-19" or `nod-reference/`: feature-by-feature notes on Nod's internals that are not published yet.

The research files record terms as read on 2026-11-24. Terms change; re-read the live pages before relying on any of it.
