/**
 * Dedicated, fictitious data of the k6 load tests (issue #488). No real data.
 *
 * Creates (idempotent, fixed ids):
 * - LOAD_LICENSEE_COUNT licensees `load-licensee-0001@load.invalid`… with a
 *   valid licence `LOAD-0001`…;
 * - LOAD_SCANNER_COUNT STAFF accounts `load-scanner-0001@load.invalid`…;
 * - the competition `load-comp` (today, LIVE) with one event, every licensee
 *   registered, CONFIRMED and paid, check-in RESET at every run (so each
 *   campaign measures the first-scan write again).
 * All accounts share LOAD_TEST_PASSWORD (env, never committed). `.invalid` is
 * a reserved TLD: no mail can ever reach anyone, and the staging boot purge
 * (purge-test-accounts, `@test.com` only) leaves these accounts alone, so a
 * replica started mid-campaign does not delete them.
 *
 * Usage (from apps/backend, DATABASE_URL in the environment or .env):
 *   LOAD_TEST_PASSWORD=… pnpm exec tsx test/load/seed-load-test.ts
 *   pnpm exec tsx test/load/seed-load-test.ts --purge   # removes everything
 *
 * Guard: refuses any non-local database other than ffd_connect_staging, and
 * that one only with LOAD_SEED_ALLOW_REMOTE=yes (staging campaign approved by
 * Gabin). Never against prod.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { Pool } from "pg";
import { purgeTestUser } from "../../scripts/purge-test-accounts.utils";

export const LOAD_EMAIL_DOMAIN = "@load.invalid";
export const LOAD_COMPETITION_ID = "load-comp";
const LOAD_EVENT_ID = "load-ev-latin";
const LOAD_CLUB_NAME = "Club Test de Charge";
const LICENSE_PREFIX = "LOAD-";
const BCRYPT_ROUNDS = 12; // same cost as AuthService: login is measured as is
const MAX_ACCOUNTS = 5000;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_ACCOUNTS) {
    throw new Error(`${name} must be an integer in [0, ${MAX_ACCOUNTS}]`);
  }
  return value;
}

const pad = (n: number) => String(n).padStart(4, "0");
export const licenseeEmail = (n: number) =>
  `load-licensee-${pad(n)}${LOAD_EMAIL_DOMAIN}`;
export const scannerEmail = (n: number) =>
  `load-scanner-${pad(n)}${LOAD_EMAIL_DOMAIN}`;

/** Host of a postgres:// URL, or null. */
export function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalHost(host: string | null): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "db" // docker compose service name
  );
}

/** The only remote database the seed may write to (staging, never prod). */
export const STAGING_DATABASE = "ffd_connect_staging";

/** Database name of a postgres:// URL, or null. */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

function assertSafeDatabase(url: string | undefined): void {
  const host = databaseHost(url);
  if (!host) throw new Error("DATABASE_URL missing or invalid");
  if (isLocalHost(host)) return;
  const name = databaseName(url);
  if (
    process.env.LOAD_SEED_ALLOW_REMOTE === "yes" &&
    name === STAGING_DATABASE
  ) {
    console.warn(
      `⚠ Remote database ${host}/${name}: allowed by LOAD_SEED_ALLOW_REMOTE=yes`,
    );
    return;
  }
  throw new Error(
    `Refusing remote database ${host}/${name ?? "?"}: only ${STAGING_DATABASE}, with LOAD_SEED_ALLOW_REMOTE=yes, for an approved staging campaign (never prod).`,
  );
}

const url = process.env.DATABASE_URL;
assertSafeDatabase(url);
const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function seed(): Promise<void> {
  const password = process.env.LOAD_TEST_PASSWORD ?? "";
  if (password.length < 12) {
    throw new Error("LOAD_TEST_PASSWORD (12+ characters) is required");
  }
  const licensees = intEnv("LOAD_LICENSEE_COUNT", 200);
  const scanners = intEnv("LOAD_SCANNER_COUNT", 10);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const club = await prisma.club.upsert({
    where: { name: LOAD_CLUB_NAME },
    update: {},
    create: { name: LOAD_CLUB_NAME },
    select: { id: true },
  });

  const users = [
    ...Array.from({ length: licensees }, (_, i) => ({
      id: `load-licensee-${pad(i + 1)}`,
      email: licenseeEmail(i + 1),
      firstName: "Charge",
      lastName: `Licencié ${pad(i + 1)}`,
      role: UserRole.LICENSEE,
    })),
    ...Array.from({ length: scanners }, (_, i) => ({
      id: `load-scanner-${pad(i + 1)}`,
      email: scannerEmail(i + 1),
      firstName: "Charge",
      lastName: `Scanner ${pad(i + 1)}`,
      role: UserRole.STAFF,
    })),
  ];
  await prisma.user.createMany({
    data: users.map((u) => ({
      ...u,
      password: hash,
      clubId: club.id,
      clubName: LOAD_CLUB_NAME,
      category: "Latin",
    })),
    skipDuplicates: true,
  });
  // Realign the password of accounts created by an earlier run.
  await prisma.user.updateMany({
    where: { email: { endsWith: LOAD_EMAIL_DOMAIN } },
    data: { password: hash, disabledAt: null },
  });

  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  await prisma.license.createMany({
    data: Array.from({ length: licensees }, (_, i) => ({
      id: `load-license-${pad(i + 1)}`,
      number: `${LICENSE_PREFIX}${pad(i + 1)}`,
      validUntil,
      category: "Latin",
      clubName: LOAD_CLUB_NAME,
      userId: `load-licensee-${pad(i + 1)}`,
    })),
    skipDuplicates: true,
  });
  await prisma.license.updateMany({
    where: { number: { startsWith: LICENSE_PREFIX } },
    data: { validUntil },
  });

  const today = new Date();
  today.setUTCHours(8, 0, 0, 0);
  const tonight = new Date(today);
  tonight.setUTCHours(22, 0, 0, 0);
  await prisma.competition.upsert({
    where: { id: LOAD_COMPETITION_ID },
    update: { date: today, endDate: tonight, status: "LIVE" },
    create: {
      id: LOAD_COMPETITION_ID,
      title: "[CHARGE] Compétition de test de charge",
      date: today,
      endDate: tonight,
      location: "Gymnase fictif",
      city: "Nulle-Part",
      status: "LIVE",
    },
  });
  await prisma.event.upsert({
    where: { id: LOAD_EVENT_ID },
    update: {},
    create: {
      id: LOAD_EVENT_ID,
      competitionId: LOAD_COMPETITION_ID,
      category: "Latin",
      ageGroup: "Adultes",
    },
  });
  await prisma.registration.createMany({
    data: Array.from({ length: licensees }, (_, i) => ({
      id: `load-registration-${pad(i + 1)}`,
      eventId: LOAD_EVENT_ID,
      userId: `load-licensee-${pad(i + 1)}`,
      status: "CONFIRMED" as const,
      feePaid: true,
      bibNumber: i + 1,
    })),
    skipDuplicates: true,
  });
  const reset = await prisma.registration.updateMany({
    where: { eventId: LOAD_EVENT_ID },
    data: { checkedIn: false, checkInTime: null },
  });

  console.log(
    `✓ ${licensees} licensees, ${scanners} scanners, competition ${LOAD_COMPETITION_ID} (${reset.count} check-ins reset)`,
  );
}

/** Deletes every load-test row (accounts through the account-deletion core). */
async function purge(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: LOAD_EMAIL_DOMAIN } },
    select: { id: true },
    take: MAX_ACCOUNTS * 2,
  });
  // Licences go first: purgeTestUser would only unlink them.
  await prisma.license.deleteMany({
    where: { number: { startsWith: LICENSE_PREFIX } },
  });
  for (const user of users) {
    await purgeTestUser(
      {
        prisma,
        // Load accounts never upload renewal documents: no file to delete.
        files: { deleteFiles: () => Promise.resolve(new Set<string>()) },
        warn: (message) => console.warn(`  ⚠ ${message}`),
      },
      user.id,
    );
  }
  await prisma.registration.deleteMany({ where: { eventId: LOAD_EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: LOAD_EVENT_ID } });
  await prisma.competition.deleteMany({ where: { id: LOAD_COMPETITION_ID } });
  await prisma.club.deleteMany({ where: { name: LOAD_CLUB_NAME } });
  console.log(`✓ Purged ${users.length} load-test accounts and their data`);
}

(process.argv.includes("--purge") ? purge() : seed())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect().then(() => pool.end());
  });
