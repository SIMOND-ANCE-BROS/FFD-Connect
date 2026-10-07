/**
 * Purge des pistes de TEST « métronome » (artiste sentinelle "FFD Test").
 *
 * Ces 10 pistes ffmpeg étaient créées par l'ancien seed `seed-test-tracks` pour
 * remplir la bibliothèque en attendant de la vraie musique. La bibliothèque
 * staging est désormais alimentée par l'outil d'import (track-prep) : les
 * métronomes ne servent plus et polluent les listes par danse.
 *
 * Supprime les lignes Track de l'artiste "FFD Test" ET leur mp3 dans le Blob
 * (conteneur "tracks"). Le disque local `uploads/` est éphémère sur Container
 * Apps, on le nettoie quand même par principe. Idempotent : sans piste à
 * purger, c'est un no-op.
 *
 * Lancé au démarrage du conteneur (docker-entrypoint.sh) UNIQUEMENT si
 * SEED_TEST_TRACKS=true — jamais en prod. Un échec ne bloque pas le démarrage.
 */
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Artiste sentinelle posé par l'ancien seed sur chaque métronome. */
const TEST_ARTIST = "FFD Test";

/**
 * Crée un client Blob si le stockage est configuré (connection string OU
 * managed identity via AZURE_STORAGE_ACCOUNT_NAME). Reproduit la logique de
 * BlobStorageService.isEnabled(). Retourne null si le blob est désactivé.
 */
function makeBlobClient(): BlobServiceClient | null {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (conn) {
    return BlobServiceClient.fromConnectionString(conn);
  }
  if (account) {
    return new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  return null;
}

async function main(): Promise<void> {
  const tracks = await prisma.track.findMany({
    where: { artist: TEST_ARTIST },
    select: { id: true, filename: true },
    take: 100,
  });
  if (tracks.length === 0) {
    console.log("🧹 [purge-test-tracks] Nothing to purge.");
    return;
  }

  const blobService = makeBlobClient();
  const containerClient = blobService
    ? blobService.getContainerClient(
        process.env.AZURE_STORAGE_CONTAINER ?? "tracks",
      )
    : null;
  const uploadsDir = path.join(process.cwd(), "uploads");

  for (const track of tracks) {
    if (track.filename) {
      const filename = path.basename(track.filename);
      try {
        await containerClient?.getBlockBlobClient(filename).deleteIfExists();
        await fs.promises.rm(path.join(uploadsDir, filename), { force: true });
      } catch (error) {
        // Non-fatal : un fichier orphelin ne coûte presque rien, la ligne part quand même.
        console.warn(
          `   ⚠ ${filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const { count } = await prisma.track.deleteMany({
    where: { id: { in: tracks.map((t) => t.id) } },
  });
  console.log(`🧹 [purge-test-tracks] ${count} test track(s) deleted.`);
}

main()
  .catch((error: unknown) => {
    console.error("❌ [purge-test-tracks] Failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
    void pool.end();
  });
