# Contributing

Thank you for your interest. Forks are welcome.

- Only the maintainer merges to `main`.
- Every pull request must pass all CI checks; see [docs/STANDARDS.md](docs/STANDARDS.md). The required checks are `ci` and `pi-only` (an install without optional engine SDKs must build and boot).
- One ticket per pull request, at most 400 changed lines (lockfile excluded), with the ticket id in the title (for example `M1-3: a real model answers`).
- Write the failing test first. A change under `src/` must add or change a test.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).
- A new dependency needs a `Dependency: <name> - <why>` line in the pull request description.
- No secrets, real tokens or personal data anywhere, including test fixtures.

Run `npm run check` before opening a pull request.
