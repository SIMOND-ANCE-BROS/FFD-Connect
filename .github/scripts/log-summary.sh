#!/bin/sh
# =============================================================================
# log-summary.sh — summarise backend / migration logs WITHOUT printing them
# (#774)
# =============================================================================
#
# The repository is public: Actions logs are readable by anyone for 90 days.
# Backend and Prisma logs can carry personal data (row values in PostgreSQL
# errors, emails, tokens, licence numbers...). Sanitising free text proved
# unreliable, so this script prints NO text from the logs at all. It reads
# them on stdin and prints only:
#
#   - line counts (total, error level);
#   - error codes, each extracted with an anchored pattern and printed in a
#     fixed shape: Prisma `P` + 4 digits, SQLSTATE (5 characters, only right
#     after the literal `SQLSTATE`, `code:` or `SqlState(`), HTTP status
#     classes with a count (`5xx: 3`);
#   - a fixed hint naming the runbook (argument, default deploiement-azure.md)
#     for reading the full logs locally.
#
# Every output token is built from a closed alphabet (digits, A-Z, the fixed
# French labels), so nothing a log line contains can be echoed, whatever it
# looks like.
#
# Usage:  <command> | sh .github/scripts/log-summary.sh [docs/exploitation/<runbook>.md]
# Test:   sh .github/scripts/log-summary.test.sh
# =============================================================================
set -eu

# Runbook named in the hint: a constant from the caller, never log content.
RUNBOOK=${1:-docs/exploitation/deploiement-azure.md}
case "$RUNBOOK" in
  docs/exploitation/*.md) ;;
  *) echo "usage: $0 [docs/exploitation/<runbook>.md]" >&2; exit 2 ;;
esac
if printf '%s' "$RUNBOOK" | grep -qvE '^docs/exploitation/[a-z0-9-]+\.md$'; then
  echo "usage: $0 [docs/exploitation/<runbook>.md]" >&2
  exit 2
fi

IN=$(mktemp)
trap 'rm -f "$IN"' EXIT
cat >"$IN"

TOTAL=$(wc -l <"$IN" | tr -d ' ')
ERRORS=$(grep -cE '(ERROR|FATAL|Error:|"level" *: *("error"|"fatal"|50|60))' "$IN" || true)

# Prisma error codes: P + exactly 4 digits, as a whole token.
PRISMA=$(grep -oE '(^|[^A-Za-z0-9])P[0-9]{4}([^A-Za-z0-9]|$)' "$IN" |
  grep -oE 'P[0-9]{4}' | sort -u | tr '\n' ' ' || true)

# SQLSTATE: only right after a literal marker, 5 characters [0-9A-Z].
SQLSTATE=$(grep -oE '(SQLSTATE[ :=]*|code: |SqlState\(E?)[0-9][0-9A-Z]{4}([^0-9A-Za-z]|$)' "$IN" |
  sed -E 's/^(SQLSTATE[ :=]*|code: |SqlState\(E?)//' | grep -oE '^[0-9][0-9A-Z]{4}' |
  sort -u | tr '\n' ' ' || true)

# HTTP status classes after a method + path: counted, never the path.
HTTP=$(grep -oE '(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) +/[^ ]* +[1-5][0-9]{2}([^0-9]|$)' "$IN" |
  grep -oE ' [1-5][0-9]{2}([^0-9]|$)' | grep -oE '^ [1-5]' | tr -d ' ' |
  sort | uniq -c | awk '{ printf "%sxx: %d  ", $2, $1 }' || true)

echo "Lignes de journal : ${TOTAL} au total, ${ERRORS} de niveau erreur"
echo "Codes Prisma : ${PRISMA:-aucun}"
echo "Codes SQLSTATE : ${SQLSTATE:-aucun}"
echo "Statuts HTTP : ${HTTP:-aucun}"
echo "Journaux complets : voir ${RUNBOOK} (lecture locale via az)"
