/**
 * Seed des COMPTES DE TEST par rôle — staging uniquement.
 *
 * Permet le « switch de profil » côté client (preview) : le testeur se reconnecte
 * instantanément en LICENSEE / CLUB / STAFF / ADMIN pour tester les
 * fonctionnalités de chaque rôle AVEC de vraies données (le backend voit le
 * vrai rôle du JWT).
 *
 * Idempotent (upsert par email). Lancé au démarrage du conteneur
 * (docker-entrypoint.sh) UNIQUEMENT si SEED_TEST_TRACKS=true — jamais en prod.
 * Le mot de passe partagé est connu du bundle PREVIEW uniquement (voir
 * src/features/settings/utils/profileSwitch.ts, gated APP_ENV==="preview").
 *
 * ⚠️ Ces comptes n'existent que sur staging (seed non lancé en prod). Ne pas
 * réutiliser ce mot de passe ailleurs.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 12;
/** Mot de passe partagé des comptes de test (staging). Connu du bundle preview. */
const TEST_PASSWORD = process.env.PROFILE_TEST_PASSWORD ?? "TestProfil2026!";
const CLUB_NAME = "Club Test FFD";

interface TestAccount {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  clubName?: string;
  category?: string;
  ageGroup?: string;
}

const ACCOUNTS: TestAccount[] = [
  {
    email: "licensee@test.com",
    firstName: "Test",
    lastName: "Licencié",
    role: UserRole.LICENSEE,
    clubName: CLUB_NAME,
    category: "Latin",
    ageGroup: "Adulte",
  },
  {
    email: "club@test.com",
    firstName: "Test",
    lastName: "Club",
    role: UserRole.CLUB,
    clubName: CLUB_NAME,
  },
  {
    email: "staff@test.com",
    firstName: "Test",
    lastName: "Staff",
    role: UserRole.STAFF,
  },
  {
    email: "admin@test.com",
    firstName: "Test",
    lastName: "Admin",
    role: UserRole.ADMIN,
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);

  // Le compte CLUB a besoin d'un Club (nom unique) pour un espace club non vide.
  await prisma.club.upsert({
    where: { name: CLUB_NAME },
    update: {},
    create: { name: CLUB_NAME },
  });
  const club = await prisma.club.findUnique({
    where: { name: CLUB_NAME },
    select: { id: true },
  });

  let count = 0;
  for (const acc of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: acc.email },
      update: {
        role: acc.role,
        firstName: acc.firstName,
        lastName: acc.lastName,
        clubName: acc.clubName ?? null,
        clubId: acc.role === "CLUB" ? (club?.id ?? null) : null,
        category: acc.category ?? null,
        ageGroup: acc.ageGroup ?? null,
      },
      create: {
        email: acc.email,
        password: passwordHash,
        role: acc.role,
        firstName: acc.firstName,
        lastName: acc.lastName,
        clubName: acc.clubName ?? null,
        clubId: acc.role === "CLUB" ? (club?.id ?? null) : null,
        category: acc.category ?? null,
        ageGroup: acc.ageGroup ?? null,
      },
      select: { id: true },
    });

    // Le licencié a besoin d'une licence rattachée pour l'écran E-Licence.
    if (acc.role === "LICENSEE") {
      const licenseNumber = "TEST-LICENSEE-001";
      await prisma.license.upsert({
        where: { number: licenseNumber },
        update: { userId: user.id },
        create: {
          number: licenseNumber,
          category: acc.category ?? "Latin",
          clubName: CLUB_NAME,
          validUntil: new Date("2026-12-31"),
          userId: user.id,
        },
      });
    }
    count++;
  }

  console.log(
    `Profile test accounts seeded: ${count} (password gated preview)`,
  );
}

main()
  .catch((e) => {
    console.error("seed-profile-test-accounts failed:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
