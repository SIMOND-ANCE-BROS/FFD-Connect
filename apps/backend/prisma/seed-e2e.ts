/**
 * E2E test socle seed — creates the QA profiles used to test the app end-to-end,
 * one per role, plus a club. Idempotent (upserts on unique fields), safe to re-run.
 *
 * Usage:
 *   pnpm --filter backend seed:e2e     (needs DATABASE_URL + a running Postgres)
 *
 * All accounts share the password: TestE2e123!
 * Profiles: test.e2e@ffd.com (LICENSEE), club.e2e@ffd.com (CLUB),
 *           staff@test.com (STAFF), admin.e2e@ffd.com (ADMIN).
 * Guest mode needs no account ("Continuer en tant qu'invité").
 *
 * See the login-* Maestro flows in apps/client/.maestro/ for driving each profile.
 */
import "dotenv/config"; // load DATABASE_URL from .env when run via `pnpm seed:e2e`
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcrypt";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PASSWORD = "TestE2e123!";
const BCRYPT_ROUNDS = 12; // must match AuthService
const CLUB_NAME = "E2E Test Club";

interface Profile {
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  license: string;
}

const PROFILES: Profile[] = [
  {
    email: "test.e2e@ffd.com",
    role: UserRole.LICENSEE,
    firstName: "Eelef",
    lastName: "Testeur",
    license: "FFD-E2E-LIC",
  },
  {
    email: "club.e2e@ffd.com",
    role: UserRole.CLUB,
    firstName: "Test",
    lastName: "Club",
    license: "FFD-E2E-CLUB",
  },
  {
    email: "staff@test.com",
    role: UserRole.STAFF,
    firstName: "Test",
    lastName: "Staff",
    license: "FFD-E2E-STAFF",
  },
  {
    email: "admin.e2e@ffd.com",
    role: UserRole.ADMIN,
    firstName: "Test",
    lastName: "Admin",
    license: "FFD-E2E-ADMIN",
  },
];

async function main() {
  console.log("Seeding E2E test socle...\n");

  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1); // always valid
  const hashedPassword = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  const club = await prisma.club.upsert({
    where: { name: CLUB_NAME },
    // CLUB_AND_MEMBERS_PENDING surfaces the "Inscriptions en attente" dashboard
    // row (only rendered in this mode) so the club-registrations e2e flow can reach it.
    update: { registrationMode: "CLUB_AND_MEMBERS_PENDING" },
    create: { name: CLUB_NAME, registrationMode: "CLUB_AND_MEMBERS_PENDING" },
  });

  const usersByEmail: Record<string, { id: string }> = {};

  for (const p of PROFILES) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {
        password: hashedPassword,
        role: p.role,
        clubId: club.id,
        clubName: CLUB_NAME,
      },
      create: {
        email: p.email,
        password: hashedPassword,
        role: p.role,
        firstName: p.firstName,
        lastName: p.lastName,
        clubId: club.id,
        clubName: CLUB_NAME,
      },
    });
    usersByEmail[p.email] = { id: user.id };

    // License.userId is unique (1 license per user). Release any other license
    // currently linked to this user (e.g. from the demo seed) before linking ours.
    await prisma.license.updateMany({
      where: { userId: user.id, number: { not: p.license } },
      data: { userId: null },
    });

    await prisma.license.upsert({
      where: { number: p.license },
      update: { validUntil, userId: user.id, clubName: CLUB_NAME },
      create: {
        number: p.license,
        validUntil,
        category: "Latin",
        clubName: CLUB_NAME,
        userId: user.id,
      },
    });

    console.log(`  ✓ ${p.role.padEnd(8)} ${p.email}`);
  }

  const licensee = usersByEmail["test.e2e@ffd.com"];
  const admin = usersByEmail["admin.e2e@ffd.com"];

  // ── Competitions + events ────────────────────────────────────────────────
  // Two competitions attached to the E2E club so the data-dependent flows can
  // assert real content instead of navigation-only. Titles contain "a" so they
  // survive the licensee-competitions / library search step ("a"). Idempotent:
  // upsert the competition on its stable ffdId, create events only if missing.
  const now = new Date();
  const inThirtyDays = new Date(now);
  inThirtyDays.setDate(inThirtyDays.getDate() + 30);

  const twoEvents = [
    {
      category: "Latin",
      ageGroup: "Adultes",
      eventType: "COUPLE" as const,
      eventKind: "CLASSIFICATRICE" as const,
      level: "D",
    },
    {
      category: "Standard",
      ageGroup: "Adultes",
      eventType: "COUPLE" as const,
      eventKind: "CLASSIFICATRICE" as const,
      level: "D",
    },
  ];

  async function seedCompetition(
    ffdId: string,
    data: {
      title: string;
      date: Date;
      location: string;
      status: "UPCOMING" | "LIVE" | "PAST";
    },
  ) {
    const comp = await prisma.competition.upsert({
      where: { ffdId },
      update: { ...data },
      create: { ffdId, ...data },
    });
    const existing = await prisma.event.count({
      where: { competitionId: comp.id },
    });
    if (existing === 0) {
      await prisma.event.createMany({
        data: twoEvents.map((e) => ({ ...e, competitionId: comp.id })),
      });
    }
    const latinEvent = await prisma.event.findFirst({
      where: { competitionId: comp.id, category: "Latin" },
    });
    return { comp, latinEventId: latinEvent!.id };
  }

  const gala = await seedCompetition("E2E-GALA", {
    title: "Gala Latin E2E Connect",
    date: inThirtyDays,
    location: "Paris E2E Arena",
    status: "UPCOMING",
  });
  const champ = await seedCompetition("E2E-CHAMP", {
    title: "Championnat National E2E",
    date: now,
    location: "Lyon E2E Hall",
    status: "LIVE",
  });

  // ── Result on the LIVE competition (staff-live-results) ──────────────────
  const hasResult = await prisma.result.findFirst({
    where: {
      eventId: champ.latinEventId,
      userId: licensee.id,
      round: "Finale",
    },
  });
  if (!hasResult) {
    await prisma.result.create({
      data: {
        eventId: champ.latinEventId,
        userId: licensee.id,
        round: "Finale",
        ranking: 1,
        details: { participant: "Eelef Testeur", status: "QUALIFIED" },
      },
    });
  }

  // ── Pending registrations into the UPCOMING competition (club-registrations)
  // Both registrants are in the E2E club, so they surface in the club's
  // /competitions/club/pending-registrations feed.
  for (const [userId, partnerName] of [
    [licensee.id, "Partenaire Test"],
    [admin.id, "Partenaire Admin"],
  ] as const) {
    const exists = await prisma.registration.findFirst({
      where: { eventId: gala.latinEventId, userId },
    });
    if (!exists) {
      await prisma.registration.create({
        data: {
          eventId: gala.latinEventId,
          userId,
          partnerName,
          status: "PENDING",
        },
      });
    }
  }

  // ── Library tracks (licensee-library) ────────────────────────────────────
  // READY + non-Ambiance so they pass LIBRARY_WHERE; titles contain "a" to
  // survive the library search step. Row rendering needs no playable file.
  const tracks = [
    {
      sourceKey: "e2e-samba",
      title: "Métronome Samba (test)",
      style: "Samba",
      bpm: 50,
    },
    {
      sourceKey: "e2e-rumba",
      title: "Métronome Rumba (test)",
      style: "Rumba",
      bpm: 25,
    },
    {
      sourceKey: "e2e-valse",
      title: "Métronome Valse (test)",
      style: "Valse",
      bpm: 29,
    },
  ];
  for (const t of tracks) {
    await prisma.track.upsert({
      where: { sourceKey: t.sourceKey },
      update: {
        title: t.title,
        artist: "FFD Test",
        style: t.style,
        bpm: t.bpm,
        rawBpm: t.bpm,
        status: "READY",
        blacklisted: false,
        titleMasked: false,
      },
      create: {
        sourceKey: t.sourceKey,
        filename: `${t.sourceKey}.mp3`,
        title: t.title,
        artist: "FFD Test",
        style: t.style,
        bpm: t.bpm,
        rawBpm: t.bpm,
        status: "READY",
        blacklisted: false,
        titleMasked: false,
      },
    });
  }

  console.log(
    `\nDone. ${PROFILES.length} profiles + club "${CLUB_NAME}", ` +
      `2 competitions (+events), 1 result, 2 pending registrations, ` +
      `${tracks.length} tracks. Password "${PASSWORD}".`,
  );
}

main()
  .catch((e) => {
    console.error("seed:e2e failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
