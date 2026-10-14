/**
 * Seed de licences pour les BÊTA-TESTEURS — staging/beta uniquement.
 *
 * Le flux d'inscription (`POST /auth/register`) exige qu'une licence FFD existe
 * déjà en base, non réclamée et valide, pour rattacher le compte. La base
 * staging ne contient pas les licences FFD réelles ; sans ce seed, un testeur
 * qui saisit son vrai numéro obtient "Numéro de licence introuvable".
 *
 * On insère donc, pour chaque testeur, une licence NON réclamée (userId null).
 * Le testeur s'inscrit ensuite normalement dans l'app avec son email + mot de
 * passe → register la rattache.
 *
 * Idempotent ET sûr : ne touche JAMAIS une licence déjà rattachée à un compte
 * (userId non null), hormis la réparation #555 ci-dessous. On ne stocke que le
 * strict nécessaire (numéro/catégorie/club) — pas d'email ni de date de
 * naissance (RGPD).
 *
 * Catégorie (#555) : la discipline du testeur est inconnue, la licence porte
 * donc une catégorie « placeholder » qui n'est pas une discipline — jamais
 * « Ten Dance », que l'inscription recopiait dans le profil (le testeur était
 * alors déclaré pratiquant Latines ET Standards). Les licences bêta créées
 * avant le correctif sont réparées au démarrage, profils compris
 * (`repairBetaLicenseCategories`).
 *
 * Lancé au démarrage du conteneur (docker-entrypoint.sh) UNIQUEMENT si
 * SEED_TEST_TRACKS=true — jamais en prod. Un échec ne bloque pas le démarrage.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  betaLicensesFromEnv,
  repairBetaLicenseCategories,
} from "./seed-beta-testers.utils";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Les numéros de licence des testeurs NE SONT PAS dans le code : ils encodent
 * la date de naissance (AAAAMMJJ-…) et le dépôt est destiné à être public.
 * Ils vivent dans la config de la Container App staging :
 *   BETA_TESTER_LICENSES="20010101-abc-de12,19990202-fgh-ij34"
 * Pour un nouveau testeur, BETA_AUTO_LICENSE=true suffit le plus souvent
 * (licence créée à l'inscription) ; cette liste ne sert qu'à pré-seeder.
 */
async function main() {
  const BETA_LICENSES = betaLicensesFromEnv(process.env.BETA_TESTER_LICENSES);

  // Toujours, même sans liste : couvre aussi les licences auto-créées (#555).
  const repaired = await repairBetaLicenseCategories(
    prisma,
    BETA_LICENSES.map((lic) => lic.number),
  );
  if (repaired.licenses > 0) {
    console.warn(
      `Beta licenses repair (#555): ${repaired.licenses} licence(s) remise(s) en catégorie inconnue, ${repaired.users} profil(s) « Ten Dance » remis à vide.`,
    );
  }

  if (BETA_LICENSES.length === 0) {
    console.warn("Beta licenses seed skipped: BETA_TESTER_LICENSES vide.");
    return;
  }

  let upserted = 0;
  let claimed = 0;

  for (const lic of BETA_LICENSES) {
    const existing = await prisma.license.findUnique({
      where: { number: lic.number },
      select: { userId: true },
    });

    // Déjà rattachée à un compte : on ne clobbe rien.
    if (existing?.userId) {
      claimed++;
      continue;
    }

    await prisma.license.upsert({
      where: { number: lic.number },
      update: {
        validUntil: lic.validUntil,
        category: lic.category,
        clubName: lic.clubName,
      },
      create: {
        number: lic.number,
        validUntil: lic.validUntil,
        category: lic.category,
        clubName: lic.clubName,
      },
    });
    upserted++;
  }

  console.warn(
    `Beta licenses seed: ${upserted} prête(s), ${claimed} déjà rattachée(s).`,
  );
}

main()
  .catch((e) => {
    console.error("Beta licenses seed failed (non-fatal):", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
