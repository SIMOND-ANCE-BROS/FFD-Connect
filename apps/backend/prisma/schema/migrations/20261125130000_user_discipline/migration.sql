-- #1023 (ADR-0026, step 2): disciplines practised by a dancer, with the
-- Passeport Danse and competition levels of each one. Additive only
-- (ADR-0017/0025): one new table, nothing read by the previous image. The
-- legacy columns (User.category, passportLevel*, competitionLevel*) stay the
-- source of truth; the backend writes both until reads switch (#1024).

-- CreateTable
CREATE TABLE "UserDiscipline" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "passportLevel" "PassportLevel",
    "competitionLevel" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDiscipline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDiscipline_disciplineId_idx" ON "UserDiscipline"("disciplineId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDiscipline_userId_disciplineId_key" ON "UserDiscipline"("userId", "disciplineId");

-- AddForeignKey
ALTER TABLE "UserDiscipline" ADD CONSTRAINT "UserDiscipline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDiscipline" ADD CONSTRAINT "UserDiscipline_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BACKFILL (#1023). Same rules as deriveUserDisciplines()
-- (src/disciplines/user-disciplines.sync.ts), which the integration test
-- test/user-discipline-backfill.integration-spec.ts checks against this very
-- statement:
-- - the declared discipline (User.category) is normalized like
--   normalizeDiscipline() (competition-level.util.ts): trimmed, lowercased,
--   inner whitespace collapsed, then matched against the same aliases;
-- - Latin / Standard -> that discipline, primary; Ten Dance -> LATIN +
--   STANDARD + TEN_DANCE, TEN_DANCE primary (10 danses has no level);
-- - a Passeport or competition level in a discipline also adds it (not
--   primary), so that no level is lost when reads switch (#1024);
-- - levels are copied to their discipline, a blank competition level is NULL;
-- - without any VALID per-discipline competition level, the deprecated single
--   User.competitionLevel (the read fallback of #239) stands in, copied like
--   planCompetitionLevelBackfill(): declared Latin -> Latin only, Standard ->
--   Standard only, anything else -> both.
-- Idempotent: an existing (userId, disciplineId) row is left untouched.
WITH raw AS (
    SELECT
        u."id" AS "userId",
        CASE lower(regexp_replace(regexp_replace(u."category", '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
            WHEN 'latin' THEN 'Latin'
            WHEN 'latine' THEN 'Latin'
            WHEN 'latines' THEN 'Latin'
            WHEN 'standard' THEN 'Standard'
            WHEN 'standards' THEN 'Standard'
            WHEN 'ten dance' THEN 'Ten Dance'
            WHEN 'ten dances' THEN 'Ten Dance'
            WHEN '10 danses' THEN 'Ten Dance'
            WHEN 'dix danses' THEN 'Ten Dance'
        END AS declared,
        u."passportLevelLatin" AS "passportLatin",
        u."passportLevelStandard" AS "passportStandard",
        NULLIF(regexp_replace(u."competitionLevelLatin", '^\s+|\s+$', '', 'g'), '') AS "competitionLatin",
        NULLIF(regexp_replace(u."competitionLevelStandard", '^\s+|\s+$', '', 'g'), '') AS "competitionStandard",
        NULLIF(regexp_replace(u."competitionLevel", '^\s+|\s+$', '', 'g'), '') AS "competitionLegacy"
    FROM "User" u
),
-- toCompetitionLevel(): only the four levels are valid.
checked AS (
    SELECT
        raw.*,
        CASE
            WHEN "competitionLatin" IN ('Débutant', 'Intermédiaire', 'Avancé', 'International')
              OR "competitionStandard" IN ('Débutant', 'Intermédiaire', 'Avancé', 'International')
            THEN NULL
            WHEN "competitionLegacy" IN ('Débutant', 'Intermédiaire', 'Avancé', 'International')
            THEN "competitionLegacy"
        END AS legacy
    FROM raw
),
src AS (
    SELECT
        "userId",
        declared,
        "passportLatin",
        "passportStandard",
        CASE WHEN legacy IS NOT NULL AND declared IS DISTINCT FROM 'Standard'
             THEN legacy ELSE "competitionLatin" END AS "competitionLatin",
        CASE WHEN legacy IS NOT NULL AND declared IS DISTINCT FROM 'Latin'
             THEN legacy ELSE "competitionStandard" END AS "competitionStandard"
    FROM checked
),
wanted AS (
    SELECT "userId", 'LATIN' AS code, "passportLatin" AS "passportLevel", "competitionLatin" AS "competitionLevel",
           COALESCE(declared = 'Latin', false) AS "primary"
    FROM src
    WHERE declared IN ('Latin', 'Ten Dance') OR "passportLatin" IS NOT NULL OR "competitionLatin" IS NOT NULL
    UNION ALL
    SELECT "userId", 'STANDARD', "passportStandard", "competitionStandard",
           COALESCE(declared = 'Standard', false)
    FROM src
    WHERE declared IN ('Standard', 'Ten Dance') OR "passportStandard" IS NOT NULL OR "competitionStandard" IS NOT NULL
    UNION ALL
    SELECT "userId", 'TEN_DANCE', NULL::"PassportLevel", NULL, true
    FROM src
    WHERE declared = 'Ten Dance'
)
INSERT INTO "UserDiscipline" ("id", "userId", "disciplineId", "passportLevel", "competitionLevel", "primary", "updatedAt")
SELECT gen_random_uuid()::text, w."userId", d."id", w."passportLevel", w."competitionLevel", w."primary", CURRENT_TIMESTAMP
FROM wanted w
JOIN "Discipline" d ON d."code" = w.code
ON CONFLICT ("userId", "disciplineId") DO NOTHING;
