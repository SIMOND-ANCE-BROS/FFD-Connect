#!/bin/sh
# install-git-hooks.sh — root `prepare` script (#623), run by `pnpm install`.
#
# Points git at the versioned hooks: core.hooksPath = .githooks (RELATIVE).
# core.hooksPath lives in the .git/config shared by every worktree; a relative
# value is resolved against the work tree running the hook, so each worktree
# runs its own .githooks/*, present as soon as the branch is checked out. The
# hooks refuse to run (loudly) until `pnpm install` has been done there.
#
# Never fails the install: skipped with HUSKY=0, in CI, without git or outside
# a git work tree (Docker build, EAS archive); a git error is only reported.
set -u

if [ "${HUSKY-}" = "0" ] || [ -n "${CI-}" ]; then
  exit 0
fi
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

current=$(git config --get core.hooksPath || true)
[ "$current" = ".githooks" ] && exit 0

if git config core.hooksPath .githooks; then
  echo "git hooks: core.hooksPath=.githooks (was: ${current:-unset})"
else
  echo "git hooks: could not set core.hooksPath=.githooks — run it by hand" >&2
fi
exit 0
