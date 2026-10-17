import type { PrismaClient } from "@prisma/client";

type RawExecutor = Pick<PrismaClient, "$executeRaw">;

/**
 * Case-duplicate clubs (#743). The migration
 * `20261017120000_club_name_case_insensitive_unique` creates the unique index
 * on `lower(name)` only where no such duplicates exist; an environment with
 * legacy homonyms keeps running without it, and the code must still refuse
 * to pick one of them. Suites that test that refusal drop the index for
 * their duration (the integration suites run in band) and restore it after.
 */
export async function dropClubNameCaseIndex(db: RawExecutor): Promise<void> {
  await db.$executeRaw`DROP INDEX IF EXISTS "Club_name_lower_key"`;
}

/** Same statement as the migration: only when no duplicate is left. */
export async function restoreClubNameCaseIndex(db: RawExecutor): Promise<void> {
  await db.$executeRaw`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM "Club" GROUP BY lower("name") HAVING count(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS "Club_name_lower_key" ON "Club" (lower("name"));
      END IF;
    END $$;
  `;
}
