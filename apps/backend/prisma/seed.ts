/**
 * Seed script — populates demo data for beta testing.
 *
 * Usage:
 *   npx tsx prisma/seed.ts
 *
 * Idempotent: uses upsert on unique fields, safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding demo data...\n");

  // ──────────────────────────────────────────────
  // 1. Licenses (pre-loaded, no user linked yet)
  // ──────────────────────────────────────────────
  const licenses = [
    {
      number: "FFD-2025-00001",
      validUntil: new Date("2026-08-31"),
      category: "Latin",
      clubName: "Paris Danse Club",
    },
    {
      number: "FFD-2025-00002",
      validUntil: new Date("2026-08-31"),
      category: "Standard",
      clubName: "Paris Danse Club",
    },
    {
      number: "FFD-2025-00003",
      validUntil: new Date("2026-08-31"),
      category: "Ten Dance",
      clubName: "Lyon Danse Sportive",
    },
    {
      number: "FFD-2025-00004",
      validUntil: new Date("2026-08-31"),
      category: "Latin",
      clubName: "Marseille Latin Club",
    },
    {
      number: "FFD-2025-00005",
      validUntil: new Date("2026-08-31"),
      category: "Standard",
      clubName: "Bordeaux Ballroom",
    },
    {
      number: "FFD-2025-00006",
      validUntil: new Date("2025-09-30"), // Expired — for testing expiry warning
      category: "Latin",
      clubName: "Toulouse Danse",
    },
    {
      number: "FFD-2025-00007",
      validUntil: new Date("2026-05-15"), // Expires soon — for testing 30-day warning
      category: "Standard",
      clubName: "Nice Danse Elegance",
    },
  ];

  for (const lic of licenses) {
    await prisma.license.upsert({
      where: { number: lic.number },
      update: {
        validUntil: lic.validUntil,
        category: lic.category,
        clubName: lic.clubName,
      },
      create: lic,
    });
  }
  console.log(`✓ ${licenses.length} licenses seeded`);

  // ──────────────────────────────────────────────
  // 2. Competitions (upcoming, with deadlines + locations)
  // ──────────────────────────────────────────────
  const now = new Date();
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);

  const competitions = [
    {
      title: "Championnat Régional Île-de-France",
      date: daysFromNow(21),
      registrationDeadline: daysFromNow(10),
      location: "Palais des Sports, Paris",
      city: "Paris",
      address: "1 Place de la Porte de Versailles, 75015 Paris",
      zipCode: "75015",
      latitude: 48.8323,
      longitude: 2.2867,
      organizer: "Comité Régional IdF",
      competitionType: "MAJEURE" as const,
      majorSubType: "CHAMPIONNAT_REGIONAL",
      description:
        "Championnat régional qualificatif pour le Championnat de France. Épreuves classificatrices Latines et Standard toutes catégories.",
      status: "UPCOMING" as const,
    },
    {
      title: "Open de Lyon — Latines & Standard",
      date: daysFromNow(35),
      registrationDeadline: daysFromNow(25),
      location: "Halle Tony Garnier, Lyon",
      city: "Lyon",
      address: "20 Place Antonin Perrin, 69007 Lyon",
      zipCode: "69007",
      latitude: 45.7326,
      longitude: 4.8251,
      organizer: "Lyon Danse Sportive",
      competitionType: "NATIONALE" as const,
      description:
        "Open national. Épreuves open Latines et Standard, Solo Danse Team, Show Danse.",
      status: "UPCOMING" as const,
    },
    {
      title: "Compétition de Proximité Marseille",
      date: daysFromNow(7),
      registrationDeadline: daysFromNow(2), // 2 days — will show red countdown
      location: "Gymnase Vallier, Marseille",
      city: "Marseille",
      address: "37 Boulevard Philippon, 13004 Marseille",
      zipCode: "13004",
      latitude: 43.3118,
      longitude: 5.3953,
      organizer: "Marseille Latin Club",
      competitionType: "PROXIMITE" as const,
      description:
        "Compétition de proximité ouverte à tous les niveaux. Ambiance conviviale.",
      status: "UPCOMING" as const,
    },
    {
      title: "Gala de Danse Bordeaux",
      date: daysFromNow(45),
      registrationDeadline: daysFromNow(30),
      location: "Palais de la Bourse, Bordeaux",
      city: "Bordeaux",
      address: "17 Place de la Bourse, 33000 Bordeaux",
      zipCode: "33000",
      latitude: 44.8412,
      longitude: -0.5706,
      organizer: "Bordeaux Ballroom",
      competitionType: "PROXIMITE" as const,
      description:
        "Soirée gala avec démonstrations et épreuves amicales. Ouvert aux débutants.",
      status: "UPCOMING" as const,
    },
    {
      title: "Coupe de France de Danse Sportive",
      date: daysFromNow(60),
      registrationDeadline: daysFromNow(45),
      location: "AccorHotels Arena, Paris",
      city: "Paris",
      address: "8 Boulevard de Bercy, 75012 Paris",
      zipCode: "75012",
      latitude: 48.8388,
      longitude: 2.3786,
      organizer: "Fédération Française de Danse",
      competitionType: "MAJEURE" as const,
      majorSubType: "COUPE_DE_FRANCE",
      description:
        "La Coupe de France rassemble les meilleurs danseurs de toutes les régions. Épreuves classificatrices et finales nationales.",
      status: "UPCOMING" as const,
    },
  ];

  for (const comp of competitions) {
    const existing = await prisma.competition.findFirst({
      where: { title: comp.title },
    });
    if (!existing) {
      const created = await prisma.competition.create({ data: comp });
      // Add 2 events per competition
      await prisma.event.createMany({
        data: [
          {
            competitionId: created.id,
            category: "Latin",
            ageGroup: "Adultes",
            eventType: "COUPLE",
            eventKind: "CLASSIFICATRICE",
            level: "D",
          },
          {
            competitionId: created.id,
            category: "Standard",
            ageGroup: "Adultes",
            eventType: "COUPLE",
            eventKind: "CLASSIFICATRICE",
            level: "D",
          },
        ],
      });
    }
  }
  console.log(
    `✓ ${competitions.length} competitions seeded (with 2 events each)`,
  );

  // ──────────────────────────────────────────────
  // 3. Summary
  // ──────────────────────────────────────────────
  const licCount = await prisma.license.count();
  const compCount = await prisma.competition.count();
  const eventCount = await prisma.event.count();
  console.log(
    `\nDatabase totals: ${licCount} licenses, ${compCount} competitions, ${eventCount} events`,
  );
  console.log(
    "\nDone. Beta testers can now register with license numbers FFD-2025-00001 through FFD-2025-00007.",
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
