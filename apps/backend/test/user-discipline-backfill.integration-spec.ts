/**
 * Backfill of `UserDiscipline` by migration `20261125130000_user_discipline`
 * (#1023, ADR-0026 step 2), on a real database. The migration already ran in
 * the global setup, before these users existed, so the test replays its
 * backfill statement — read from the migration file itself — and checks:
 * - each user gets exactly the rows deriveUserDisciplines() computes (the
 *   SQL and the dual write follow the same rules);
 * - a second run changes nothing (idempotent), and an existing row is never
 *   overwritten.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PassportLevel, PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { deriveUserDisciplines } from "../src/disciplines/user-disciplines.sync";

const MIGRATION = join(
  __dirname,
  "../prisma/schema/migrations/20261125130000_user_discipline/migration.sql",
);

/** The backfill statement of the migration (from its CTE to the end). */
function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("WITH raw AS");
  if (start < 0) throw new Error("Backfill statement not found");
  return sql.slice(start);
}

describe("UserDiscipline backfill (#1023, integration, real DB)", () => {
  const suffix = `ud-backfill-${Date.now()}`;
  let pool: Pool;
  let prisma: PrismaClient;

  const profiles: {
    category?: string | null;
    passportLevelLatin?: PassportLevel | null;
    passportLevelStandard?: PassportLevel | null;
    competitionLevelLatin?: string | null;
    competitionLevelStandard?: string | null;
    competitionLevel?: string | null;
  }[] = [
    { category: "Latin" },
    { category: "Standard", competitionLevelStandard: "Avancé" },
    { category: " latines ", passportLevelLatin: "VERT" },
    { category: "STANDARDS", competitionLevelLatin: "International" },
    {
      category: "Ten Dance",
      passportLevelLatin: "BLEU",
      passportLevelStandard: "VIOLET",
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: "Débutant",
    },
    { category: "10 danses" },
    { category: "dix  danses" },
    { category: "ten dances" },
    { category: "Adulte" },
    { category: "", competitionLevelLatin: "   " },
    { category: null, passportLevelStandard: "JAUNE" },
    { category: null },
    // Deprecated single level only (#239 read fallback).
    { category: "Latin", competitionLevel: "Avancé" },
    { category: "Standards", competitionLevel: "Débutant" },
    { category: "10 danses", competitionLevel: " International " },
    { category: null, competitionLevel: "Intermédiaire" },
    { category: "Latin", competitionLevel: "Expert" },
    // A valid per-discipline level wins; an invalid one does not.
    {
      category: "Ten Dance",
      competitionLevel: "Avancé",
      competitionLevelStandard: "Débutant",
    },
    {
      category: "Latin",
      competitionLevel: "Avancé",
      competitionLevelLatin: "x",
    },
  ];

  const rowsOf = async (userId: string) =>
    (
      await prisma.userDiscipline.findMany({
        where: { userId },
        select: {
          passportLevel: true,
          competitionLevel: true,
          primary: true,
          discipline: { select: { code: true } },
        },
        orderBy: { discipline: { position: "asc" } },
        take: 10,
      })
    ).map(({ discipline, ...levels }) => ({
      code: discipline.code,
      ...levels,
    }));

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

  it("maps the legacy columns like the dual write, idempotently", async () => {
    const users = [];
    for (const [i, profile] of profiles.entries()) {
      users.push(
        await prisma.user.create({
          data: {
            email: `${i}-${suffix}@example.test`,
            password: "x",
            firstName: "Test",
            lastName: `u${i}`,
            ...profile,
          },
          select: { id: true },
        }),
      );
    }

    await prisma.$executeRawUnsafe(backfillStatement());

    for (const [i, user] of users.entries()) {
      expect(await rowsOf(user.id)).toEqual(deriveUserDisciplines(profiles[i]));
    }
    // Spot checks, so that a shared mistake in both paths still fails.
    expect((await rowsOf(users[4].id)).map((r) => r.code)).toEqual([
      "LATIN",
      "STANDARD",
      "TEN_DANCE",
    ]);
    expect(await rowsOf(users[8].id)).toEqual([]);
    // The legacy level reaches UserDiscipline (#239 fallback).
    expect(await rowsOf(users[12].id)).toEqual([
      {
        code: "LATIN",
        passportLevel: null,
        competitionLevel: "Avancé",
        primary: true,
      },
    ]);
    expect(
      (await rowsOf(users[15].id)).map((r) => [r.code, r.competitionLevel]),
    ).toEqual([
      ["LATIN", "Intermédiaire"],
      ["STANDARD", "Intermédiaire"],
    ]);

    // An existing row is never overwritten, and a re-run adds nothing.
    await prisma.userDiscipline.updateMany({
      where: { userId: users[0].id },
      data: { competitionLevel: "Débutant" },
    });
    const count = await prisma.userDiscipline.count({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    expect(await prisma.$executeRawUnsafe(backfillStatement())).toBe(0);
    expect(
      await prisma.userDiscipline.count({
        where: { userId: { in: users.map((u) => u.id) } },
      }),
    ).toBe(count);
    expect((await rowsOf(users[0].id))[0].competitionLevel).toBe("Débutant");
  });
});
