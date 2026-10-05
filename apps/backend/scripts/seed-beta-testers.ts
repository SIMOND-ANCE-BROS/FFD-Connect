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
 * (userId non null). On ne stocke que le strict nécessaire (numéro/catégorie/
 * club) — pas d'email ni de date de naissance (RGPD).
 *
 * Lancé au démarrage du conteneur (docker-entrypoint.sh) UNIQUEMENT si
 * SEED_TEST_TRACKS=true — jamais en prod. Un échec ne bloque pas le démarrage.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface BetaLicense {
  number: string;
  category: string;
  clubName: string;
  validUntil: Date;
}

const DEFAULT_CATEGORY = "Ten Dance";
const DEFAULT_CLUB_NAME = "Club Villeurbannais de Danse Sportive";
const DEFAULT_VALID_UNTIL = new Date("2026-12-31");

/**
 * Les numéros de licence des testeurs NE SONT PAS dans le code : ils encodent
 * la date de naissance (AAAAMMJJ-…) et le dépôt est destiné à être public.
 * Ils vivent dans la config de la Container App staging :
 *   BETA_TESTER_LICENSES="20010101-abc-de12,19990202-fgh-ij34"
 * Pour un nouveau testeur, BETA_AUTO_LICENSE=true suffit le plus souvent
 * (licence créée à l'inscription) ; cette liste ne sert qu'à pré-seeder.
 */
function betaLicensesFromEnv(): BetaLicense[] {
  return (process.env.BETA_TESTER_LICENSES ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .map((number) => ({
      number,
      category: DEFAULT_CATEGORY,
      clubName: DEFAULT_CLUB_NAME,
      validUntil: DEFAULT_VALID_UNTIL,
    }));
}

async function main() {
  const BETA_LICENSES = betaLicensesFromEnv();
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
