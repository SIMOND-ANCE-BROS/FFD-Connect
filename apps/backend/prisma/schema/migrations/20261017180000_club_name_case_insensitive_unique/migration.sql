-- #743: one club per name, case ignored.
--
-- Club names are compared case-insensitively everywhere (sameClubName); two
-- clubs whose names only differ by case make every legacy lookup by name
-- ambiguous, which the code refuses (matchClubByName). This index stops new
-- ones from appearing (admin creation / rename, HelloAsso no longer creates
-- clubs).
--
-- Additive and backwards compatible (ADR-0017): one unique index, no data
-- change. It is created ONLY when no case duplicate exists: building it over
-- duplicates would fail the migration, hence the container boot, hence the
-- deploy. With duplicates, the script reports their count (no club name in
-- the deploy logs) and skips the index; the code keeps refusing those names
-- as ambiguous. Resolution: rename or merge the duplicates from the
-- back-office, then create the index by hand with the statement below
-- (docs/exploitation/backoffice-admin.md, « Clubs homonymes »).
--
-- Expression index: Prisma does not model it (no schema drift, checked with
-- `prisma migrate diff`). Idempotent (IF NOT EXISTS).
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  "groups" integer;
BEGIN
  SELECT count(*) INTO "groups"
  FROM (
    SELECT 1 FROM "Club" GROUP BY lower("name") HAVING count(*) > 1
  ) AS d;
  IF "groups" > 0 THEN
    RAISE WARNING '#743: % club name(s) shared by several clubs up to case; unique index "Club_name_lower_key" NOT created (see docs/exploitation/backoffice-admin.md)', "groups";
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "Club_name_lower_key" ON "Club" (lower("name"));
  END IF;
END $$;
