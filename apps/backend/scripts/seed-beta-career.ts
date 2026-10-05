/**
 * Seed de données de CARRIÈRE pour un bêta-testeur — staging/beta uniquement.
 *
 * Peuple compétitions + épreuves + inscriptions + résultats rattachés au compte
 * du testeur, pour visualiser le rendu des écrans Profil / Carrière (qui sont
 * vides tant qu'aucune inscription/résultat n'existe).
 *
 * Nécessite que le testeur se soit DÉJÀ inscrit (la licence doit être réclamée,
 * cf. seed-beta-testers.ts). Sinon on saute (rien à rattacher).
 *
 * Idempotent : IDs fixes → upsert (relançable à chaque démarrage sans doublon).
 * Lancé au boot (docker-entrypoint.sh) si SEED_TEST_TRACKS=true — jamais en prod.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BETA_EMAIL = "beta@test.com"; // compte de démo bêta

async function main() {
  const betaUser = await prisma.user.findUnique({
    where: { email: BETA_EMAIL },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!betaUser) {
    console.warn(
      `ℹ️  Career seed skipped: compte ${BETA_EMAIL} introuvable (créer le compte d'abord).`,
    );
    return;
  }
  const userId = betaUser.id;
  // getResultsForUser ne renvoie un résultat que si result.details.participant
  // contient le nom du licencié → on doit le renseigner.
  const participant =
    `${betaUser.firstName} ${betaUser.lastName}`.trim() || "Beta Testeur";

  // 1) Compétitions (passées) — upsert par ffdId (unique) via id fixe.
  const competitions = [
    {
      id: "seed-eva-comp-1",
      ffdId: "SEED-BETA-CAREER-1",
      title: "Open International de Lyon",
      date: new Date("2026-03-15T09:00:00Z"),
      location: "Lyon",
      city: "Lyon",
    },
    {
      id: "seed-eva-comp-2",
      ffdId: "SEED-BETA-CAREER-2",
      title: "Championnat Régional AURA",
      date: new Date("2025-11-22T09:00:00Z"),
      location: "Grenoble",
      city: "Grenoble",
    },
  ];
  for (const c of competitions) {
    await prisma.competition.upsert({
      where: { id: c.id },
      update: {
        title: c.title,
        date: c.date,
        location: c.location,
        city: c.city,
        status: "PAST",
      },
      create: {
        id: c.id,
        ffdId: c.ffdId,
        title: c.title,
        date: c.date,
        location: c.location,
        city: c.city,
        status: "PAST",
      },
    });
  }

  // 2) Épreuves (Latines + Standards, Adulte, niveau International).
  const events = [
    {
      id: "seed-eva-ev-1",
      competitionId: "seed-eva-comp-1",
      category: "Latin",
    },
    {
      id: "seed-eva-ev-2",
      competitionId: "seed-eva-comp-1",
      category: "Standard",
    },
    {
      id: "seed-eva-ev-3",
      competitionId: "seed-eva-comp-2",
      category: "Latin",
    },
  ];
  for (const e of events) {
    await prisma.event.upsert({
      where: { id: e.id },
      update: {
        category: e.category,
        ageGroup: "Adult",
        level: "International",
      },
      create: {
        id: e.id,
        competitionId: e.competitionId,
        category: e.category,
        ageGroup: "Adult",
        level: "International",
      },
    });
  }

  // 3) Inscriptions (confirmées) du testeur.
  const registrations = [
    { id: "seed-eva-reg-1", eventId: "seed-eva-ev-1", bibNumber: 42 },
    { id: "seed-eva-reg-2", eventId: "seed-eva-ev-2", bibNumber: 42 },
    { id: "seed-eva-reg-3", eventId: "seed-eva-ev-3", bibNumber: 17 },
  ];
  for (const r of registrations) {
    await prisma.registration.upsert({
      where: { id: r.id },
      update: { status: "CONFIRMED", bibNumber: r.bibNumber },
      create: {
        id: r.id,
        eventId: r.eventId,
        userId,
        status: "CONFIRMED",
        bibNumber: r.bibNumber,
        partnerName: "Partenaire Démo",
        coupleAgeGroup: "Adult",
        coupleDisciplineLatin: true,
      },
    });
  }

  // 4) Résultats (classements) — avec le nombre total de participants ("Xe sur Y").
  const results = [
    {
      id: "seed-eva-res-1",
      eventId: "seed-eva-ev-1",
      round: "Finale",
      ranking: 2,
      total: 15,
    },
    {
      id: "seed-eva-res-2",
      eventId: "seed-eva-ev-2",
      round: "Finale",
      ranking: 4,
      total: 18,
    },
    {
      id: "seed-eva-res-3",
      eventId: "seed-eva-ev-3",
      round: "Finale",
      ranking: 1,
      total: 12,
    },
  ];
  for (const res of results) {
    const details = { participant, totalParticipants: res.total };
    await prisma.result.upsert({
      where: { id: res.id },
      update: { round: res.round, ranking: res.ranking, details },
      create: {
        id: res.id,
        eventId: res.eventId,
        userId,
        round: res.round,
        ranking: res.ranking,
        details,
      },
    });
  }

  // 5) Partenariats : 1 couple ACTIF + 2 anciens (endDate renseigné → historique,
  // isCurrent=false). Chacun a besoin d'un club + d'un 2e licencié.
  const demoClub = await prisma.club.upsert({
    where: { name: "Club Démo Bêta" },
    update: {},
    create: { name: "Club Démo Bêta" },
  });

  const partnerships = [
    {
      id: "seed-eva-partnership-1",
      email: "partner-demo@test.com",
      firstName: "Léa",
      lastName: "Martin",
      startDate: new Date("2024-01-01"),
      endDate: null as Date | null,
    },
    {
      id: "seed-eva-partnership-2",
      email: "partner-old1@test.com",
      firstName: "Camille",
      lastName: "Rousseau",
      startDate: new Date("2021-09-01"),
      endDate: new Date("2023-06-30"),
    },
    {
      id: "seed-eva-partnership-3",
      email: "partner-old2@test.com",
      firstName: "Hugo",
      lastName: "Lefèvre",
      startDate: new Date("2019-01-01"),
      endDate: new Date("2021-08-31"),
    },
  ];

  for (const p of partnerships) {
    const partnerUser = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        email: p.email,
        password: "seed-no-login",
        firstName: p.firstName,
        lastName: p.lastName,
        role: "LICENSEE",
        clubName: demoClub.name,
        clubId: demoClub.id,
      },
    });
    await prisma.partnership.upsert({
      where: { id: p.id },
      update: { status: "ACTIVE", startDate: p.startDate, endDate: p.endDate },
      create: {
        id: p.id,
        clubId: demoClub.id,
        user1Id: userId,
        user2Id: partnerUser.id,
        status: "ACTIVE",
        startDate: p.startDate,
        endDate: p.endDate,
      },
    });
  }

  console.warn(
    `✅ Career seed: ${competitions.length} compétitions, ${registrations.length} inscriptions, ${results.length} résultats, ${partnerships.length} partenariats (1 actif + 2 anciens) pour ${BETA_EMAIL}.`,
  );
}

main()
  .catch((e) => {
    console.error("Career seed failed (non-fatal):", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
