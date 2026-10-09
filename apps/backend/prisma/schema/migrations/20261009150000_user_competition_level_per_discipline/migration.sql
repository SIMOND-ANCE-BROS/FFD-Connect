-- Per-discipline competition level (additive only: the legacy single
-- "competitionLevel" column is kept as a deprecated read fallback so a
-- rolled-back revision keeps working; drop it in a later cleanup).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "competitionLevelLatin" TEXT,
ADD COLUMN     "competitionLevelStandard" TEXT;

-- Best-effort backfill from the legacy single level, guided by the declared
-- discipline: a "Latin" dancer gets a Latin level only, a "Standard" dancer a
-- Standard level only, anyone else (Ten Dance or unknown) both.
UPDATE "User"
SET "competitionLevelLatin" = btrim("competitionLevel")
WHERE btrim("competitionLevel") IN ('Débutant', 'Intermédiaire', 'Avancé', 'International')
  AND "competitionLevelLatin" IS NULL
  AND lower(btrim(coalesce("category", ''))) NOT IN ('standard', 'standards');

UPDATE "User"
SET "competitionLevelStandard" = btrim("competitionLevel")
WHERE btrim("competitionLevel") IN ('Débutant', 'Intermédiaire', 'Avancé', 'International')
  AND "competitionLevelStandard" IS NULL
  AND lower(btrim(coalesce("category", ''))) NOT IN ('latin', 'latine', 'latines');
