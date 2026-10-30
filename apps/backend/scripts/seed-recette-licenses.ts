/**
 * États des licences de RECETTE — staging/beta uniquement (#887).
 *
 * Les comptes de recette fictifs de staging s'inscrivent avec une licence
 * auto-créée (BETA_AUTO_LICENSE), valable un an : elle couvre déjà la saison,
 * le renouvellement est refusé comme inutile et aucune licence n'est expirée.
 * Ce seed place UNE SEULE FOIS deux licences de recette dans l'état voulu
 * (`RECETTE_LICENSE_STATES`) : une licence renouvelable et une licence expirée.
 *
 * Une seule fois : dès qu'une demande de renouvellement existe pour le
 * titulaire (brouillon, soumise, validée ou refusée), la licence n'est plus
 * jamais touchée, même aux réveils suivants. Ne crée jamais ni licence ni
 * compte : un numéro absent est un no-op loggé.
 *
 * Lancé au démarrage du conteneur (docker-entrypoint.sh) UNIQUEMENT si
 * SEED_TEST_TRACKS=true — jamais en prod (garde revérifiée ici). Un échec ne
 * bloque pas le démarrage.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import {
  applyRecetteLicenseState,
  isRecetteSeedEnabled,
  RECETTE_LICENSE_STATES,
} from "./seed-recette-licenses.utils";

const TAG = "[seed-recette-licenses]";

async function main(): Promise<void> {
  if (!isRecetteSeedEnabled(process.env.SEED_TEST_TRACKS)) {
    console.warn(`${TAG} skipped: SEED_TEST_TRACKS is not "true".`);
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    for (const target of RECETTE_LICENSE_STATES) {
      const outcome = await applyRecetteLicenseState(prisma, target);
      console.warn(
        `${TAG} ${target.number} → ${target.validUntilDay}: ${outcome}`,
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`${TAG} failed (non-fatal):`, e);
  process.exitCode = 1;
});
