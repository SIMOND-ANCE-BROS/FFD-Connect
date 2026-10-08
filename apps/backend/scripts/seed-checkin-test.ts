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
 * (3) Simule le direct de cette compétition (aperçu de la fonctionnalité) :
 *     un timing complet de la journée (ScheduleItem), un retard estimé et des
 *     résultats publiés (Result) pour les inscrits et des couples fictifs —
 *     quarts/demies/finale en Latines, demi-finale en Standard (finale à venir).
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

  // (3) Direct simulé : timing de la journée + résultats publiés.
  await seedLiveSimulation(today);
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
async function seedLiveSimulation(day: Date): Promise<void> {
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
  // confondues) → le libellé porte l'épreuve. Les inscrits « Test Latine » /
  // « Test Standard » y figurent pour visualiser LEURS résultats.
  const perEvent: Array<{
    eventId: string;
    registrant: (typeof SCAN_USERS)[number];
    results: DemoResult[];
  }> = [
    {
      eventId: EVENT_LATIN,
      registrant: SCAN_USERS[0],
      results: [
        ...round("Latines — Quart de finale", 8, 6),
        ...round("Latines — Demi-finale", 6, 4),
        ...round("Latines — Finale", 4),
      ],
    },
    {
      eventId: EVENT_STD,
      registrant: SCAN_USERS[1],
      results: [
        ...round("Standard — Quart de finale", 8, 6),
        ...round("Standard — Demi-finale", 6, 4),
      ],
    },
  ];
  for (const ev of perEvent) {
    const names = [
      `${ev.registrant.firstName} ${ev.registrant.lastName} & Partenaire Démo`,
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
          ? ev.registrant.id
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
