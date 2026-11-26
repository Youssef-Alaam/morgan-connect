# M1 report: timings, calendar time, spend

Written at the end of M1 (ticket M1-9), 26 Nov 2026. All times are milliseconds unless marked. Words follow `GLOSSARY.md`.

## What was measured, and how

- **Budget test (CI).** `test/perf/turns.test.ts`: 50 plain turns through real Postgres, the real job queue and the real pipeline, on the scripted fake engine and a fake channel. Fails above a 300 ms median overhead or a 1 s typing signal.
- **Real model, 20 plain turns.** The real Pi engine with an Anthropic key, model `claude-haiku-5-5`, the whole app wired as `boot.ts` wires it (app role under row-level security, queue, Telegram adapter, gate, usage ledger). The Telegram Bot API was a local stand-in that answers long polls the moment an update arrives, so no network time to Telegram is included. The database was a throwaway Postgres container.
- **5 captures.** A message asking Morgan to save a note, the model calls `vault.capture`, the question with Approve and Deny arrives, a scripted tap approves, the note is pushed to a scratch local git remote standing in for the vault, the model confirms. All five notes landed (checked on the remote).
- **Two complete runs** of the real-model script, so each figure below is shown for both. With 20 turns, p95 is the second-worst turn; with 5 captures it is the worst.
- **Overhead** is the time from the update arriving to the reply being sent, minus the time spent inside the model call. It is Morgan's own part.

## Timings

### Budget test on the fake engine (CI)

| Measure                       | Budget | Result (local run)          |
| ----------------------------- | ------ | --------------------------- |
| Median overhead, 50 turns     | 300    | 21 (p95 25)                 |
| Typing signal (worst of 50)   | 1000   | 27                          |
| Before the queue fix (median) | 300    | 2003, because of a 2 s poll |

The first run of the new test failed at a 2003 ms median. pg-boss checks for jobs every 2 s by default, so each turn waited for the next check. The turn queue now uses Postgres LISTEN/NOTIFY, which wakes the worker the moment a turn is queued. This was the only change to `src`.

### Real model, 20 plain turns (median / p95)

| Measure                         | Run A     | Run B      |
| ------------------------------- | --------- | ---------- |
| Typing signal                   | 15 / 23   | 15 / 24    |
| Morgan's overhead               | 29 / 39   | 30 / 43    |
| Model call (`claude-haiku-5-5`) | 630 / 841 | 647 / 992  |
| Whole turn, message to reply    | 654 / 867 | 671 / 1070 |

Morgan's part is about 30 ms against a 300 ms budget, and 4 to 5 percent of the turn. The model is the rest.

### Real model, 5 captures (median / worst), machine time only

| Measure                                            | Run A       | Run B       |
| -------------------------------------------------- | ----------- | ----------- |
| Message to the Approve and Deny question           | 877 / 1541  | 950 / 1473  |
| Tap on Approve to the final reply                  | 1299 / 1323 | 1351 / 1415 |
| Total, leaving out the time the owner takes to tap | 2182 / 2858 | 2318 / 2691 |

A capture is two model calls (decide to call the tool, then confirm) around one git clone, commit and push. After the tap, about 0.6 to 1 s is the second model call, so the git work on a local remote is roughly half a second.

### Not measured

- **The owner's real bot.** Real Telegram round trips (each send, typing signal and tap crosses the internet) are not in these numbers. The owner's day of use should note how a reply feels, and the typing signal time is the one to check by eye.
- **A real vault on GitHub.** The push went to a local remote. A push over the internet will be slower than the half second above; no number yet.
- **The trust check (1.5 s median budget).** It does not exist until M3.

## Calendar time

From the git history of the merged pull requests (times are Cairo time, UTC+2):

- First commit: 25 Nov 10:03. Last M1-8 merge: 26 Nov 14:18. That is **28 h 15 min on the clock**, of which merging happened in three stretches: 25 Nov 10:03 to 17:07, a short burst at 20:00 to 20:05, and 26 Nov from 12:05. Roughly 12 hours had merges in them.
- **16 tickets** (M0-1 to M0-6, M1-1 to M1-10), **52 merged pull requests**. Most tickets were split into stacked parts of at most 400 changed lines.
- A pull request took a **median of 12 minutes** from open to merge, p95 33 minutes, longest 37.
- M2 work (M2-1, M2-1a, M2-13a) started in parallel on 26 Nov, so M1's clock time is not all M1 effort. M1-9 (this ticket) is not in the span; the owner's day of use comes after it.

## Model spend

- **The product's own model use, measured:** the usage ledger recorded 30 calls per run (20 plain, 10 for the 5 captures): about 110 fresh input tokens, about 1000 output tokens, 43,500 cached-read and 10,900 cached-write tokens. **Cost per run: about $0.0023, so about $0.005 for both runs.** The per-call cost comes from Pi's own price table and was not checked against the provider's invoice; the cap for this job was $1. Cached input made most of the input cheap, because the system prompt and tool list repeat on every call.
- **Unknown: what building M1 cost.** The repo does not record the model use of the sessions that wrote the code and reviews, so there is no honest figure. The eval runner (M1-8) prints its cost to the terminal and does not save it, so the spend of earlier eval runs is also unknown. The owner can read the provider console for the key's total.

## What this means for M2 to M9

- **Speed is not the constraint.** Overhead is about 30 ms against a 300 ms budget, so there is roughly tenfold headroom for M2 (accounts, row-level security) and M3 (trust check around actions). The budget test will catch a regression; do not spend effort tuning before it fails. The one real find was a queue default, which no review would have caught: keep timing through real infrastructure, not only in-process.
- **The model sets what the user feels.** A turn is about 0.65 s on the small model, and a capture is 2 to 3 s plus the owner's tap. A trust check that is one extra model call per gated action would add about 0.6 to 1 s per call at these numbers, which fits the 1.5 s median budget with no room for a second one. Plan M3's safety model around that: one call, a small model, and cached instructions.
- **Cost is small at this scale.** A plain turn on the small model costs a fraction of a cent, and the cache made the repeated part cheap. The budgets and "ask for more" work in M2 is about control and fairness, not about the bill. A larger model, long histories, or tools that read pages (M3 and M4) are what will move the number, so the ledger should be read again after M3.
- **Calendar time.** M0 and M1 took 16 tickets in about a day and a quarter on the clock with several builders in parallel. M2 is drafted as 16 tickets, the same count, but its tickets are heavier (passkeys, TOTP, web screens), so a fair guess is **two to four working days** for M2 if the owner's merge speed holds. M3 to M9 have no tickets yet, so no honest number; ticket them one milestone ahead, as M2 was. Merge speed is the limit: the median pull request waited 12 minutes.
- **Keep the habit that worked:** stacked pull requests of at most 400 lines, tests first, and a measured number in the pull request when a budget moves.
