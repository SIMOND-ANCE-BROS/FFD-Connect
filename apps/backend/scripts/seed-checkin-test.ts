/**
 * Seed de TEST pour (1) la bannière d'expiration de licence et (2) le scan QR
 * de check-in — staging/beta uniquement.
 *
 * (1) Met la licence du compte de démo licencié (beta@test.com) à expiration
 *     proche (J+20) pour faire apparaître la bannière orange (< 30 j).
 * (2) Crée une compétition ACTIVE (datée d'aujourd'hui → renvoyée par
 *     GET /competitions/active) + 2 épreuves + 2 licenciés factices INSCRITS
 *     (CONFIRMED, droits payés) avec des IDs fixes, pour que les 2 QR codes de
 *     test donnent un check-in réussi.
 *
 * Les QR codes encodent { "id": "seed-scan-user-1" | "seed-scan-user-2" } —
 * le backend résout l'utilisateur par cet id et check-in ses inscriptions.
 *
 * Idempotent (IDs fixes → upsert). Lancé au boot (docker-entrypoint.sh) si
 * SEED_TEST_TRACKS=true — jamais en prod. Non-fatal.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BETA_EMAIL = "beta@test.com";
const COMP_ID = "seed-checkin-comp";
const EVENT_LATIN = "seed-checkin-ev-latin";
const EVENT_STD = "seed-checkin-ev-standard";

const SCAN_USERS = [
  {
    id: "seed-scan-user-1",
    email: "scan1@test.com",
    firstName: "Test",
    lastName: "Latine",
    licenseNumber: "SCAN-TEST-001",
    eventId: EVENT_LATIN,
    bib: 101,
  },
  {
    id: "seed-scan-user-2",
    email: "scan2@test.com",
    firstName: "Test",
    lastName: "Standard",
    licenseNumber: "SCAN-TEST-002",
    eventId: EVENT_STD,
    bib: 102,
  },
];

async function main() {
  // (1) Bannière d'expiration : licence du compte licencié → J+20.
  const beta = await prisma.user.findUnique({
    where: { email: BETA_EMAIL },
    select: { id: true },
  });
  if (beta) {
    const soon = new Date();
    soon.setDate(soon.getDate() + 20);
    const lic = await prisma.license.findFirst({
      where: { userId: beta.id },
      select: { id: true },
    });
    if (lic) {
      await prisma.license.update({
        where: { id: lic.id },
        data: { validUntil: soon },
      });
    } else {
      // Pas de licence rattachée → on en crée une (sinon ni bannière ni n° de
      // licence sur la carte). Numéro dédié, rattaché au compte de démo.
      await prisma.license.upsert({
        where: { number: "BETA-EXPIRY-TEST" },
        update: { userId: beta.id, validUntil: soon },
        create: {
          number: "BETA-EXPIRY-TEST",
          validUntil: soon,
          category: "Ten Dance",
          clubName: "Club de test",
          userId: beta.id,
        },
      });
    }
    console.warn(
      `Licence ${BETA_EMAIL} → expire le ${soon.toISOString().slice(0, 10)} (bannière).`,
    );
  } else {
    console.warn(`ℹ️  ${BETA_EMAIL} introuvable — bannière sautée.`);
  }

  // (2) Compétition ACTIVE = datée d'aujourd'hui (midi, heure locale serveur).
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  await prisma.competition.upsert({
    where: { id: COMP_ID },
    update: { date: today, status: "LIVE" },
    create: {
      id: COMP_ID,
      ffdId: "SEED-CHECKIN-ACTIVE",
      title: "Compétition de test (check-in)",
      date: today,
      location: "Lyon",
      city: "Lyon",
      status: "LIVE",
    },
  });

  for (const [id, category] of [
    [EVENT_LATIN, "Latin"],
    [EVENT_STD, "Standard"],
  ] as const) {
    await prisma.event.upsert({
      where: { id },
      update: { category, ageGroup: "Adult", level: "International" },
      create: {
        id,
        competitionId: COMP_ID,
        category,
        ageGroup: "Adult",
        level: "International",
      },
    });
  }

  // 2 licenciés factices + inscriptions confirmées (droits payés) → scan OK.
  for (const u of SCAN_USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { firstName: u.firstName, lastName: u.lastName },
      create: {
        id: u.id,
        email: u.email,
        // Compte non connectable (cible de scan uniquement) : hash factice.
        password: "seed-checkin-not-a-real-hash",
        firstName: u.firstName,
        lastName: u.lastName,
        role: "LICENSEE",
        category: u.eventId === EVENT_LATIN ? "Latin" : "Standard",
        ageGroup: "Adult",
      },
    });

    await prisma.license.upsert({
      where: { number: u.licenseNumber },
      update: { userId: u.id, validUntil: new Date("2027-12-31") },
      create: {
        number: u.licenseNumber,
        validUntil: new Date("2027-12-31"),
        category: "Ten Dance",
        clubName: "Club de test",
        userId: u.id,
      },
    });

    await prisma.registration.upsert({
      where: { id: `seed-checkin-reg-${u.id}` },
      update: { status: "CONFIRMED", feePaid: true, bibNumber: u.bib },
      create: {
        id: `seed-checkin-reg-${u.id}`,
        eventId: u.eventId,
        userId: u.id,
        status: "CONFIRMED",
        feePaid: true,
        bibNumber: u.bib,
        partnerName: "Partenaire Démo",
        coupleAgeGroup: "Adult",
        coupleDisciplineLatin: u.eventId === EVENT_LATIN,
      },
    });
  }

  console.warn(
    "Check-in test seed: compétition active + 2 licenciés inscrits (QR seed-scan-user-1/2).",
  );
}

main()
  .catch((e) => {
    console.error("Check-in test seed failed (non-fatal):", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
