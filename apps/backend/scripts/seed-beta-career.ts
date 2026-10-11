/**
 * Seed de données de CARRIÈRE du compte de validation des stores
 * (`isStoreReview`, licensee@test.com) — staging/beta uniquement.
 *
 * Peuple compétitions + épreuves + inscriptions + résultats rattachés à ce
 * compte, pour que les relecteurs App Store / Google Play voient les écrans
 * Profil / Carrière remplis. Ce seed visait autrefois le compte de démo
 * beta@test.com, supprimé avec les autres comptes de test
 * (purge-test-accounts.ts) ; les partenariats de démo (qui exigeaient des
 * comptes partenaires factices et le « Club Démo Bêta ») ont disparu avec eux.
 *
 * Nécessite que le compte existe (seed-profile-test-accounts.ts, lancé avant).
 * Sinon on saute (rien à rattacher).
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

async function main() {
  const reviewUser = await prisma.user.findFirst({
    where: { isStoreReview: true },
    select: { id: true, email: true, firstName: true, lastName: true },
    orderBy: { createdAt: "asc" },
  });
  if (!reviewUser) {
    console.warn(
      "ℹ️  Career seed skipped: compte de validation des stores introuvable (seed-profile-test-accounts d'abord).",
    );
    return;
  }
  const userId = reviewUser.id;
  // getResultsForUser ne renvoie un résultat que si result.details.participant
  // contient le nom du licencié → on doit le renseigner.
  const participant =
    `${reviewUser.firstName} ${reviewUser.lastName}`.trim() || "Beta Testeur";

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
      update: { userId, status: "CONFIRMED", bibNumber: r.bibNumber },
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
      update: { userId, round: res.round, ranking: res.ranking, details },
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

  console.warn(
    `✅ Career seed: ${competitions.length} compétitions, ${registrations.length} inscriptions, ${results.length} résultats pour ${reviewUser.email}.`,
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
