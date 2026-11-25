-- #1022 (ADR-0026, step 1): catalog of dance domains (the federation's
-- "familles de danses") and their disciplines, with the capabilities each
-- domain uses. Additive only (ADR-0017/0025): two new tables, nothing read by
-- the previous image.

-- CreateTable
CREATE TABLE "DanceDomain" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DanceDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DanceDomain_code_key" ON "DanceDomain"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Discipline_code_key" ON "Discipline"("code");

-- CreateIndex
CREATE INDEX "Discipline_domainId_idx" ON "Discipline"("domainId");

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "DanceDomain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reference rows of sport dance, inserted here so that staging and prod get
-- them without running a seed. These inserts are idempotent (the CREATE
-- statements above are not, which is fine under `migrate deploy`): a row
-- already present (same code) is left untouched. Aliases are normalized lookup keys (lowercase, no
-- accents, alphanumeric only), the union of the alias sets of
-- competition-level.util.ts (backend) and utils/discipline.ts (client).
INSERT INTO "DanceDomain" ("id", "code", "label", "position", "capabilities", "updatedAt")
VALUES (
    gen_random_uuid()::text,
    'LATINES_STANDARDS',
    'Latines & standards',
    1,
    ARRAY['COUPLE', 'TEAM', 'PASSPORT', 'COMPETITION_LEVELS', 'TEMPO_PLAYER', 'COMPETITION_SKATING']::TEXT[],
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Discipline" ("id", "code", "label", "domainId", "position", "aliases", "updatedAt")
SELECT gen_random_uuid()::text, v.code, v.label, d."id", v.position, v.aliases, CURRENT_TIMESTAMP
FROM (
    VALUES
        ('LATIN', 'Danses latines', 1, ARRAY['latin', 'latins', 'latine', 'latines', 'danseslatines']::TEXT[]),
        ('STANDARD', 'Danses standards', 2, ARRAY['standard', 'standards', 'dansesstandards']::TEXT[]),
        ('TEN_DANCE', '10 danses', 3, ARRAY['tendance', 'tendances', '10dance', '10dances', '10danse', '10danses', 'dixdanses']::TEXT[])
) AS v(code, label, position, aliases)
CROSS JOIN "DanceDomain" d
WHERE d."code" = 'LATINES_STANDARDS'
ON CONFLICT ("code") DO NOTHING;
