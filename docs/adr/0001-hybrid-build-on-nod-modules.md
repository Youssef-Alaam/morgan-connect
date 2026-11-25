# Our own core, with Nod modules lifted in

On 24 Nov 2026 the owner decided to build Morgan Connect's core himself (turns, users, policy, router, channels) and lift self-contained modules from n8n Labs' Nod (Apache 2.0) where they are good: the trust-check prompt and quote verification, the schedule engine, the untrusted-content wrapper, the browser integration. Lifted files keep LICENSE and NOTICE and mark their changes. Nod's upstream is reviewed monthly and wanted improvements are ported by hand (grill decision 4).

## Considered Options

- Fork Nod: every feature on day one, but ~180k lines to own, a single-owner design to undo, and upstream moving ~30 commits a day makes merging impractical within weeks.
- Build everything from scratch: fully ours, but the browser, sandbox and safety parts are the slowest to write well.

## Consequences

Licence duties apply only to lifted files. Nod's and n8n's names and logos are never used. The monthly review is a standing chore. Multi-user is designed in, not retrofitted.
