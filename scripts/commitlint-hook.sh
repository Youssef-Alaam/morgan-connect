#!/bin/sh
# Lint the message being committed; works in worktrees and in paths with spaces.
exec npx --no-install commitlint --edit "$(git rev-parse --git-path COMMIT_EDITMSG)"
