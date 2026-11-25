# Coding Standards

Status: approved by the owner 2026-11-25, as drafted. Proposed additions (token-only lint, screenshot and accessibility tests, the course items, the coverage rule change) are not included and wait for a separate decision.

AI output varies from run to run, so quality comes from deterministic checks that pass or fail, not from instructions. Every rule in this file names the machine check that enforces it; a rule with no check goes in the short reviewer checklist at the end.

Words in this file follow `GLOSSARY.md`. Layers (L0 to L12), speed targets and the retry rule come from `spec.md` sections 5 and 7. Any tool or number marked "(proposed)" is a choice made here, not yet an owner decision. "CI" means the checks GitHub runs on every pull request (PR); a "lint rule" is an automatic code check that fails the build.

## 1. TypeScript

| Rule                                                                                                                                                                                                                                                                                                                                                                    | Why (one plain sentence)                                                                  | Enforced by                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames` (proposed) | The compiler catches whole classes of bugs before any test runs.                          | `tsc --noEmit` in CI; a test reads `tsconfig.json` and fails if a flag is removed                                                                   |
| No `any`, explicit or implicit                                                                                                                                                                                                                                                                                                                                          | `any` switches the type checker off for everything it touches.                            | `@typescript-eslint/no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`, `no-unsafe-argument` |
| No non-null assertions (`value!`)                                                                                                                                                                                                                                                                                                                                       | `!` tells the compiler "trust me", which hides the crash instead of handling it.          | `@typescript-eslint/no-non-null-assertion`                                                                                                          |
| No floating promises: every promise is awaited, returned or passed to a named handler                                                                                                                                                                                                                                                                                   | An unawaited promise fails silently, after the code has moved on.                         | `@typescript-eslint/no-floating-promises`, `no-misused-promises`                                                                                    |
| Every `switch` over a union handles every case, with no `default` that hides a new case                                                                                                                                                                                                                                                                                 | Adding an action type or an event kind must break the build until every place handles it. | `@typescript-eslint/switch-exhaustiveness-check` (`considerDefaultExhaustiveForUnions: false`)                                                      |
| No `@ts-ignore`; `@ts-expect-error` only with a written reason                                                                                                                                                                                                                                                                                                          | Silencing the compiler must be rare and explained.                                        | `@typescript-eslint/ban-ts-comment`                                                                                                                 |
| Data from outside (HTTP bodies, channel messages, engine tool calls, env vars) is parsed by a schema before use (Zod, proposed)                                                                                                                                                                                                                                         | Types only describe our own code; outside data must be checked at runtime.                | ESLint `no-restricted-syntax` bans `as` casts on `JSON.parse` and `req.body`; unit tests per schema                                                 |

## 2. Lint and format

**Toolchain: ESLint (typescript-eslint, type-checked) plus Prettier (proposed).** Why: the rules this project depends on most (floating promises, exhaustive switches, custom import bans) need type-aware linting backed by the real compiler, which typescript-eslint has in full and Biome only partly.

| Rule                                                                              | Why (one plain sentence)                                          | Enforced by                                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Base config `strictTypeChecked` and `stylisticTypeChecked`                        | One well-known strict baseline instead of a hand-picked list.     | `eslint . --max-warnings 0`                                                                       |
| Warnings count as errors                                                          | A warning nobody fixes is noise that hides the next real problem. | `--max-warnings 0`                                                                                |
| Every `eslint-disable` comment states a reason, and unused ones fail              | Agents must not switch a rule off quietly to get green.           | `@eslint-community/eslint-comments/require-description`, `reportUnusedDisableDirectives: "error"` |
| No `console.*`; log through the project logger                                    | Only the logger applies redaction (section 6).                    | `no-console`                                                                                      |
| `eqeqeq`, `no-implicit-coercion`, `@typescript-eslint/strict-boolean-expressions` | Loose comparisons cause bugs that look correct.                   | ESLint                                                                                            |
| Web UI text goes through translation keys, not string literals in JSX (spec L11)  | The UI must be ready for Arabic after v1.0 without a rewrite.     | `eslint-plugin-i18next` `no-literal-string` on `web/` (proposed)                                  |
| Formatting is Prettier's, never argued                                            | Formatting diffs hide real changes in review.                     | `prettier --check .`                                                                              |

## 3. Tests

| Rule                                                                                                                                                                  | Why (one plain sentence)                                                                  | Enforced by                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Test-first per ticket (red, green, refactor): a PR that changes `src/` must also add or change a `*.test.ts`                                                          | A test written after the code tends to test what the code does, not what the ticket asks. | `scripts/check-pr.mjs` in CI (proposed); red-first shown in the reviewer checklist                                 |
| Vitest is the only test runner, with three projects: `unit`, `integration`, `perf`                                                                                    | One runner, one config, one coverage report.                                              | `vitest.config.ts` workspace; CI runs each project                                                                 |
| Integration tests use a real Postgres in a container, never a mocked or in-memory database                                                                            | Row-level security, pg-boss and SQL behaviour only exist in real Postgres.                | Testcontainers (proposed); dependency-cruiser forbids `pg-mem` and similar; lint bans `vi.mock('pg')`              |
| Model calls in tests use the **scripted fake engine** (a model that replays fixed tool calls); channels use fake channel adapters                                     | Tests must be free, repeatable and never depend on a provider being up.                   | dependency-cruiser: `test/**` may not import real engine adapters; CI test jobs have no provider keys              |
| No mocking of the project's own modules; mock only at the edges (network, clock, Docker)                                                                              | A mocked own module tests the mock, not the code.                                         | ESLint `no-restricted-syntax`: `vi.mock` with a path starting `.` or `@/` fails                                    |
| Every table with user data has an isolation test (user A cannot read user B's rows, via the API or under row-level security; the admin read path writes an audit row) | Isolation is the core promise of a multi-user install.                                    | `scripts/check-isolation-tests.mjs` lists tables from migrations and fails if one has no isolation test (proposed) |
| The policy table test covers every (profile preset, action type, device) cell                                                                                         | A new action type with no policy row would default to an unknown behaviour.               | Table test generated from the `ActionType` union; exhaustive switch makes a missing case a compile error           |
| Coverage on changed lines at least 90%; whole project at least 80% lines and branches; `src/policy` and `src/safety` 100% branches (proposed)                         | Untested lines in the safety path are where unsafe actions slip through.                  | Vitest v8 coverage thresholds; `diff-cover` on the PR diff                                                         |
| Tests are deterministic: no real time, randomness or network                                                                                                          | A flaky test teaches everyone to ignore red.                                              | Fake timers and seeded random via test helpers; CI reruns the suite once and fails on any difference (proposed)    |

## 4. Size and complexity limits (all proposed)

| Rule                                                                           | Why (one plain sentence)                                    | Enforced by                                             |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| Max 300 lines per file (blank lines and comments excluded); 500 for test files | Small files fit in one read, for a person and for an agent. | ESLint `max-lines`                                      |
| Max 50 lines per function                                                      | A long function is several functions waiting to be named.   | `max-lines-per-function` (off inside `describe` blocks) |
| Cyclomatic complexity (number of paths through a function) at most 10          | More paths than that cannot be tested one by one.           | ESLint `complexity`                                     |
| Max 4 parameters; more go in one typed object                                  | Long argument lists get passed in the wrong order.          | `max-params`                                            |
| Max nesting depth 3; max nested callbacks 3                                    | Deep nesting hides the main path.                           | `max-depth`, `max-nested-callbacks`                     |

## 5. Dependencies

| Rule                                                                                                                                                                                                         | Why (one plain sentence)                                              | Enforced by                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Allowed licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0 (proposed). MPL-2.0 needs the owner's OK. GPL, LGPL, AGPL, SSPL, BUSL and no licence are refused | Everything shipped must be redistributable under Apache 2.0.          | `license-checker-rseidelsohn --onlyAllow` in CI (proposed); exceptions listed in `licences-allowed.json` with the owner's sign-off |
| Optional closed-source SDKs (the Claude Agent SDK, spec A13) are listed exceptions and never required for an install with only Pi                                                                            | An install must work on open-source parts alone.                      | Exception file above; a CI job builds and runs the smoke test with optional packages removed (proposed)                            |
| A new dependency needs a one-line justification in the PR description                                                                                                                                        | Each dependency is code we did not write and must trust.              | `scripts/check-pr.mjs` fails if `package.json` gains a dependency and the PR body has no `Dependency:` line (proposed)             |
| The lockfile is committed and CI installs from it exactly                                                                                                                                                    | Every machine and every run gets the same versions.                   | `npm ci` fails on a lockfile mismatch (npm proposed)                                                                               |
| No known high or critical vulnerabilities                                                                                                                                                                    | Known holes are the cheapest attack.                                  | `npm audit --audit-level=high`                                                                                                     |
| No unused dependencies, files or exports                                                                                                                                                                     | Dead code and packages still need updating and can still be attacked. | `knip` (proposed)                                                                                                                  |

## 6. Security

| Rule                                                                                                      | Why (one plain sentence)                                            | Enforced by                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No secrets in the repo, including test fixtures that look real                                            | The repo is public from the first commit (D57).                     | `gitleaks` in a pre-commit hook (lefthook, proposed) and in CI over the full history                                                                                                                                            |
| SQL is parametrised only; values never enter SQL by string building                                       | String-built SQL is how SQL injection happens.                      | All SQL lives in `src/data/`; dependency-cruiser forbids importing `pg` elsewhere; ESLint bans template literals with expressions and `+` as the first argument of `query()`                                                    |
| Every query on user data carries `user_id` and `workspace_id`, with row-level security as the second lock | One missed filter would show one person's data to another.          | Isolation tests (section 3); a migration test fails if a user-data table lacks an RLS policy; install-wide tables are listed explicitly                                                                                         |
| Every tool call and model call goes through the single policy function (L2)                               | One gate is the only gate that can be proven complete.              | dependency-cruiser: only `src/policy/` may import tool implementations or engine adapters; an integration test runs each registered tool and checks for its audit row                                                           |
| An engine ships only when every tool call it can make passes L7 or is switched off (engine rule C8)       | Built-in engine tools must not route around the safety layer.       | Safety evals per engine; release gate                                                                                                                                                                                           |
| **Untrusted content** is never concatenated into instructions                                             | Text Morgan read can contain instructions aimed at it.              | Untrusted text has a branded type `Untrusted<string>` that does not convert to `string`; only the untrusted-content wrapper in `src/safety/` may unwrap it (tsc plus dependency-cruiser); safety evals on injected instructions |
| Logs redact credentials, tokens, message bodies and memory text                                           | Logs are copied, shipped and read by more people than the database. | Logger redaction config (pino, proposed); a test logs a fixture full of fake secrets and fails if any appears in the output                                                                                                     |
| An approval binds exact arguments and is used once                                                        | A reused or edited approval is not the user's yes.                  | Safety evals "approval replay with changed arguments"; unit tests on the approval store                                                                                                                                         |

## 7. Architecture boundaries

The spec numbers layers by topic, not by import order, so the import order below is proposed. One folder per layer; a layer may import only layers below it in this list.

| Rank (top imports down) | Folders                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| 1                       | `src/channels` (L4), `src/cadence` (L9), `src/http` (L5 API)                |
| 2                       | `src/core` (L5: turns, job queue workers, event stream)                     |
| 3                       | `src/policy` (L2), which calls `src/safety` (L7)                            |
| 4                       | `src/providers` (L3), `src/tools` (L6): reached only from `src/policy`      |
| 5                       | `src/identity` (L1), `src/data` (L8), `src/ops` (L10: logger, atomic write) |
| separate package        | `web/` (L11) talks to the backend over HTTP only, never by import           |

| Rule                                                                | Why (one plain sentence)                                                   | Enforced by                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Imports go downward only; no cycles                                 | Upward imports turn layers into one tangle that cannot be tested in parts. | dependency-cruiser (`.dependency-cruiser.cjs`, proposed) with `no-circular` and the rank rules above |
| App and worker code is **stateless**: no module-level mutable state | Several copies must be able to run (spec L0).                              | ESLint `no-restricted-syntax` bans top-level `let` in `src/` (proposed)                              |

## 8. Performance

| Rule                                                                                            | Why (one plain sentence)                                | Enforced by                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Morgan's own overhead on a plain chat **turn** is at most 300 ms at the median (C6)             | Replies should feel like texting the CLI (D50).         | `perf` project: 50 turns on the scripted fake engine, fails above the budget                                       |
| Acknowledgement or typing indicator within 1 s on every channel                                 | People need to see that the message arrived.            | `perf` test on each fake channel adapter; real channels timed by hand each milestone                               |
| Trust check at most 1.5 s at the median                                                         | Gated actions must not feel stuck.                      | CI checks our overhead around a fake safety model; the real model is timed by hand each milestone (spec section 7) |
| The trust check runs only for gated action types, never for reads                               | Reads must stay fast and cheap.                         | Unit test counts trust-check calls for every read path: must be zero                                               |
| No premature optimisation: optimise only where a failing budget test or a saved profile says so | Guessed speed-ups add complexity where it buys nothing. | Reviewer checklist; a performance PR links the failing test or profile                                             |

## 9. Errors

| Rule                                                                                                                                                                                            | Why (one plain sentence)                                                              | Enforced by                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Errors are typed: classes with a `kind` field from one union; only `Error` subclasses are thrown                                                                                                | Callers can handle each failure on purpose, and the switch over `kind` is exhaustive. | `@typescript-eslint/only-throw-error`, `useUnknownInCatchVariables`, `switch-exhaustiveness-check`                                 |
| No swallowed catches: every catch rethrows, returns a typed error, or logs and reports                                                                                                          | A swallowed error turns into a wrong answer later.                                    | ESLint `no-empty` (catch included), `@typescript-eslint/no-unused-vars` on catch bindings; reviewer checklist for log-and-continue |
| Retry rule (G3): model calls retry twice, then fall back within the tier, then tell the user; channel sends retry three times; a tool call that changes anything is never retried automatically | Repeating a send, delete or payment can do it twice.                                  | The single retry helper accepts only tools typed `changesState: false` (compile error otherwise); unit tests per rule              |
| Turns carry an idempotency key (G3)                                                                                                                                                             | A job re-run after a crashed worker must not repeat work.                             | Integration test kills a worker mid-turn and checks no action ran twice                                                            |

## 10. Files and writes

| Rule                                                                    | Why (one plain sentence)                                      | Enforced by                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every file write is temp-then-rename through `src/ops/atomic-write.ts`  | A crash mid-write must leave the old file, never half a file. | ESLint `no-restricted-imports`/`no-restricted-properties` ban `writeFile`, `writeFileSync`, `appendFile`, `createWriteStream` outside that module |
| Vault writes are new files only, in agreed zones, one commit each (D28) | No existing note is ever edited.                              | Integration test against a scratch git repo: overwrite and out-of-zone writes fail                                                                |

## 11. Git and pull requests

| Rule                                                                                               | Why (one plain sentence)                        | Enforced by                                                                                       |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| One PR per ticket, at most 400 changed lines excluding lockfile, snapshots and fixtures (proposed) | Small PRs can actually be reviewed.             | `scripts/check-pr.mjs`: ticket id in the PR title, size limit                                     |
| Conventional commit messages (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`)            | A readable history and generated release notes. | `commitlint` in the commit-msg hook and in CI                                                     |
| All CI checks pass before merge                                                                    | Green is the only definition of mergeable.      | GitHub branch protection: required status checks                                                  |
| Only the owner merges to `main` (D57)                                                              | The owner decides what ships.                   | Branch protection: merge restricted to the owner, `CODEOWNERS`, no direct pushes, no force pushes |

## 12. CI pipeline

Runs in this order; the first failure stops the run (commands proposed).

1. Install: `npm ci`
2. Commit messages: `npx commitlint --from origin/main --to HEAD`
3. Secrets: `gitleaks detect --redact`
4. PR shape (ticket id, size, test changed, dependency line): `node scripts/check-pr.mjs`
5. Format: `npx prettier --check .`
6. Lint: `npx eslint . --max-warnings 0`
7. Types: `npx tsc --noEmit`
8. Boundaries: `npx depcruise src web --config .dependency-cruiser.cjs`
9. Unused code and dependencies: `npx knip`
10. Licences: `npx license-checker-rseidelsohn --production --onlyAllow "<allowlist>"`
11. Audit: `npm audit --audit-level=high`
12. Unit tests: `npx vitest run --project unit`
13. Integration tests on real Postgres: `npx vitest run --project integration --coverage`
14. Isolation coverage: `node scripts/check-isolation-tests.mjs`
15. Changed-line coverage: `diff-cover coverage/cobertura-coverage.xml --compare-branch=origin/main --fail-under=90`
16. Speed budgets: `npx vitest run --project perf`
17. From M6, restore test: `npm run test:restore` (restore the latest backup into an empty stack, then smoke test)
18. Release only: safety evals on the holdout set with a hard spend cap, `npm run evals -- --set holdout`; zero unsafe actions (release gate, D39)

## 13. Reviewer checklist (things machines cannot check)

1. The tests were written first: the history shows them failing before the fix, and they test what the ticket asks, not what the code happens to do.
2. Tests assert on outcomes the user would notice, not on internal calls.
3. Names use `GLOSSARY.md` words; a new concept is added to the glossary.
4. The PR does the ticket and nothing more: no speculative abstraction, no unasked optimisation.
5. Any catch that logs and continues is justified in a comment.
6. Diffs to policy, safety, credentials, SQL or row-level security migrations were read line by line.
7. Lifted Nod files keep their licence header and are marked as changed in `NOTICE`.
8. A changed decision has its grill-log entry or ADR updated in the same PR.
