/**
 * Seed du COMPTE DE VALIDATION DES STORES — staging uniquement.
 *
 * Un seul compte de test subsiste sur staging : `licensee@test.com`, donné aux
 * équipes de validation App Store Connect / Google Play (les builds TestFlight
 * et Play visent backend-staging). Il est :
 * - ADMIN en rôle principal, avec TOUS les autres rôles en `extraRoles`
 *   (multi-profil, lot 1c) pour que les relecteurs voient chaque espace ;
 * - rattaché au club « Club Test FFD » (nécessaire au rôle CLUB) ;
 * - marqué `isStoreReview` (lui ET son club) : ses écritures sont SIMULÉES
 *   (StoreReviewInterceptor, réponse 2xx sans écriture en base) et le
 *   back-office refuse de le supprimer ou de le désactiver.
 *
 * Son mot de passe est le secret partagé PROFILE_TEST_PASSWORD (connu des
 * stores) : ne JAMAIS changer l'email ni le mot de passe. Le hash n'est écrit
 * qu'à la création (un compte existant garde son mot de passe).
 *
 * Idempotent (upsert par email). Lancé au démarrage du conteneur
 * (docker-entrypoint.sh) UNIQUEMENT si SEED_TEST_TRACKS=true — jamais en prod —
 * APRÈS purge-test-accounts.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import "dotenv/config";
import { Pool } from "pg";
import {
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
} from "./purge-test-accounts.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 12;
/** Mot de passe partagé du compte de validation (staging). */
const TEST_PASSWORD = process.env.PROFILE_TEST_PASSWORD ?? "TestProfil2026!";
const LICENSE_NUMBER = "TEST-LICENSEE-001";
const CATEGORY = "Latin";
/** La licence doit rester valide pendant toute la durée des validations. */
const LICENSE_VALID_UNTIL = new Date("2030-12-31");

/** ADMIN principal + tous les autres rôles, dans l'ordre de l'enum. */
const MAIN_ROLE = UserRole.ADMIN;
const EXTRA_ROLES = Object.values(UserRole).filter((r) => r !== MAIN_ROLE);

async function main() {
  // Le club du compte : retrouvé par drapeau d'abord (un admin a pu le
  // renommer depuis le back-office), sinon par nom.
  const flaggedClub = await prisma.club.findFirst({
    where: { isStoreReview: true },
    select: { id: true, name: true },
  });
  const club =
    flaggedClub ??
    (await prisma.club.upsert({
      where: { name: STORE_REVIEW_CLUB_NAME },
      update: { isStoreReview: true, disabledAt: null },
      create: { name: STORE_REVIEW_CLUB_NAME, isStoreReview: true },
      select: { id: true, name: true },
    }));
  if (flaggedClub) {
    await prisma.club.update({
      where: { id: club.id },
      data: { disabledAt: null },
      select: { id: true },
    });
  }

  const profile = {
    role: MAIN_ROLE,
    extraRoles: EXTRA_ROLES,
    clubId: club.id,
    clubName: club.name,
    category: CATEGORY,
    ageGroup: "Adulte",
    isStoreReview: true,
    // Un compte de validation désactivé = rejet du store.
    disabledAt: null,
  };
  const user = await prisma.user.upsert({
    where: { email: STORE_REVIEW_EMAIL },
    update: profile,
    create: {
      email: STORE_REVIEW_EMAIL,
      password: await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS),
      firstName: "Test",
      lastName: "Licencié",
      ...profile,
    },
    select: { id: true },
  });

  // Licence rattachée (écran E-Licence, QR, Wallet), valide longtemps.
  await prisma.license.upsert({
    where: { number: LICENSE_NUMBER },
    update: {
      userId: user.id,
      validUntil: LICENSE_VALID_UNTIL,
      clubName: club.name,
    },
    create: {
      number: LICENSE_NUMBER,
      category: CATEGORY,
      clubName: club.name,
      validUntil: LICENSE_VALID_UNTIL,
      userId: user.id,
    },
  });

  console.log(
    `Store-review account seeded: ${STORE_REVIEW_EMAIL} (ADMIN + ${EXTRA_ROLES.join(", ")}, club "${club.name}", license valid until ${LICENSE_VALID_UNTIL.toISOString().slice(0, 10)})`,
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
