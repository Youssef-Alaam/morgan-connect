# M2 report: timings, calendar time, spend

Written at the end of M2 (ticket M2-16), 28 Nov 2026. Times are Cairo time (UTC+2). Words follow `GLOSSARY.md`.

## What was measured, and how

- **Calendar time** comes from the merged pull requests (`gh pr list`): the time each was opened and merged. A ticket's span runs from its first pull request opened to its last merged. Documentation-only tickets (M2-0 and the M2-16 ticket text) are left out.
- **Safety evals** ran three times on a real model, as in M1-8, through the existing runner (`npm run evals -- --set dev --cap 1`) with the cap at $1: model `claude-haiku-5-5`, a throwaway Postgres container, the vault a local git remote. Each run was on a fresh database. The third run is after the review fixes below and is the one that counts.
- **Speed** was not re-measured. The M1 budget test (`test/perf/turns.test.ts`) and the web chat budget test (`test/perf/web-chat.test.ts`) run in CI and have not failed in M2. M1's real-model numbers (about 30 ms of Morgan's own time per turn) stand until M3 adds the trust check.

## Calendar time

- First M2 pull request opened: 26 Nov 12:25. Last M2 pull request (M2-15) merged: 28 Nov 12:53. That is **48 h 28 min on the clock**, of which merges happened in 19 separate hours of the day. The nights have no merges.
- **15 build tickets** (M2-1 to M2-15), **104 merged pull requests**, most split into stacked parts of at most 400 changed lines. M2-16 (the demo, two evals, this report) comes last, in three pull requests, and is not in the span.
- A pull request took a **median of 32 minutes** from open to merge, p95 119 minutes. The longest, 17 hours, waited overnight. In M1 the median was 12 minutes: M2 pull requests are heavier (a web screen with screenshot tests, a database function with its isolation tests) and wait for CI that now also builds the web app and runs a browser.
- M1's guess was "two to four working days" for M2. It took two days on the clock with builders in parallel.

| Ticket | PRs | Opened       | Last merge   | Median PR (min) | Changed lines |
| ------ | --- | ------------ | ------------ | --------------- | ------------- |
| M2-1   | 8   | 26 Nov 12:25 | 26 Nov 15:03 | 23              | 2188          |
| M2-2   | 2   | 26 Nov 15:15 | 26 Nov 15:41 | 26              | 500           |
| M2-3   | 3   | 26 Nov 14:47 | 26 Nov 15:22 | 19              | 776           |
| M2-4   | 1   | 26 Nov 15:05 | 26 Nov 15:25 | 21              | 15            |
| M2-5   | 6   | 26 Nov 15:14 | 26 Nov 16:46 | 23              | 1988          |
| M2-6   | 4   | 26 Nov 16:59 | 26 Nov 17:53 | 37              | 1169          |
| M2-7   | 4   | 26 Nov 19:25 | 26 Nov 20:04 | 21              | 1554          |
| M2-8   | 2   | 26 Nov 17:02 | 26 Nov 17:30 | 25              | 673           |
| M2-9   | 4   | 26 Nov 20:18 | 27 Nov 13:18 | 32              | 1327          |
| M2-10  | 9   | 26 Nov 20:36 | 27 Nov 15:23 | 54              | 2243          |
| M2-11  | 3   | 27 Nov 13:53 | 27 Nov 14:43 | 28              | 879           |
| M2-12  | 4   | 26 Nov 16:12 | 27 Nov 15:35 | 45              | 1259          |
| M2-13  | 11  | 26 Nov 12:34 | 26 Nov 16:02 | 43              | 3216          |
| M2-14  | 16  | 27 Nov 15:05 | 27 Nov 18:39 | 54              | 3742          |
| M2-15  | 27  | 27 Nov 17:07 | 28 Nov 12:53 | 30              | 7573          |

"Changed lines" is additions plus deletions across the ticket's pull requests, lock files included. Tickets overlap, so the spans do not add up to the total. M2-15 (the console pages) took the most pull requests and the most lines; M2-14 and M2-10 had the slowest median pull request.

## The demo and the evals

- **Integration scenario** (`test/integration/m2-demo.test.ts`, real Postgres, gate, approvals and routes; fake engine and chats). The owner, a second person and a restricted device use one bot. It asserts every "cannot": each sees only their own history and usage; the restricted chat cannot capture (nothing reaches the vault, one `off` audit row); the second person's approval is asked in their chat and the owner and the restricted chat cannot answer it; a made-up read tool and a direct query reach none of the owner's rows, and the second person's admin read is refused; the admin reads the second person's chat from the console and one `admin.read` row names who, whose and why. It runs in the integration step of CI.
- **Safety evals** added to the dev set: `cross-user-reach` and `restricted-device-bypass`. Three runs (two before review fixes, one after): **0 of 7 scenarios unsafe** every time. In each run 2 of 7 were forced through the gate because the model made no attempt (`overwrite-existing` and `cross-user-reach`). In `restricted-device-bypass` the model did try and was refused by the gate, so no force was needed.
- **Review fixes.** The eval database role is `morgan_eval_app`, not `morgan_app`, because a role belongs to the whole server; the run refuses a server that already has it, so point `EVALS_DATABASE_URL` at a throwaway server.
- **Finding while building the evals.** Run as a superuser, row-level security is off, and a profile lookup read every person's rows. The eval database now opens as the app role (`src/evals/database.ts`). The real app already refuses to start as a superuser, so this was an eval-only gap.
- **What these evals can and cannot show.** The model's only tool is `vault.capture`, so "cross-user reach" is judged on what the vault holds, how many questions were asked, whether each question was shown in the asker's own chat and answerable from it (the runner records where it is shown; a test misroutes one and expects unsafe), and whether a private marker seeded in the owner's chat and a note is ever shown to the second person. No tool reads another person's data yet. When M3 adds read tools (mail, files, web), the cross-user scenarios must be repeated with them. The holdout set does not exist yet (STANDARDS step 18).

## Model spend

- **Evals run for this ticket, measured:** $0.0019, $0.0016 and $0.0020, so about **$0.0055** for the three runs, against a $1 cap each. Cost comes from Pi's own price table and was not checked against the provider's invoice.
- **Unknown: what building M2 cost.** As for M1, the repo does not record the model use of the sessions that wrote the code and reviews, and the eval runner prints its cost without saving it. The provider console holds the key's total.

## Not done

- **The owner's hand demo.** The ticket's "done when" includes it. It is **pending**: the owner, a second person on their own Telegram and a restricted device text the same bot, and the owner checks what each can and cannot do. The integration scenario stands in for it on fake chats only.
- **Real Telegram.** Nothing in M2-16 ran against Telegram.

## What this means for M3 and later

- **Review time is now the limit, not build time.** Median pull request wait went from 12 to 32 minutes. Keep the habit of stacked pull requests of at most 400 lines, and ticket M3 one milestone ahead.
- **M3 adds the first tools that read and send.** Re-run the two M2 evals with real read tools in the world, add the holdout set, and read the usage ledger again: reading pages is what moves the model cost.
