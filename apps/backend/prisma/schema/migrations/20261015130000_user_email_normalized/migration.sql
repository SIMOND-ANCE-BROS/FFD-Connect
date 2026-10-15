-- #526: dedicated lookup key for login e-mails (follow-up of #465 / PR #525).
--
-- `emailNormalized` = normalizeEmail(email) (trim + ASCII-only lower-casing,
-- apps/backend/src/auth/email-identity.ts). Under the "C" collation, lower()
-- folds ASCII letters only, exactly like normalizeEmail.
--
-- Additive and backwards compatible (ADR-0017, single-revision deploys with
-- automatic rollback): one nullable column, one unique index, one trigger. The
-- previous release ignores the column and keeps working; `email` stays the
-- source of truth. Every statement is idempotent, so the script can be
-- re-run by hand (docs/exploitation/email-normalise.md).
--
-- Locking: Prisma runs a migration file as one multi-statement script, i.e.
-- inside ONE implicit transaction. ADD COLUMN takes an ACCESS EXCLUSIVE lock
-- on "User" held until that transaction commits, so every read AND write of
-- "User" waits for the whole script (backfill and index build included) —
-- including the account-status read JwtStrategy does on every authenticated
-- request. "User" is small (beta): well under a second during the boot of
-- the new revision. For the same reason the index is built without
-- CONCURRENTLY, which is refused inside a transaction.
--
-- lock_timeout: if a long transaction already holds a lock on "User", the
-- migration gives up after 5 s instead of queueing every request behind it.
-- The whole script then rolls back (nothing half-applied), the deploy fails
-- its smoke test and is rolled back; being idempotent, it can be retried.
SET LOCAL lock_timeout = '5s';

-- 1. Column.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT;

-- 2. Backfill. Addresses shared by several accounts once normalised (legacy
-- accounts differing only by case, kept apart by #465) are NOT filled: no
-- account is picked or merged silently. They stay NULL, which the unique
-- index allows, and the lookup finds them through the same index (a btree
-- serves `IS NULL`) with the #465 rules (exact casing wins, otherwise
-- refused). An address already held by a filled row is not given to a second
-- row either.
WITH "keys" AS (
  SELECT "id", lower(btrim("email") COLLATE "C") AS "key" FROM "User"
),
"singleKeys" AS (
  SELECT "key" FROM "keys" GROUP BY "key" HAVING count(*) = 1
)
UPDATE "User" AS u
SET "emailNormalized" = k."key"
FROM "keys" AS k
JOIN "singleKeys" AS s ON s."key" = k."key"
WHERE u."id" = k."id"
  AND u."emailNormalized" IS NULL;

-- 3. Report the case duplicates left unfilled (counts only: no address in
-- the deploy logs, #529). Resolution: docs/exploitation/email-normalise.md.
DO $$
DECLARE
  "groups" integer;
  "accounts" integer;
BEGIN
  SELECT count(*), COALESCE(sum("n"), 0) INTO "groups", "accounts"
  FROM (
    SELECT count(*) AS "n" FROM "User"
    GROUP BY lower(btrim("email") COLLATE "C")
    HAVING count(*) > 1
  ) AS d;
  IF "groups" > 0 THEN
    RAISE WARNING '#526: % address(es) shared by % accounts differing only by case; their emailNormalized stays NULL (see docs/exploitation/email-normalise.md)', "groups", "accounts";
  END IF;
END $$;

-- 4. Unique lookup key. Cannot fail on existing data: step 2 only fills keys
-- held by a single row.
CREATE UNIQUE INDEX IF NOT EXISTS "User_emailNormalized_key" ON "User"("emailNormalized");

-- 5. Rollback guard. The previous release changes `email` (back-office
-- identifiers edit) without knowing `emailNormalized`; the key would then
-- still designate the old address. Whenever a written key does not match its
-- row's address, it is cleared: the row falls back to the keyless branch
-- (found by its real address) until the hourly re-backfill fills it again.
-- Never computes a key itself, so it can never raise a unique violation.
-- Temporary: dropped by the cleanup that makes the column NOT NULL.
CREATE OR REPLACE FUNCTION "user_email_normalized_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."emailNormalized" IS DISTINCT FROM lower(btrim(NEW."email") COLLATE "C") THEN
    NEW."emailNormalized" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "User_email_normalized_guard" ON "User";
CREATE TRIGGER "User_email_normalized_guard"
BEFORE INSERT OR UPDATE OF "email", "emailNormalized" ON "User"
FOR EACH ROW EXECUTE FUNCTION "user_email_normalized_guard"();
