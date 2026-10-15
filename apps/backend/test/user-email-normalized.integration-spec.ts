/**
 * Normalised e-mail lookup key (#526) against a real Postgres.
 *
 * Replays the migration file itself (backfill, duplicate report, rollback
 * guard trigger) on rows written the way an older release wrote them (no
 * key), then checks the lookups and the hourly re-backfill.
 *
 * Isolated: everything runs on one connection inside a transaction that is
 * rolled back at the end, so the other suites never see the backfill nor the
 * trigger. Works whatever built the test schema: `prisma db push` (column and
 * index only) or `prisma migrate deploy` (migration already applied — every
 * statement is idempotent).
 */
import { promises as fsp } from "fs";
import * as path from "path";
import { Prisma } from "@prisma/client";
import { Client, NoticeMessage } from "pg";
import {
  fillNormalizedEmails,
  findUserIdByEmail,
  isEmailTaken,
  normalizeEmail,
} from "../src/auth/email-identity";

const MIGRATION = path.resolve(
  __dirname,
  "../prisma/schema/migrations/20261015130000_user_email_normalized/migration.sql",
);

describe("User.emailNormalized (#526, integration, real DB)", () => {
  let pg: Client;
  const notices: string[] = [];

  const run = Date.now().toString(36);
  const solo = `Solo-${run}@Test.com`;
  const twinUpper = `Twin-${run}@Test.com`;
  const twinLower = twinUpper.toLowerCase();
  const ids = {
    solo: `mig-solo-${run}`,
    twinUpper: `mig-twin-u-${run}`,
    twinLower: `mig-twin-l-${run}`,
  };

  /** The helpers' Prisma surface, served by the transaction's connection. */
  const db = {
    $queryRaw: async (sql: Prisma.Sql) =>
      (await pg.query(sql.text, sql.values)).rows,
    $executeRaw: async (sql: Prisma.Sql) =>
      (await pg.query(sql.text, sql.values)).rowCount ?? 0,
    user: {
      count: async () =>
        Number(
          (
            await pg.query<{ n: string }>(
              'SELECT count(*) AS n FROM "User" WHERE "emailNormalized" IS NULL',
            )
          ).rows[0].n,
        ),
    },
  };
  const lookup = db as unknown as Parameters<typeof findUserIdByEmail>[0];
  const filler = db as unknown as Parameters<typeof fillNormalizedEmails>[0];

  /** Inserts a row the way the previous release did: no lookup key. */
  const legacyRow = (id: string, email: string) =>
    pg.query(
      `INSERT INTO "User" (id, email, password, "firstName", "lastName", "updatedAt")
       VALUES ($1, $2, 'x', 'Mig', 'Legacy', now())`,
      [id, email],
    );

  const keyOf = async (id: string) =>
    (
      await pg.query<{ k: string | null }>(
        'SELECT "emailNormalized" AS k FROM "User" WHERE id = $1',
        [id],
      )
    ).rows[0]?.k;

  const replayMigration = async () =>
    pg.query(await fsp.readFile(MIGRATION, "utf8"));

  beforeAll(async () => {
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    pg.on("notice", (n: NoticeMessage) => notices.push(n.message));
    await pg.connect();
    await pg.query("BEGIN");

    await legacyRow(ids.solo, solo);
    await legacyRow(ids.twinUpper, twinUpper);
    await legacyRow(ids.twinLower, twinLower);
    // Simple-query protocol: one multi-statement script, as Prisma sends it.
    await replayMigration();
  });

  afterAll(async () => {
    await pg.query("ROLLBACK");
    await pg.end();
  });

  it("backfills a legacy row with its ASCII-folded address", async () => {
    expect(await keyOf(ids.solo)).toBe(normalizeEmail(solo));
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

  it("sets a lock timeout for the migration's transaction", async () => {
    const { rows } = await pg.query<{ lock_timeout: string }>(
      "SHOW lock_timeout",
    );
    expect(rows[0].lock_timeout).toBe("5s");
  });

  it("is idempotent: a second run changes nothing and does not fail", async () => {
    await expect(replayMigration()).resolves.toBeDefined();
    expect(await keyOf(ids.solo)).toBe(normalizeEmail(solo));
    expect(await keyOf(ids.twinUpper)).toBeNull();
  });

  it("finds keyed and keyless accounts with the #465 rules", async () => {
    // Keyed row, any casing.
    expect(await findUserIdByEmail(lookup, solo.toUpperCase())).toBe(ids.solo);
    // Keyless twins: exact casing only, any other casing refused.
    expect(await findUserIdByEmail(lookup, twinUpper)).toBe(ids.twinUpper);
    expect(await findUserIdByEmail(lookup, twinLower)).toBe(ids.twinLower);
    expect(await findUserIdByEmail(lookup, twinUpper.toUpperCase())).toBeNull();
    // A new address colliding with either is taken.
    expect(await isEmailTaken(lookup, twinUpper.toUpperCase())).toBe(true);
    expect(await isEmailTaken(lookup, solo.toUpperCase(), ids.solo)).toBe(
      false,
    );
  });

  it("the unique key refuses a second account for the same address", async () => {
    await pg.query("SAVEPOINT clash");
    await expect(
      pg.query(
        `INSERT INTO "User" (id, email, "emailNormalized", password, "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, $2, 'x', 'Mig', 'Clash', now())`,
        [`mig-clash-${run}`, normalizeEmail(solo)],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await pg.query("ROLLBACK TO SAVEPOINT clash");
  });

  it("rollback guard: an address changed without its key loses the stale key", async () => {
    const moved = `Moved-${run}@test.com`;
    // What the previous release's back-office edit does: `email` only.
    await pg.query('UPDATE "User" SET email = $1 WHERE id = $2', [
      moved,
      ids.solo,
    ]);
    expect(await keyOf(ids.solo)).toBeNull();
    // Still found by its real address (keyless branch), not by the old one.
    expect(await findUserIdByEmail(lookup, moved)).toBe(ids.solo);
    expect(await findUserIdByEmail(lookup, solo)).toBeNull();

    // The hourly re-backfill gives it its key back; the twins stay keyless.
    const { filled, unresolved } = await fillNormalizedEmails(filler);
    expect(filled).toBeGreaterThanOrEqual(1);
    expect(unresolved).toBeGreaterThanOrEqual(2);
    expect(await keyOf(ids.solo)).toBe(normalizeEmail(moved));
    expect(await keyOf(ids.twinUpper)).toBeNull();
  });

  it("rollback guard: keeps a key written with its address", async () => {
    const next = normalizeEmail(`Next-${run}@test.com`);
    await pg.query(
      'UPDATE "User" SET email = $1, "emailNormalized" = $1 WHERE id = $2',
      [next, ids.solo],
    );
    expect(await keyOf(ids.solo)).toBe(next);
  });
});
