/**
 * Seed de DÉMO « compétition en direct » — staging/beta uniquement.
 *
 * Crée une compétition ACTIVE (datée d'aujourd'hui → renvoyée par
 * GET /competitions/active) + 2 épreuves, y inscrit le compte de validation
 * des stores (`isStoreReview`, licensee@test.com — CONFIRMED, droits payés)
 * et simule le direct : un timing complet de la journée (ScheduleItem), un
 * retard estimé et des résultats publiés (Result) pour ce compte et des
 * couples fictifs — quarts/demies/finale en Latines, demi-finale en Standard
 * (finale à venir).
 *
 * Ce seed créait autrefois 2 licenciés factices (seed-scan-user-1/2, cibles de
 * QR de test) et avançait l'expiration de la licence de beta@test.com : ces
 * comptes de test sont supprimés (purge-test-accounts.ts). Le compte de
 * validation porte désormais les inscriptions ; sa licence reste valide
 * (pas de bannière d'expiration).
 *
 * Idempotent (IDs fixes → upsert). Lancé au boot (docker-entrypoint.sh) si
 * SEED_TEST_TRACKS=true — jamais en prod — après seed-profile-test-accounts.
 * Non-fatal.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const COMP_ID = "seed-checkin-comp";
const EVENT_LATIN = "seed-checkin-ev-latin";
const EVENT_STD = "seed-checkin-ev-standard";

/** Inscriptions du compte de validation (ids fixes hérités du seed d'origine). */
const REVIEW_REGISTRATIONS = [
  { id: "seed-checkin-reg-review-latin", eventId: EVENT_LATIN, bib: 101 },
  { id: "seed-checkin-reg-review-standard", eventId: EVENT_STD, bib: 102 },
];

interface Registrant {
  id: string;
  firstName: string;
  lastName: string;
}

async function main() {
  const reviewer = await prisma.user.findFirst({
    where: { isStoreReview: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: "asc" },
  });
  if (!reviewer) {
    console.warn(
      "ℹ️  Live demo seed skipped: compte de validation des stores introuvable (seed-profile-test-accounts d'abord).",
    );
    return;
  }

  // Compétition ACTIVE = datée d'aujourd'hui (midi, heure locale serveur).
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  await prisma.competition.upsert({
    where: { id: COMP_ID },
    update: { date: today, status: "LIVE", delayMinutes: DEMO_DELAY_MINUTES },
    create: {
      id: COMP_ID,
      ffdId: "SEED-CHECKIN-ACTIVE",
      title: "Compétition de test (check-in)",
      date: today,
      location: "Lyon",
      city: "Lyon",
      status: "LIVE",
      delayMinutes: DEMO_DELAY_MINUTES,
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

  for (const r of REVIEW_REGISTRATIONS) {
    const data = {
      userId: reviewer.id,
      status: "CONFIRMED" as const,
      feePaid: true,
      bibNumber: r.bib,
    };
    await prisma.registration.upsert({
      where: { id: r.id },
      update: data,
      create: {
        id: r.id,
        eventId: r.eventId,
        ...data,
        partnerName: "Partenaire Démo",
        coupleAgeGroup: "Adult",
        coupleDisciplineLatin: r.eventId === EVENT_LATIN,
      },
    });
  }

  console.warn(
    "Live demo seed: compétition active + inscriptions du compte de validation.",
  );

  // Direct simulé : timing de la journée + résultats publiés.
  await seedLiveSimulation(today, reviewer);
}

/** Retard estimé affiché sur la compétition de démo (bandeau + timing). */
const DEMO_DELAY_MINUTES = 10;

/** Couples fictifs (résultats uniquement : Result.userId n'a pas de FK). */
const DEMO_COUPLES = [
  "Hugo Lefèvre & Chloé Garnier",
  "Nathan Rousseau & Léa Fontaine",
  "Louis Girard & Manon Chevalier",
  "Arthur Lambert & Camille Faure",
  "Jules Mercier & Inès Blanc",
  "Gabriel Guérin & Sarah Muller",
  "Raphaël Henry & Jade Roussel",
];

type DemoResult = {
  round: string;
  ranking: number;
  status?: "QUALIFIED" | "ELIMINATED";
  marks?: number;
};

/**
 * Résultats d'un tour : les `qualified` premiers sont QUALIFIÉS, les suivants
 * ÉLIMINÉS (avec un nombre de croix décroissant). Sans `qualified` → finale
 * (classement seul, le client affiche le podium).
 */
function round(label: string, size: number, qualified?: number): DemoResult[] {
  return Array.from({ length: size }, (_, i) => {
    const ranking = i + 1;
    if (qualified === undefined) return { round: label, ranking };
    return ranking <= qualified
      ? { round: label, ranking, status: "QUALIFIED", marks: 12 - i }
      : { round: label, ranking, status: "ELIMINATED", marks: 12 - i };
  });
}

/**
 * Timing + résultats de la compétition de démo. Idempotent (IDs fixes →
 * upsert) et additif : ne touche que des lignes `seed-live-*`.
 */
async function seedLiveSimulation(
  day: Date,
  registrant: Registrant,
): Promise<void> {
  // Horaires en UTC (≈ 9h–19h heure de Paris) : la ligne « maintenant » du
  // timing tombe au milieu du programme pendant la journée.
  const at = (hUtc: number, m = 0): Date => {
    const d = new Date(day);
    d.setUTCHours(hUtc, m, 0, 0);
    return d;
  };
  const schedule: Array<{
    title: string;
    type: string;
    startTime: Date;
    eventId?: string;
  }> = [
    { title: "Accueil & check-in", type: "INFO", startTime: at(7) },
    {
      title: "Latines Adultes — Quart de finale",
      type: "ROUND",
      startTime: at(7, 30),
      eventId: EVENT_LATIN,
    },
    {
      title: "Standard Adultes — Quart de finale",
      type: "ROUND",
      startTime: at(8, 30),
      eventId: EVENT_STD,
    },
    {
      title: "Latines Adultes — Demi-finale",
      type: "ROUND",
      startTime: at(9, 30),
      eventId: EVENT_LATIN,
    },
    { title: "Pause déjeuner", type: "BREAK", startTime: at(10, 30) },
    {
      title: "Standard Adultes — Demi-finale",
      type: "ROUND",
      startTime: at(11, 30),
      eventId: EVENT_STD,
    },
    {
      title: "Latines Adultes — Finale",
      type: "ROUND",
      startTime: at(12, 30),
      eventId: EVENT_LATIN,
    },
    { title: "Show de démonstration", type: "INFO", startTime: at(13, 30) },
    {
      title: "Standard Adultes — Finale",
      type: "ROUND",
      startTime: at(14, 30),
      eventId: EVENT_STD,
    },
    { title: "Remise des prix", type: "CEREMONY", startTime: at(16) },
  ];
  for (const [i, item] of schedule.entries()) {
    const id = `seed-live-schedule-${i + 1}`;
    const data = {
      title: item.title,
      type: item.type,
      startTime: item.startTime,
      eventId: item.eventId ?? null,
    };
    await prisma.scheduleItem.upsert({
      where: { id },
      update: data,
      create: { id, competitionId: COMP_ID, ...data },
    });
  }

  // Résultats publiés. Le client regroupe par `round` (toutes épreuves
  // confondues) → le libellé porte l'épreuve. Le compte de validation y
  // figure pour visualiser SES résultats.
  const perEvent: Array<{
    eventId: string;
    results: DemoResult[];
  }> = [
    {
      eventId: EVENT_LATIN,
      results: [
        ...round("Latines — Quart de finale", 8, 6),
        ...round("Latines — Demi-finale", 6, 4),
        ...round("Latines — Finale", 4),
      ],
    },
    {
      eventId: EVENT_STD,
      results: [
        ...round("Standard — Quart de finale", 8, 6),
        ...round("Standard — Demi-finale", 6, 4),
      ],
    },
  ];
  for (const ev of perEvent) {
    const names = [
      `${registrant.firstName} ${registrant.lastName} & Partenaire Démo`,
      ...DEMO_COUPLES,
    ];
    for (const r of ev.results) {
      // Le même couple garde la même ligne d'un tour à l'autre : le rang 2 du
      // tour suivant est le n°2 qualifié du tour précédent, etc. L'inscrit
      // (index 0 → rang 2) va jusqu'en finale.
      const coupleIndex =
        r.ranking === 2 ? 0 : r.ranking === 1 ? 1 : r.ranking - 1;
      const userId =
        coupleIndex === 0
          ? registrant.id
          : `seed-live-couple-${ev.eventId}-${coupleIndex}`;
      const slug = r.round
        .split("—")[1]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      const id = `seed-live-result-${ev.eventId}-${slug}-${r.ranking}`;
      const details = {
        participant: names[coupleIndex],
        ...(r.status ? { status: r.status, marks: r.marks } : {}),
      };
      await prisma.result.upsert({
        where: { id },
        update: { round: r.round, ranking: r.ranking, userId, details },
        create: {
          id,
          eventId: ev.eventId,
          userId,
          round: r.round,
          ranking: r.ranking,
          details,
        },
      });
    }
  }

  console.warn(
    `Live simulation seed: ${schedule.length} créneaux de timing + résultats (Latines jusqu'en finale, Standard en demi).`,
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
