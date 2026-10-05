/**
 * Seed de pistes de TEST (bibliothèque musique) — 100 % royalty-free.
 *
 * Génère, pour chaque danse de compétition (Latines + Standard), une piste
 * "métronome" : un clic court à chaque temps, au tempo réel de la danse. L'audio
 * est SYNTHÉTISÉ par ffmpeg (aucune musique protégée téléchargée), ce qui est
 * légalement sûr et réellement utile pour tester l'app (browsing par danse,
 * lecteur audio, curseur de tempo/MPM).
 *
 * Idempotent ET auto-réparant : relancé à chaque démarrage du conteneur, il
 * (a) recrée la ligne Track seulement si elle manque, et (b) s'assure TOUJOURS
 * que le mp3 local existe. Container Apps a un disque éphémère : au redémarrage
 * le dossier `uploads/` est vidé alors que les lignes en base survivent. Sans
 * réparation, la lecture casserait (fichier 404). On restaure donc le fichier
 * depuis le Blob (rapide) s'il y est, sinon on le régénère via ffmpeg.
 *
 * Playabilité : le lecteur de la bibliothèque côté client construit l'URL audio
 * via `STATIC_BASE_URL/uploads/<filename>` (servi par ServeStaticModule depuis
 * `<cwd>/uploads`). On écrit donc TOUJOURS le mp3 dans le dossier `uploads/`
 * local (chemin servi par /uploads/*), et EN PLUS on l'uploade vers le conteneur
 * blob "tracks" quand le stockage blob est activé (chemin /tracks/download/:token
 * utilisé par le flux d'ajout). Le blob et le disque portent exactement le même
 * nom que la valeur stockée dans `Track.filename`, donc les deux chemins
 * résolvent la piste, et le Blob sert de source durable pour ré-hydrater le
 * disque local après un redémarrage.
 *
 * Lancé au démarrage du conteneur (docker-entrypoint.sh) UNIQUEMENT si
 * SEED_TEST_TRACKS=true — jamais en prod. Un échec ne bloque pas le démarrage.
 */
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, TrackStatus } from "@prisma/client";
import { spawn } from "child_process";
import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Artiste sentinelle : sert de marqueur d'idempotence + passe LIBRARY_WHERE. */
const TEST_ARTIST = "FFD Test";

interface DanceSeed {
  /** Danse telle que stockée dans Track.style (label reconnu par BpmService/danceTempo). */
  style: string;
  /** Titre affiché dans la bibliothèque. */
  title: string;
  /** Tempo brut réel de la danse en BPM (temps/minute) — pilote le métronome. */
  rawBpm: number;
  /** Temps par mesure (pour convertir BPM → MPM, comme STYLE_CONFIG du backend). */
  beatsPerMeasure: number;
  /** Fréquence du clic (Hz) — un timbre distinct par danse, purement esthétique. */
  clickHz: number;
}

/**
 * Tempos alignés sur STYLE_CONFIG (apps/backend/src/tracks/bpm.service.ts) et
 * danceTempo.ts côté client : rawBpm = centre de la plage de compétition,
 * MPM = round(rawBpm / beatsPerMeasure).
 */
const DANCES: DanceSeed[] = [
  // --- Danses Latines ---
  {
    style: "Samba",
    title: "Métronome Samba (test)",
    rawBpm: 104,
    beatsPerMeasure: 2,
    clickHz: 880,
  },
  {
    style: "Cha-cha",
    title: "Métronome Cha-cha (test)",
    rawBpm: 124,
    beatsPerMeasure: 4,
    clickHz: 988,
  },
  {
    style: "Rumba",
    title: "Métronome Rumba (test)",
    rawBpm: 104,
    beatsPerMeasure: 4,
    clickHz: 1047,
  },
  {
    style: "Paso Doble",
    title: "Métronome Paso Doble (test)",
    rawBpm: 120,
    beatsPerMeasure: 2,
    clickHz: 1175,
  },
  {
    style: "Jive",
    title: "Métronome Jive (test)",
    rawBpm: 172,
    beatsPerMeasure: 4,
    clickHz: 1319,
  },
  // --- Danses Standard ---
  {
    style: "Valse Lente",
    title: "Métronome Valse Lente (test)",
    rawBpm: 87,
    beatsPerMeasure: 3,
    clickHz: 784,
  },
  {
    style: "Tango",
    title: "Métronome Tango (test)",
    rawBpm: 128,
    beatsPerMeasure: 4,
    clickHz: 831,
  },
  {
    style: "Valse Viennoise",
    title: "Métronome Valse Viennoise (test)",
    rawBpm: 174,
    beatsPerMeasure: 3,
    clickHz: 1397,
  },
  {
    style: "Slow Fox",
    title: "Métronome Slow Fox (test)",
    rawBpm: 116,
    beatsPerMeasure: 4,
    clickHz: 698,
  },
  {
    style: "Quickstep",
    title: "Métronome Quickstep (test)",
    rawBpm: 200,
    beatsPerMeasure: 4,
    clickHz: 1568,
  },
];

/** MPM (mesures/minute) — la valeur "tempo" affichée dans l'UI danse. */
function mpm(dance: DanceSeed): number {
  return Math.round(dance.rawBpm / dance.beatsPerMeasure);
}

/** Nom de fichier/blob stable et sûr pour une danse (== Track.filename). */
function blobName(dance: DanceSeed): string {
  const slug = dance.style
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // enlève les accents (diacritiques combinants)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `ffd-test-metronome-${slug}.mp3`;
}

/**
 * Génère un mp3 métronome (~45 s) : un clic sinusoïdal court sur chaque temps
 * au BPM de la danse. Réalisé 100 % avec ffmpeg via `-f lavfi`.
 *
 * Commande (par ex. Samba 104 BPM → beatInterval 0.5769 s, clic 880 Hz) :
 *   ffmpeg -y -f lavfi -i "sine=frequency=880:duration=45" \
 *     -af "aeval=val(0)*exp(-30*mod(t\,0.5769)):c=same,volume=2" \
 *     -ar 44100 -ac 1 -b:a 128k <out>.mp3
 *
 * `beatInterval = 60 / rawBpm` (s). L'enveloppe exp(-DECAY * phase-dans-le-temps)
 * fait décroître le son juste après chaque temps → un "tic" de métronome net et
 * percussif, quasi-silence entre les temps. `volume=2` ramène le clic à un
 * niveau confortablement audible (la sine lavfi sort atténuée).
 */
function generateMetronomeMp3(
  dance: DanceSeed,
  outPath: string,
): Promise<void> {
  const durationSec = 45;
  const beatInterval = (60 / dance.rawBpm).toFixed(4);
  // Constante de décroissance : e-pli sur ~33 ms → tic court et percussif.
  const decay = 30;
  // `||` implicite : une valeur vide "" doit aussi retomber sur "ffmpeg".
  const ffmpegPath =
    process.env.FFMPEG_PATH != null && process.env.FFMPEG_PATH !== ""
      ? process.env.FFMPEG_PATH
      : "ffmpeg";

  // Les virgules sont des séparateurs d'arguments dans les filtres ffmpeg :
  // on les échappe (\,) à l'intérieur des expressions aeval/mod/exp.
  const filter = `aeval=val(0)*exp(-${decay}*mod(t\\,${beatInterval})):c=same,volume=2`;

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${dance.clickHz}:duration=${durationSec}`,
    "-af",
    filter,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-b:a",
    "128k",
    outPath,
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve();
      } else {
        reject(
          new Error(
            `ffmpeg exited with code ${code ?? "null"} for ${dance.style}: ${stderr.slice(-500)}`,
          ),
        );
      }
    });
  });
}

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
  console.warn("🎵 [seed-test-tracks] Start");

  // 1. Dossier de sortie : le dossier `uploads/` servi par ServeStaticModule
  //    (rootPath = <cwd>/uploads). C'est ce chemin (/uploads/<filename>) que le
  //    lecteur de la bibliothèque utilise pour jouer une piste.
  const uploadsDir = path.join(process.cwd(), "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  // 2. Blob (conteneur "tracks") — activé sur staging/prod ; null en local.
  const blobService = makeBlobClient();
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "tracks";
  const containerClient = blobService
    ? blobService.getContainerClient(containerName)
    : null;
  console.warn(
    `🎵 [seed-test-tracks] Blob storage: ${
      containerClient
        ? `enabled (container "${containerName}")`
        : "disabled (local uploads only)"
    }`,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffd-metronome-"));
  let createdRows = 0;
  let restoredFiles = 0;
  let generatedFiles = 0;

  for (const dance of DANCES) {
    const filename = blobName(dance);
    const localPath = path.join(uploadsDir, filename);
    const tmpPath = path.join(tmpDir, filename);

    try {
      // 3a. S'assure que le mp3 local existe (auto-réparation post-restart).
      if (!fs.existsSync(localPath)) {
        const block = containerClient?.getBlockBlobClient(filename);
        // Restaure depuis le Blob si présent (rapide, pas de ffmpeg).
        if (block && (await block.exists())) {
          await block.downloadToFile(localPath);
          restoredFiles++;
        } else {
          // Sinon régénère via ffmpeg, puis pousse vers le Blob (source durable).
          await generateMetronomeMp3(dance, tmpPath);
          fs.copyFileSync(tmpPath, localPath);
          if (block) {
            await block.uploadFile(tmpPath);
          }
          generatedFiles++;
        }
      }

      // 3b. Crée la ligne Track SEULEMENT si elle manque : status READY (passe
      //     LIBRARY_WHERE), artiste sentinelle, style = danse, bpm = MPM.
      const row = await prisma.track.findFirst({
        where: { artist: TEST_ARTIST, filename },
        select: { id: true },
      });
      if (!row) {
        await prisma.track.create({
          data: {
            title: dance.title,
            artist: TEST_ARTIST,
            filename,
            style: dance.style,
            bpm: mpm(dance),
            rawBpm: dance.rawBpm,
            status: TrackStatus.READY,
            titleMasked: false,
            blacklisted: false,
          },
        });
        createdRows++;
      }

      console.warn(
        `   ✓ ${dance.style}: ${filename} (rawBpm=${dance.rawBpm}, MPM=${mpm(dance)})`,
      );
    } catch (err) {
      // Échec par danse : on log et on continue (best-effort).
      console.warn(
        `   ⚠ ${dance.style}: skipped — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* best effort */
        }
      }
    }
  }

  try {
    fs.rmdirSync(tmpDir);
  } catch {
    /* best effort */
  }

  console.warn(
    `🎵 [seed-test-tracks] Done — ${createdRows} row(s) created, ` +
      `${generatedFiles} file(s) generated, ${restoredFiles} restored from blob ` +
      `(of ${DANCES.length} dances).`,
  );
}

main()
  .catch((e: unknown) => {
    console.error("[seed-test-tracks] fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
