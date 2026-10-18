/**
 * Backfill of the per-discipline competition levels from the deprecated
 * single `User.competitionLevel` (#239, phase 1), on a real database: rows
 * with only the legacy level get the per-discipline levels the declared
 * discipline calls for, rows with any per-discipline level are never
 * touched, the legacy column is left as is, a dry run writes nothing and a
 * second run is a no-op.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { backfillUserCompetitionLevels } from "../scripts/backfill-user-competition-level.utils";

describe("User competition level backfill (#239, integration, real DB)", () => {
  const suffix = `cl-backfill-${Date.now()}`;
  let pool: Pool;
  let prisma: PrismaClient;

  const levelsSelect = {
    competitionLevel: true,
    competitionLevelLatin: true,
    competitionLevelStandard: true,
  } as const;

  const createUser = (
    key: string,
    data: {
      category?: string | null;
      competitionLevel?: string | null;
      competitionLevelLatin?: string | null;
      competitionLevelStandard?: string | null;
    },
  ) =>
    prisma.user.create({
      data: {
        email: `${key}-${suffix}@example.test`,
        password: "x",
        firstName: "Test",
        lastName: key,
        ...data,
      },
      select: { id: true },
    });

  const levelsOf = (id: string) =>
    prisma.user.findUniqueOrThrow({ where: { id }, select: levelsSelect });

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${suffix}@example.test` } },
    });
    await prisma.$disconnect();
    await pool.end();
  });

  it("copies the legacy level where missing, idempotently, after a dry run", async () => {
    const latin = await createUser("latin", {
      category: "Latin",
      competitionLevel: "Avancé",
    });
    const standard = await createUser("standard", {
      category: "Standards",
      competitionLevel: "Débutant",
    });
    const tenDance = await createUser("ten", {
      category: "Ten Dance",
      competitionLevel: "International",
    });
    const invalid = await createUser("invalid", { competitionLevel: "Expert" });
    // A cleared Standard level next to a Latin one must stay cleared.
    const partial = await createUser("partial", {
      competitionLevel: "Avancé",
      competitionLevelLatin: "Débutant",
    });

    const dry = await backfillUserCompetitionLevels(prisma, true, 2);
    expect(dry.updated).toBeGreaterThanOrEqual(3);
    expect(await levelsOf(latin.id)).toEqual({
      competitionLevel: "Avancé",
      competitionLevelLatin: null,
      competitionLevelStandard: null,
    });

    const applied = await backfillUserCompetitionLevels(prisma, false, 2);
    expect(applied.updated).toBe(dry.updated);
    expect(applied.skippedInvalid).toBeGreaterThanOrEqual(1);

    expect(await levelsOf(latin.id)).toEqual({
      competitionLevel: "Avancé",
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: null,
    });
    expect(await levelsOf(standard.id)).toEqual({
      competitionLevel: "Débutant",
      competitionLevelLatin: null,
      competitionLevelStandard: "Débutant",
    });
    expect(await levelsOf(tenDance.id)).toEqual({
      competitionLevel: "International",
      competitionLevelLatin: "International",
      competitionLevelStandard: "International",
    });
    expect(await levelsOf(invalid.id)).toEqual({
      competitionLevel: "Expert",
      competitionLevelLatin: null,
      competitionLevelStandard: null,
    });
    expect(await levelsOf(partial.id)).toEqual({
      competitionLevel: "Avancé",
      competitionLevelLatin: "Débutant",
      competitionLevelStandard: null,
    });

    // Second run: only the invalid value is still a candidate.
    const again = await backfillUserCompetitionLevels(prisma, false);
    expect(again.updated).toBe(0);
    expect(again.scanned).toBe(again.skippedInvalid);
  });
});
