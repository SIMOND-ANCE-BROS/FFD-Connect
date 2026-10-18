#!/bin/sh
# Tests for log-summary.sh (#774). Run: sh .github/scripts/log-summary.test.sh
#
# For every sample (and for all of them at once), the output must consist of
# exactly the five fixed-shape lines below: counts, codes from a closed
# alphabet, the fixed hint. No other character sequence from the logs may
# appear. Samples cover a unique violation, a NOT NULL failing row, a Prisma
# P3018 with its DB error, a JSON log with email / message / stack, a stack
# trace, and lines crafted to look like safe lines (or codes) while carrying
# personal data.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

cat >"$W/all" <<'EOF'
ERROR: duplicate key value violates unique constraint "User_email_key"
DETAIL: Key (email)=(jane.doe@example.fr) already exists.
---
ERROR: null value in column "licenseNumber" of relation "License" violates not-null constraint
DETAIL: Failing row contains (42, Jean-Baptiste, Dupont, 20010203-dup-jb12, null).
---
Error: P3018
A migration failed to apply. New migrations cannot be applied before the error is recovered from.
Migration name: 20261018120000_add_unique_email
Database error code: 23505
Database error:
ERROR: could not create unique index "User_email_key"
DETAIL: Key (email)=(jane.doe@example.fr) is duplicated.
DbError { severity: "ERROR", code: SqlState(E23505), message: "could not create unique index", detail: Some("Key (email)=(jane.doe@example.fr) is duplicated.") }
---
{"level":"error","context":"ExceptionsHandler","code":"jane.doe@example.fr","message":"User jane.doe@example.fr not found","stack":"Error: User Jean Dupont\n    at UsersService.find","meta":{"userId":"3f2b8c1e-9a4d-4e2f-8b1a-2c3d4e5f6a7b"},"statusCode":404}
---
Error: User Jean Dupont not found
    at UsersService.findOne (/app/apps/backend/dist/src/users/users.service.js:42:11)
    at async UsersController.get (/app/apps/backend/dist/src/users/users.controller.js:20:5)
---
Applying migration `20261018120000_add_unique_email` jane.doe@example.fr
[Nest] 1  - 10/18/2026, 12:00:01 PM     LOG [RouterExplorer] Mapped {/api/v1/jane.doe@example.fr, GET} route
Datasource "db": PostgreSQL database "ffd", schema "public" at "@CRED@@host:5432"
No pending migrations to apply. Jean Dupont 0612345678
code: 2350JANE SQLSTATE JANE1 SqlState(Ejane1) P3018jane xP3009 P30189
GET /api/v1/users/jane.doe@example.fr?token=@TOKEN@ 404 Jean
POST /api/v1/auth/login 500 jane.doe@example.fr
Authorization: Bearer @TOKEN@
EOF

# Token- and credential-shaped values are assembled at run time from
# harmless fragments, so no secret-looking literal is committed (gitleaks,
# #483). They only exist in the temporary sample file.
FAKE_TOKEN=$(printf '%s%s.%s.%s' 'ey' 'Jfakeheader' 'fakepayload' 'fakesig')
FAKE_CRED=$(printf '%s:%s' 'sample_user' 'not-a-password')
sed -e "s/@TOKEN@/$FAKE_TOKEN/g" -e "s/@CRED@/$FAKE_CRED/g" "$W/all" >"$W/all.tmp"
mv "$W/all.tmp" "$W/all"

# Split into one file per sample.
awk -v d="$W" 'BEGIN { n = 1 } /^---$/ { n++; next } { print > (d "/case" n) }' "$W/all"
grep -v '^---$' "$W/all" >"$W/combined"

FAIL=0
check_shape() { # <file-label> <output>
  n=$(printf '%s\n' "$2" | wc -l | tr -d ' ')
  if [ "$n" -ne 5 ]; then
    echo "FAIL [$1]: expected 5 lines, got $n"
    FAIL=1
  fi
  bad=$(printf '%s\n' "$2" | grep -vE \
    -e '^Lignes de journal : [0-9]+ au total, [0-9]+ de niveau erreur$' \
    -e '^Codes Prisma : (aucun|(P[0-9]{4} )+)$' \
    -e '^Codes SQLSTATE : (aucun|([0-9][0-9A-Z]{4} )+)$' \
    -e '^Statuts HTTP : (aucun|([1-5]xx: [0-9]+  )+)$' \
    -e '^Journaux complets : voir docs/exploitation/[a-z0-9-]+\.md \(lecture locale via az\)$' ||
    true)
  if [ -n "$bad" ]; then
    echo "FAIL [$1]: unexpected output line(s):"
    printf '%s\n' "$bad" | sed 's/^/    /'
    FAIL=1
  fi
}

for f in "$W"/case* "$W/combined"; do
  OUT=$(sh "$DIR/log-summary.sh" <"$f")
  check_shape "$(basename "$f")" "$OUT"
done

# Values extracted from the combined sample.
OUT=$(sh "$DIR/log-summary.sh" <"$W/combined")
printf '%s\n' "$OUT" | sed 's/^/  | /'
for want in 'Codes Prisma : P3018 ' 'Codes SQLSTATE : 23505 ' \
  'Statuts HTTP : 4xx: 1  5xx: 1  '; do
  if ! printf '%s\n' "$OUT" | grep -qF -- "$want"; then
    echo "FAIL: missing '$want'"
    FAIL=1
  fi
done
# Crafted near-codes must not be picked up.
for nope in 'P3009' 'P3018J' 'JANE' '2350J'; do
  if printf '%s\n' "$OUT" | grep -qF -- "$nope"; then
    echo "FAIL: crafted token '$nope' extracted"
    FAIL=1
  fi
done

# Empty input still yields the fixed shape.
check_shape empty "$(sh "$DIR/log-summary.sh" </dev/null)"
check_shape runbook "$(sh "$DIR/log-summary.sh" docs/exploitation/migrations-job-adr-0025.md <"$W/combined")"
# A runbook argument outside docs/exploitation is refused.
if sh "$DIR/log-summary.sh" 'docs/exploitation/x.md jane@example.fr' </dev/null >/dev/null 2>&1; then
  echo "FAIL: free-text runbook argument accepted"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
echo "log-summary: all checks passed"
