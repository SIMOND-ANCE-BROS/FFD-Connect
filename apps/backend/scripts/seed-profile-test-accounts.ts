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
 * RENOMMAGE, jamais recréation : seul un compte portant le drapeau
 * `isStoreReview` est mis à jour (un compte non marqué qui détient l'email
 * cible est un CONFLIT : erreur, rien écrit — jamais d'élévation d'un compte
 * tiers). Le compte retenu est celui que garde la purge du boot
 * (pickStoreReviewAccount) ; s'il existe plusieurs comptes marqués, le seed le
 * signale (log par id + `process.exitCode = 1`, #473) sans toucher aux
 * doublons. L'ancien `licensee@test.com` n'est plus recherché par email : non
 * marqué, c'est un compte de test ordinaire que la purge supprime. Email et noms ne sont réécrits qu'à la
 * migration depuis l'ancien email (une modification faite ensuite depuis le
 * back-office n'est pas écrasée à chaque boot) ; l'id, les données de carrière
 * et les sessions survivent. Idem pour le club (renommé s'il porte encore
 * l'ancien nom). Un conflit d'unicité sur le nom de club est loggué
 * (`process.exitCode = 1`) sans bloquer le compte.
 *
 * Son mot de passe suit le secret PROFILE_TEST_PASSWORD (variable
 * d'environnement de staging, connue des stores). Rotation : changer le secret
 * du serveur et redémarrer — ce seed réaligne le hash au boot et révoque les refresh tokens du compte — puis mettre à
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
import { storedEmailData } from "../src/auth/email-identity";
import {
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
} from "./purge-test-accounts.utils";
import {
  STORE_REVIEW_CLUB_LOOKUP_NAMES,
  STORE_REVIEW_FIRST_NAME,
  STORE_REVIEW_LAST_NAME,
  formatDuplicateStoreReviewAccounts,
  pickStoreReviewClub,
  planClubRename,
  planPasswordUpdate,
  planUserRename,
  resolveStoreReviewAccount,
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
      ...storedEmailData(STORE_REVIEW_EMAIL),
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

/**
 * Finds (or creates) the club and renames it in place. A name conflict is
 * reported (exitCode 1) but the club keeps its name: the account work goes on.
 */
async function ensureClub(): Promise<{ id: string; name: string }> {
  // Retrouvé par drapeau d'abord (un admin a pu le renommer depuis le
  // back-office), sinon par nom (nouveau de préférence, puis ancien).
  const rows = await prisma.club.findMany({
    where: {
      OR: [
        { isStoreReview: true },
        { name: { in: [...STORE_REVIEW_CLUB_LOOKUP_NAMES] } },
      ],
    },
    select: { id: true, name: true, isStoreReview: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  const existing = pickStoreReviewClub(rows);
  if (!existing) {
    return prisma.club.create({
      data: { name: STORE_REVIEW_CLUB_NAME, isStoreReview: true },
      select: { id: true, name: true },
    });
  }
  const nameHolder = rows.find((c) => c.name === STORE_REVIEW_CLUB_NAME);
  const plan = planClubRename(existing, nameHolder ?? null);
  if (!plan.ok) fail(plan.error);
  return prisma.club.update({
    where: { id: existing.id },
    data: {
      ...(plan.ok ? plan.data : {}),
      isStoreReview: true,
      disabledAt: null,
    },
    select: { id: true, name: true },
  });
}

async function main() {
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { isStoreReview: true },
        { email: { equals: STORE_REVIEW_EMAIL, mode: "insensitive" } },
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
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  const decision = resolveStoreReviewAccount(candidates);
  if (decision.kind === "conflict") {
    // Never elevate an unflagged account that merely holds one of the emails.
    fail(
      `unflagged user(s) ${decision.ids.join(", ")} hold the store-review email; nothing written.`,
    );
    return;
  }
  if (decision.kind === "create" && !TEST_PASSWORD) {
    fail(
      `${STORE_REVIEW_EMAIL} is missing and PROFILE_TEST_PASSWORD is not set — account not created.`,
    );
    return;
  }

  const club = await ensureClub();
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

  let user: { id: string } | null;
  if (decision.kind === "update") {
    const existing = decision.user;
    if (decision.duplicateIds.length > 0) {
      fail(
        formatDuplicateStoreReviewAccounts(existing.id, decision.duplicateIds),
      );
    }
    const rename = planUserRename(existing, decision.emailHolder);
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
    const data = { ...profile, ...rename.data };
    if (rotate && TEST_PASSWORD) {
      // Hash + session revocation in ONE transaction: old credentials die.
      const password = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);
      const [updated] = await prisma.$transaction([
        prisma.user.update({
          where: { id: existing.id },
          data: { ...data, password },
          select: { id: true },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: existing.id, revoked: false },
          data: { revoked: true, revokedAt: new Date() },
        }),
      ]);
      user = updated;
      console.log("Store-review account: password rotated, sessions revoked.");
    } else {
      user = await prisma.user.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
    }
    if (Object.keys(rename.data).length > 0) {
      console.log(
        `Store-review account renamed in place (${existing.id}): ${Object.keys(rename.data).join(", ")}`,
      );
    }
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
    `Store-review account seeded: ${user.id} (ADMIN + ${EXTRA_ROLES.join(", ")}, club "${club.name}", license valid until ${LICENSE_VALID_UNTIL.toISOString().slice(0, 10)})`,
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
