# Built in public from the first commit; only the owner merges to main

On 24 Nov 2026 the owner decided the project is a public journey: the GitHub repo is public from the start, anyone may fork it, and he alone decides what lands on `main` (grill decision 57).

## Considered Options

- Private until a finished v1.0: a cleaner first impression, but nothing to show for months.
- Public preview only once the safety layer exists: safer for early users, but loses the "from day one" story.

## Consequences

`main` is protected (owner-only merge, required checks) and the repo carries SECURITY.md from day one. Until the release gate first passes, the README says plainly that the build must not be exposed to the internet. No secret, real token, private vault path or client detail may ever be committed, so the existing docs are scrubbed before they are published. Issues and pull requests from strangers become part of the workload.
