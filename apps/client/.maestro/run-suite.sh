#!/usr/bin/env bash
#
# Reliable Maestro suite runner for the iOS 26 simulator.
#
# Why this exists: on the iOS 26 simulator, Maestro's per-flow `clearState` and
# XCUITest driver startup are intermittently flaky — a cold boot occasionally
# outruns the CGU-gate wait, or `clearState` fails ("Unable to clear state"),
# which cascades into false "login-email-input not visible" failures. The flows
# themselves are correct; the harness is the flaky part.
#
# Strategy — escalating recovery, empirically derived:
#   - attempt 1: terminate the app, run.
#   - attempt 2: if the failure signature is harness flakiness (clearState error,
#     CGU/login-timeout, XCUITest driver timeout) → full sim reboot + warm-up
#     first; otherwise just terminate + settle.
#   - attempt 3: always reboot + warm-up (a fresh sim reliably restores logins
#     that fail 3x in a row on a degraded one).
#   - proactively reboot + warm-up every REBOOT_EVERY flows (default 10): the
#     sim degrades as cold boots accumulate over a long run.
#
# Prereqs (see README.md):
#   - Backend + seed:e2e profiles running (localhost:3000)
#   - Standalone Release build installed, BUILT WITH EXPO_PUBLIC_DISABLE_SENTRY=1
#     (Sentry hangs the cold boot on the iOS 26 simulator)
#   - JAVA_HOME set to the Android Studio JBR
#
# Usage:
#   ./run-suite.sh                        # all feature flows, 3 attempts each
#   ./run-suite.sh licensee-library       # a single flow (basename, no .yaml)
#   ATTEMPTS=2 REBOOT_EVERY=8 ./run-suite.sh   # tune retries / proactive reboot
set -uo pipefail

cd "$(dirname "$0")/.." # apps/client
: "${JAVA_HOME:=/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_HOME
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}"
# Trim per-invocation overhead (network round-trips on every `maestro test`).
export MAESTRO_DISABLE_UPDATE_CHECK=true
export MAESTRO_CLI_NO_ANALYTICS=true
UDID="${UDID:-$(xcrun simctl list devices booted | grep -oE '[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}' | head -1)}"
APP="${APP:-fr.ffdanse.connect}"
ATTEMPTS="${ATTEMPTS:-3}"
REBOOT_EVERY="${REBOOT_EVERY:-10}"
# Hard cap per maestro invocation: on 2.7.0 a half-dead XCTest driver can make
# maestro throw ("Request for isScreenStatic failed, code: 500") WITHOUT exiting,
# which would stall the suite forever. SIGALRM survives exec, so perl's alarm
# kills the hung invocation (exit 142) and the recovery path takes over.
INVOCATION_TIMEOUT="${INVOCATION_TIMEOUT:-600}"

run_with_timeout() {
  local secs="$1"
  shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
}

if [ "$#" -gt 0 ]; then
  FLOWS=()
  for a in "$@"; do [ -f "$a" ] && FLOWS+=("$a") || FLOWS+=(".maestro/$a.yaml"); done
else
  FLOWS=(.maestro/auth-*.yaml .maestro/licensee-*.yaml .maestro/club-*.yaml .maestro/staff-*.yaml .maestro/admin-*.yaml)
fi

# Maestro 2.7.0 writes per-step screenshots + hierarchies on every failure — a
# long run can dump gigabytes and fill the disk (which then fails EVERYTHING
# with "No space left on device"). Purge artifacts older than a day up front.
find ~/.maestro/tests -mindepth 1 -maxdepth 1 -type d -mtime +1 -exec rm -rf {} + 2>/dev/null

# The suite needs the local backend (seeded logins). Fail fast with a clear
# message instead of 24 identical login failures.
if ! curl -sS -m 5 http://localhost:3000/api/v1 >/dev/null 2>&1; then
  echo "FATAL: backend not reachable on localhost:3000 — start it first:" >&2
  echo "  docker compose --profile infra up -d && pnpm --filter backend start:dev && pnpm --filter backend seed:e2e" >&2
  exit 2
fi

# Full sim reboot + a throwaway app launch. The warm-up absorbs the pathologically
# slow first cold boot after a boot, so the next real flow's CGU wait succeeds.
reboot_and_warmup() {
  echo "  [recover] rebooting simulator + warm-up..."
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1
  sleep 3
  xcrun simctl boot "$UDID" >/dev/null 2>&1
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1
  sleep 6
  xcrun simctl launch "$UDID" "$APP" >/dev/null 2>&1
  sleep 14
  xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1
  sleep 2
  flows_since_reboot=0
}

# Harness-flakiness signatures (vs a genuine assertion failure in the app):
# clearState failure, CGU/login timeout, session-reuse marker timeout (the
# ensure-* preambles wait on role tab markers), XCUITest driver not ready.
# These are the fingerprints of the iOS 26 sim input-pipeline wedge.
is_harness_flake() {
  grep -qE "Unable to clear state|Assertion 'id: (cgu-accept-button|login-email-input|login-register-link|tab-(license|club|scanner|library))[^']*' failed|iOS driver not ready|Failed to connect to /127.0.0.1:7001|isScreenStatic failed|UnknownFailure|RUNNER-TIMEOUT" "$1"
}

pass=0
fail=0
failed_names=()
flows_since_reboot=0
for f in "${FLOWS[@]}"; do
  name="$(basename "$f" .yaml)"
  log="/tmp/maestro-$name.log"
  ok=0
  if [ "$flows_since_reboot" -ge "$REBOOT_EVERY" ]; then
    reboot_and_warmup
  fi
  for a in $(seq 1 "$ATTEMPTS"); do
    if [ "$a" -ge 3 ]; then
      reboot_and_warmup # last resort: always run the final attempt on a fresh sim
    elif [ "$a" -eq 2 ] && is_harness_flake "$log"; then
      reboot_and_warmup # the failure smells like the harness, not the flow
    fi
    xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1
    sleep 2
    # --no-reinstall-driver (Maestro >= 2.1.0): keep the XCTest runner alive
    # across per-file invocations — the first file pays full driver startup, the
    # rest skip it (~10-25s each). After a sim reboot the liveness probe fails
    # and the driver reinstalls automatically, so this composes with recovery.
    if run_with_timeout "$INVOCATION_TIMEOUT" maestro test --no-reinstall-driver "$f" >"$log" 2>&1; then
      echo "PASS  $name (attempt $a)"
      ok=1
      pass=$((pass + 1))
      break
    fi
    rc=$?
    if [ "$rc" -ge 128 ]; then
      # Killed by the watchdog (hung invocation) — mark it so the recovery path
      # treats it as harness sickness and reboots the sim (kills the sick driver).
      echo "RUNNER-TIMEOUT: invocation killed after ${INVOCATION_TIMEOUT}s (signal $((rc - 128)))" >>"$log"
    fi
  done
  flows_since_reboot=$((flows_since_reboot + 1))
  if [ "$ok" -eq 0 ]; then
    # The real failure is Maestro's "Assertion '...' failed." line (or a crash/
    # clearState error). Optional steps log "Warning: ... not found" — exclude
    # those so the reason isn't a misleading warning from an earlier optional tap.
    reason="$(grep -oE "Assertion '[^']*' failed|Unable to clear state.*|CRASH.*|[A-Za-z]*Exception.*" "$log" | grep -v -i warning | head -1)"
    [ -z "$reason" ] && reason="(see $log)"
    echo "FAIL  $name (after $ATTEMPTS attempts): $reason"
    fail=$((fail + 1))
    failed_names+=("$name")
  fi
done

echo "===== DONE: $pass passed, $fail failed ====="
[ "$fail" -gt 0 ] && printf 'failed: %s\n' "${failed_names[*]}"
exit "$fail"
