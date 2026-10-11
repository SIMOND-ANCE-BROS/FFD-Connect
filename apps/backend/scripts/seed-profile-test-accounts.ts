/**
 * Seed du COMPTE DE VALIDATION DES STORES — staging uniquement.
 *
 * Un seul compte de test subsiste sur staging : `demo@ffd.gabin-simond.fr`
 * (« Compte Démo »), donné aux équipes de validation App Store Connect /
 * Google Play (les builds TestFlight et Play visent backend-staging). Il est :
 * - ADMIN en rôle principal, avec TOUS les autres rôles en `extraRoles`
 *   (multi-profil, lot 1c) pour que les relecteurs voient chaque espace ;
 * - rattaché au club « Club Démo FFD Connect » (nécessaire au rôle CLUB) ;
 * - marqué `isStoreReview` (lui ET son club) : ses écritures sont SIMULÉES
 *   (StoreReviewInterceptor, réponse 2xx sans écriture en base) et le
 *   back-office refuse de le supprimer ou de le désactiver.
 *
 * RENOMMAGE, jamais recréation : le compte est retrouvé par drapeau
 * `isStoreReview`, puis par le nouvel email, puis par l'ancien
 * (`licensee@test.com`) ; email et noms sont mis à jour en place, donc l'id, les
 * données de carrière et les sessions des relecteurs survivent. Idem pour le
 * club. Un conflit d'unicité (email ou nom de club déjà pris) est loggué et
 * met `process.exitCode = 1` sans rien casser.
 *
 * Son mot de passe suit le secret PROFILE_TEST_PASSWORD (variable
 * d'environnement de staging, connue des stores). Rotation : changer le secret
 * du serveur et redémarrer — ce seed réaligne le hash au boot — puis mettre à
 * jour App Store Connect ET Play Console le MÊME jour. Sans la variable, un
 * compte existant reste intact et un compte absent n'est pas créé.
 *
 * Idempotent. Lancé au démarrage du conteneur (docker-entrypoint.sh)
 * UNIQUEMENT si SEED_TEST_TRACKS=true — jamais en prod — APRÈS
 * purge-test-accounts.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import "dotenv/config";
import { Pool } from "pg";
import {
  LEGACY_STORE_REVIEW_EMAIL,
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
} from "./purge-test-accounts.utils";
import {
  STORE_REVIEW_CLUB_LOOKUP_NAMES,
  STORE_REVIEW_FIRST_NAME,
  STORE_REVIEW_LAST_NAME,
  pickStoreReviewUser,
  planClubRename,
  planPasswordUpdate,
  planUserRename,
} from "./seed-profile-test-accounts.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 12;
/**
 * Mot de passe partagé du compte de validation : variable d'environnement
 * UNIQUEMENT (secret de la Container App staging), jamais de valeur par défaut
 * dans le dépôt (public). Sert à créer le compte ET à réaligner son hash.
 */
const TEST_PASSWORD = process.env.PROFILE_TEST_PASSWORD?.trim();
const LICENSE_NUMBER = "TEST-LICENSEE-001";
const CATEGORY = "Latin";
/** La licence doit rester valide pendant toute la durée des validations. */
const LICENSE_VALID_UNTIL = new Date("2030-12-31");

/** ADMIN principal + tous les autres rôles, dans l'ordre de l'enum. */
const MAIN_ROLE = UserRole.ADMIN;
const EXTRA_ROLES = Object.values(UserRole).filter((r) => r !== MAIN_ROLE);

async function createAccount(
  profile: Omit<
    Prisma.UserUncheckedCreateInput,
    "email" | "password" | "firstName" | "lastName"
  >,
): Promise<{ id: string } | null> {
  if (!TEST_PASSWORD) {
    console.error(
      `seed-profile-test-accounts: ${STORE_REVIEW_EMAIL} is missing and PROFILE_TEST_PASSWORD is not set — account not created.`,
    );
    process.exitCode = 1;
    return null;
  }
  return prisma.user.create({
    data: {
      email: STORE_REVIEW_EMAIL,
      password: await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS),
      firstName: STORE_REVIEW_FIRST_NAME,
      lastName: STORE_REVIEW_LAST_NAME,
      ...profile,
    },
    select: { id: true },
  });
}

function fail(message: string): void {
  console.error(`seed-profile-test-accounts: ${message}`);
  process.exitCode = 1;
}

/** Finds (or creates) the club, renaming it in place. null = conflict. */
async function ensureClub(): Promise<{ id: string; name: string } | null> {
  // Retrouvé par drapeau d'abord (un admin a pu le renommer depuis le
  // back-office), sinon par nom (nouveau ou ancien).
  const flagged = await prisma.club.findFirst({
    where: { isStoreReview: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const existing =
    flagged ??
    (await prisma.club.findFirst({
      where: { name: { in: [...STORE_REVIEW_CLUB_LOOKUP_NAMES] } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }));
  if (!existing) {
    return prisma.club.create({
      data: { name: STORE_REVIEW_CLUB_NAME, isStoreReview: true },
      select: { id: true, name: true },
    });
  }
  const nameHolder = await prisma.club.findUnique({
    where: { name: STORE_REVIEW_CLUB_NAME },
    select: { id: true },
  });
  const plan = planClubRename(existing, nameHolder);
  if (!plan.ok) {
    fail(plan.error);
    return null;
  }
  return prisma.club.update({
    where: { id: existing.id },
    data: { ...plan.data, isStoreReview: true, disabledAt: null },
    select: { id: true, name: true },
  });
}

async function main() {
  const club = await ensureClub();
  if (!club) return;

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
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { isStoreReview: true },
        {
          email: {
            in: [STORE_REVIEW_EMAIL, LEGACY_STORE_REVIEW_EMAIL],
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isStoreReview: true,
      password: true,
    },
    take: 10,
  });
  const existing = pickStoreReviewUser(candidates);

  let user: { id: string } | null;
  if (existing) {
    const emailHolder = candidates.find(
      (c) => c.email.trim().toLowerCase() === STORE_REVIEW_EMAIL,
    );
    const rename = planUserRename(existing, emailHolder ?? null);
    if (!rename.ok) {
      fail(rename.error);
      return;
    }
    // The password follows the server secret (never logged).
    const secretMatches = TEST_PASSWORD
      ? await bcrypt.compare(TEST_PASSWORD, existing.password)
      : true;
    const rotate =
      planPasswordUpdate(TEST_PASSWORD, secretMatches) === "rotate";
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...profile,
        ...rename.data,
        ...(rotate && TEST_PASSWORD
          ? { password: await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS) }
          : {}),
      },
      select: { id: true },
    });
    if (Object.keys(rename.data).length > 0) {
      console.log(
        `Store-review account renamed in place (${existing.id}): ${Object.keys(rename.data).join(", ")}`,
      );
    }
    if (rotate) console.log("Store-review account: password rotated.");
  } else {
    user = await createAccount(profile);
  }
  if (!user) return;

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
