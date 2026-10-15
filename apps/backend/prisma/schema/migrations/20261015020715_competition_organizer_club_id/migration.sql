-- #408: link the organising club of a competition by id instead of by name.
-- Additive only (ADR-0017): nullable column + index + FK. `organizer` stays as
-- the display label and as the read fallback while rows are still unlinked.

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "organizerClubId" TEXT;

-- CreateIndex
CREATE INDEX "Competition_organizerClubId_idx" ON "Competition"("organizerClubId");

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_organizerClubId_fkey" FOREIGN KEY ("organizerClubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: same rule as the runtime resolver (findClubIdByName,
-- src/competitions/competition-organizer.ts): trimmed organizer equals ONE club
-- name ignoring case. Names shared by several clubs (case only) are never
-- guessed; unmatched or ambiguous rows stay NULL, are listed by
-- scripts/backfill-competition-organizer-club.ts and keep the name fallback.
-- Re-runnable: only rows still NULL are written.
UPDATE "Competition" AS c
SET "organizerClubId" = m."id"
FROM (
    SELECT lower("name") AS "key", min("id") AS "id"
    FROM "Club"
    GROUP BY lower("name")
    HAVING count(*) = 1
) AS m
WHERE c."organizerClubId" IS NULL
  AND c."organizer" IS NOT NULL
  AND lower(btrim(c."organizer")) = m."key";
