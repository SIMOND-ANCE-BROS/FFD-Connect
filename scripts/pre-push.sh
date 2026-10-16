#!/bin/sh
# pre-push.sh — local safety net run by .githooks/pre-push (#254, #495).
#
# CI is the authority (full typecheck, lint, unit + integration + e2e on a real
# DB). This hook catches the obvious before a push, cheaply enough that nobody
# is tempted to bypass it:
#   1. A push that only deletes refs (`git push origin --delete x`) runs nothing.
#   2. `pnpm typecheck` always runs in full (fast, stable).
#   3. Jest, backend then client, runs only the suites IMPACTED by the push
#      (`jest --findRelatedTests` on the files changed since the merge-base with
#      origin/develop). An app falls back to its FULL suite when the diff touches
#      something the module graph cannot see (package/lockfile, jest/babel/
#      tsconfig, shared packages, mocks, Prisma schema, API contract, a deleted
#      file), when origin/develop is unknown, or when PRE_PUSH_FULL=1. An app
#      with no change at all is skipped.
#   4. Jest runs with --no-watchman (a stuck watchman daemon re-crawling the
#      repo made jest hang at 0% CPU) and a worker cap (PRE_PUSH_MAX_WORKERS,
#      default 50%).
#   5. A failing suite is re-run ONCE, alone and in band. Failing again = real
#      failure: the push is blocked. Passing on retry = load flake: the push
#      goes through and the suite is named so it can be reported on #254. If
#      jest fails without naming a failing suite (crash, config error), there
#      is no retry: the push is blocked.
#
# Never bypass it with --no-verify: fix the failure, or run `pnpm preflight`.
# Package scripts (`pnpm test`, `pnpm test:ci`) and CI are unchanged.

set -u

ZERO_SHA=0000000000000000000000000000000000000000
BASE_REF=${PRE_PUSH_BASE_REF:-origin/develop}
MAX_WORKERS=${PRE_PUSH_MAX_WORKERS:-50%}
# Above this many changed files in one app, run its full suite instead.
MAX_RELATED=${PRE_PUSH_MAX_RELATED:-150}

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$REPO_ROOT" || exit 1

TMP_ROOT=${TMPDIR:-/tmp}
WORK_DIR=$(mktemp -d "${TMP_ROOT%/}/ffd-pre-push.XXXXXX") || exit 1
CHANGED="$WORK_DIR/changed.txt"
: >"$CHANGED"
: >"$WORK_DIR/backend-files.txt"
: >"$WORK_DIR/client-files.txt"

say() { printf '\n[pre-push] %s\n' "$*"; }
now() { date +%s; }

# --- 1. Refs being pushed (stdin: <local ref> <local sha> <remote ref> <remote sha>)
PUSHED_SHAS=""
SAW_LINE=0
if [ ! -t 0 ]; then
  while read -r _local_ref local_sha _remote_ref _remote_sha; do
    [ -n "${local_sha:-}" ] || continue
    SAW_LINE=1
    [ "$local_sha" = "$ZERO_SHA" ] && continue
    PUSHED_SHAS="$PUSHED_SHAS $local_sha"
  done
fi

if [ "$SAW_LINE" = 1 ] && [ -z "$PUSHED_SHAS" ]; then
  say "Push only deletes refs: nothing to check."
  rm -rf "$WORK_DIR"
  exit 0
fi
# Run by hand (no stdin): check what HEAD would push.
[ -n "$PUSHED_SHAS" ] || PUSHED_SHAS=$(git rev-parse HEAD)

# --- 2. Per-app mode: none / impacted / full
BACKEND_MODE=none
CLIENT_MODE=none
BACKEND_REASON=""
CLIENT_REASON=""

# set_full <app> <reason>: the app runs its full suite (first reason wins).
set_full() {
  if [ "$1" = backend ]; then
    [ "$BACKEND_MODE" = full ] || BACKEND_REASON=$2
    BACKEND_MODE=full
  else
    [ "$CLIENT_MODE" = full ] || CLIENT_REASON=$2
    CLIENT_MODE=full
  fi
}

get_mode() {
  if [ "$1" = backend ]; then echo "$BACKEND_MODE"; else echo "$CLIENT_MODE"; fi
}

# add_changed <app> <repo path>: a changed file of the app.
add_changed() {
  if [ ! -e "$2" ]; then
    # Deleted (or renamed away): what imported it is no longer in the graph.
    set_full "$1" "file deleted: $2"
    return
  fi
  if [ "$(get_mode "$1")" = none ]; then
    if [ "$1" = backend ]; then BACKEND_MODE=impacted; else CLIENT_MODE=impacted; fi
  fi
  # Paths relative to the app: pnpm --filter runs jest from apps/<app>.
  printf '%s\n' "${2#apps/"$1"/}" >>"$WORK_DIR/$1-files.txt"
}

if [ "${PRE_PUSH_FULL:-0}" = 1 ]; then
  set_full backend "PRE_PUSH_FULL=1"
  set_full client "PRE_PUSH_FULL=1"
elif ! git rev-parse --verify -q "$BASE_REF^{commit}" >/dev/null; then
  set_full backend "$BASE_REF not found (git fetch origin develop)"
  set_full client "$BASE_REF not found (git fetch origin develop)"
else
  for sha in $PUSHED_SHAS; do
    if ! base=$(git merge-base "$BASE_REF" "$sha" 2>/dev/null); then
      set_full backend "no merge-base between $sha and $BASE_REF"
      set_full client "no merge-base between $sha and $BASE_REF"
      break
    fi
    # --no-renames: a rename lists both the old and the new path.
    git diff --name-only --no-renames "$base" "$sha" >>"$CHANGED"
  done
  # Jest runs on the work tree: include uncommitted tracked changes too.
  git diff --name-only --no-renames HEAD >>"$CHANGED"
  sort -u -o "$CHANGED" "$CHANGED"

  while IFS= read -r f; do
    case "$f" in
      # Workspace-wide inputs: install, toolchain, shared packages, this hook.
      package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .npmrc | .nvmrc | \
        tsconfig*.json | patches/* | packages/* | .githooks/* | scripts/pre-push.sh)
        set_full backend "workspace file changed: $f"
        set_full client "workspace file changed: $f"
        ;;
      # The client's API SDK is generated from it at install time (gitignored).
      apps/backend/swagger.json)
        set_full client "API contract changed: $f"
        ;;
      # Backend inputs the module graph does not see.
      apps/backend/package.json | apps/backend/jest.* | apps/backend/tsconfig*.json | \
        apps/backend/prisma/schema/* | apps/backend/__mocks__/* | apps/backend/*/__mocks__/*)
        set_full backend "backend config or mock changed: $f"
        ;;
      apps/backend/*) add_changed backend "$f" ;;
      # Client inputs the module graph does not see (setup files, preset, mocks).
      apps/client/package.json | apps/client/jest.* | apps/client/babel.config.js | \
        apps/client/tsconfig*.json | apps/client/app.config.js | \
        apps/client/__mocks__/* | apps/client/*/__mocks__/* | \
        apps/client/src/mocks/* | apps/client/src/__tests__/mocks/*)
        set_full client "client config or mock changed: $f"
        ;;
      apps/client/*) add_changed client "$f" ;;
    esac
  done <"$CHANGED"

  for app in backend client; do
    if [ "$(get_mode "$app")" = impacted ] &&
      [ "$(wc -l <"$WORK_DIR/$app-files.txt")" -gt "$MAX_RELATED" ]; then
      set_full "$app" "more than $MAX_RELATED changed files"
    fi
  done
fi

# --- 3. Steps: output kept in a log, readable summary on failure
FAILED=""
FLAKY=""

# run_jest <app> <mode> <log>
run_jest() {
  if [ "$2" = full ]; then
    pnpm --filter "$1" exec jest --silent --no-watchman --maxWorkers="$MAX_WORKERS" \
      --passWithNoTests >"$3" 2>&1
  else
    # shellcheck disable=SC2046 # one path per line, no spaces in repo paths
    pnpm --filter "$1" exec jest --silent --no-watchman --maxWorkers="$MAX_WORKERS" \
      --passWithNoTests --findRelatedTests $(cat "$WORK_DIR/$1-files.txt") >"$3" 2>&1
  fi
}

# Test files jest reported as failed, relative to the app. A FAIL line may end
# with the duration ("(12.3 s)"): keep the path field only.
failed_suites() {
  grep -E '^FAIL ' "$1" |
    awk '{ for (i = 2; i <= NF; i++) if ($i ~ /\.[cm]?[jt]sx?$/) print $i }' | sort -u
}

print_failure() {
  echo "---- failing tests ------------------------------------------------"
  grep -E '^(FAIL |  ● |Tests: |Test Suites: )' "$1" | grep -v '● Console' | head -60
  echo "---- last lines of the log ----------------------------------------"
  grep -v -e '^npm warn' -e '^undefined$' "$1" | tail -n 25
  echo "-------------------------------------------------------------------"
  echo "Full log: $1"
}

test_app() {
  app=$1
  mode=$2
  reason=$3
  if [ "$mode" = none ]; then
    say "$app: nothing changed in apps/$app, tests skipped (CI runs them all)."
    return 0
  fi
  if [ "$mode" = full ]; then
    say "$app: FULL unit suite ($reason)"
  else
    n=$(wc -l <"$WORK_DIR/$app-files.txt" | tr -d ' ')
    say "$app: suites impacted by $n changed file(s) vs $BASE_REF"
  fi
  log="$WORK_DIR/$app-jest.log"
  t0=$(now)
  if run_jest "$app" "$mode" "$log"; then
    grep -E '^(Tests: |Test Suites: )' "$log"
    grep -q '^No tests found' "$log" && echo "(no suite depends on the changed files)"
    echo "$app: OK in $(($(now) - t0))s"
    return 0
  fi

  suites=$(failed_suites "$log")
  if [ -z "$suites" ]; then
    echo "$app: jest failed without reporting a failing suite (crash or config error)."
    print_failure "$log"
    FAILED="$FAILED $app"
    return 1
  fi

  echo "$app: failing suite(s) after $(($(now) - t0))s:"
  echo "$suites" | sed 's/^/  - /'
  echo "Re-running them once, in band, to tell a regression from a load flake..."
  retry_log="$WORK_DIR/$app-jest-retry.log"
  # shellcheck disable=SC2086 # one path per line, no spaces in repo paths
  if pnpm --filter "$app" exec jest --silent --no-watchman --runInBand \
    --runTestsByPath $suites >"$retry_log" 2>&1; then
    echo "$app: passed on retry, flaky under load (not a regression)."
    FLAKY="$FLAKY $(echo "$suites" | sed "s|^|apps/$app/|" | tr '\n' ' ')"
    return 0
  fi
  echo "$app: still failing on retry."
  print_failure "$retry_log"
  FAILED="$FAILED $app"
  return 1
}

T_START=$(now)

say "Typecheck (backend + client + admin)"
t0=$(now)
if pnpm typecheck >"$WORK_DIR/typecheck.log" 2>&1; then
  echo "typecheck: OK in $(($(now) - t0))s"
else
  echo "typecheck: FAILED"
  grep -E 'error TS' "$WORK_DIR/typecheck.log" | head -40
  echo "Full log: $WORK_DIR/typecheck.log"
  FAILED="$FAILED typecheck"
fi

test_app backend "$BACKEND_MODE" "$BACKEND_REASON"
test_app client "$CLIENT_MODE" "$CLIENT_REASON"

ELAPSED=$(($(now) - T_START))

if [ -n "$FLAKY" ]; then
  say "WARNING: passed only on retry (load flake). Report them on issue #254:"
  for s in $FLAKY; do echo "  - $s"; done
fi

if [ -n "$FAILED" ]; then
  say "BLOCKED after ${ELAPSED}s, failing:$FAILED"
  echo "Fix the failure above (logs kept in $WORK_DIR). CI would fail on it too."
  echo "Full local run: PRE_PUSH_FULL=1 git push, or pnpm preflight."
  exit 1
fi

say "OK in ${ELAPSED}s (CI runs the full suites)."
rm -rf "$WORK_DIR"
exit 0
