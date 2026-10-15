/**
 * Normalised e-mail lookup key (#526) against a real Postgres.
 *
 * CI builds the test schema with `prisma db push`, which never replays the
 * hand-written parts of the migration (backfill, duplicate report, rollback
 * guard trigger). This suite replays the migration file itself — every
 * statement is idempotent — on rows written the way an older release wrote
 * them (no key), then checks the lookups and the hourly re-backfill.
 */
import { promises as fsp } from "fs";
import * as path from "path";
import { Prisma, UserRole } from "@prisma/client";
import { TestingModule } from "@nestjs/testing";
import { Client, NoticeMessage } from "pg";
import {
  fillNormalizedEmails,
  findUserIdByEmail,
  isEmailTaken,
  storedEmailData,
} from "../src/auth/email-identity";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

const MIGRATION = path.resolve(
  __dirname,
  "../prisma/schema/migrations/20261015120000_user_email_normalized/migration.sql",
);

describe("User.emailNormalized (#526, integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let pg: Client;
  const notices: string[] = [];

  const run = Date.now().toString(36);
  const solo = `Solo-${run}@Test.com`;
  const twinUpper = `Twin-${run}@Test.com`;
  const twinLower = twinUpper.toLowerCase();
  const ids: Record<string, string> = {};

  /** Inserts a row the way the previous release did: no lookup key. */
  async function legacyRow(name: string, email: string): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email,
        password: "x",
        firstName: "Mig",
        lastName: name,
        role: UserRole.LICENSEE,
      },
      select: { id: true, emailNormalized: true },
    });
    expect(user.emailNormalized).toBeNull();
    ids[name] = user.id;
  }

  const keyOf = async (id: string) =>
    (
      await prisma.user.findUnique({
        where: { id },
        select: { emailNormalized: true },
      })
    )?.emailNormalized;

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    // Simple-query protocol: the migration runs as one multi-statement
    // script, exactly like `prisma migrate deploy` sends it.
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    pg.on("notice", (n: NoticeMessage) => notices.push(n.message));
    await pg.connect();

    await legacyRow("solo", solo);
    await legacyRow("twinUpper", twinUpper);
    await legacyRow("twinLower", twinLower);
    await pg.query(await fsp.readFile(MIGRATION, "utf8"));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    // Back to the `db push` state the other suites expect.
    await pg.query(
      'DROP TRIGGER IF EXISTS "User_email_normalized_guard" ON "User"; DROP FUNCTION IF EXISTS "user_email_normalized_guard"();',
    );
    await pg.end();
    await moduleRef.close();
  });

  it("backfills a legacy row with its ASCII-folded address", async () => {
    expect(await keyOf(ids.solo)).toBe(solo.toLowerCase());
  });

  it("never merges accounts differing only by case: both keep no key", async () => {
    expect(await keyOf(ids.twinUpper)).toBeNull();
    expect(await keyOf(ids.twinLower)).toBeNull();
  });

  it("reports the duplicates as counts, never an address", () => {
    const report = notices.find((n) => n.startsWith("#526:"));
    expect(report).toMatch(/\d+ address\(es\) shared by \d+ accounts/);
    expect(report).not.toContain("@");
  });

  it("is idempotent: a second run changes nothing and does not fail", async () => {
    await expect(
      pg.query(await fsp.readFile(MIGRATION, "utf8")),
    ).resolves.toBeDefined();
    expect(await keyOf(ids.solo)).toBe(solo.toLowerCase());
    expect(await keyOf(ids.twinUpper)).toBeNull();
  });

  it("finds keyed and keyless accounts with the #465 rules", async () => {
    // Keyed row, any casing.
    expect(await findUserIdByEmail(prisma, solo.toUpperCase())).toBe(ids.solo);
    // Keyless twins: exact casing only, any other casing refused.
    expect(await findUserIdByEmail(prisma, twinUpper)).toBe(ids.twinUpper);
    expect(await findUserIdByEmail(prisma, twinLower)).toBe(ids.twinLower);
    expect(await findUserIdByEmail(prisma, twinUpper.toUpperCase())).toBeNull();
    // A new address colliding with either is taken.
    expect(await isEmailTaken(prisma, twinUpper.toUpperCase())).toBe(true);
    expect(await isEmailTaken(prisma, solo.toUpperCase(), ids.solo)).toBe(
      false,
    );
  });

  it("the unique key refuses a second account for the same address", async () => {
    await expect(
      prisma.user.create({
        data: {
          ...storedEmailData(solo),
          password: "x",
          firstName: "Mig",
          lastName: "Clash",
          role: UserRole.LICENSEE,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rollback guard: an address changed without its key loses the stale key", async () => {
    const moved = `Moved-${run}@test.com`;
    // What the previous release's back-office edit does: `email` only.
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "User" SET email = ${moved} WHERE id = ${ids.solo}`,
    );
    expect(await keyOf(ids.solo)).toBeNull();
    // Still found by its real address (fallback branch), not by the old one.
    expect(await findUserIdByEmail(prisma, moved)).toBe(ids.solo);
    expect(await findUserIdByEmail(prisma, solo)).toBeNull();

    // The hourly re-backfill gives it its key back; the twins stay keyless.
    const { filled, unresolved } = await fillNormalizedEmails(prisma);
    expect(filled).toBeGreaterThanOrEqual(1);
    expect(unresolved).toBeGreaterThanOrEqual(2);
    expect(await keyOf(ids.solo)).toBe(moved.toLowerCase());
    expect(await keyOf(ids.twinUpper)).toBeNull();
  });

  it("rollback guard: keeps a key written with its address", async () => {
    const next = `Next-${run}@test.com`;
    await prisma.user.update({
      where: { id: ids.solo },
      data: storedEmailData(next),
    });
    expect(await keyOf(ids.solo)).toBe(next.toLowerCase());
  });
});
