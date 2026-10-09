/* eslint-disable @typescript-eslint/triple-slash-reference, @typescript-eslint/ban-ts-comment, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/prefer-nullish-coalescing */
/// <reference path="./types.d.ts" />
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { fullName, SEED_COUPLE } from "./seed-owner-couple";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PASSWORD = "password123";

// ---- Helpers (tracks) ----
async function analyzeBpm(filePath: string): Promise<number> {
  try {
    const MusicTempo = await import("music-tempo");
    const WavDecoder = await import("wav-decoder");
    const ffmpegModule = require("fluent-ffmpeg");
    const ffmpeg = ffmpegModule.default || ffmpegModule;
    const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
    ffmpeg.setFfmpegPath(ffmpegPath);

    const tempWav = filePath.replace(/\.[^.]+$/, ".temp.wav");

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .setStartTime(30)
        .setDuration(30)
        .toFormat("wav")
        .save(tempWav)
        .on("end", async () => {
          try {
            const buffer = fs.readFileSync(tempWav);
            // @ts-ignore
            const audioData = await WavDecoder.default.decode(buffer);

            // MusicTempo default export handling
            const MT = MusicTempo.default || MusicTempo;
            // @ts-ignore
            const tempo = new MT(audioData.channelData[0]);

            fs.unlinkSync(tempWav);
            resolve(parseFloat(tempo.tempo));
          } catch (err) {
            if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
            reject(err);
          }
        })
        .on("error", (err: unknown) => {
          if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
          reject(err);
        });
    });
  } catch (error) {
    console.warn(`Failed to analyze BPM for ${filePath}:`, error);
    return 0;
  }
}

function parseFilename(filename: string): {
  title: string;
  artist: string;
  style: string;
  hintBpm: number;
} {
  // Regex Parsing (Same as TracksService)
  const regex =
    /^(\d+-)?(.*?)\s*[|｜]\s*(.*?)\s*-\s*(.*?)(?:\((\d+)\s*(?:BPM|MPM)?\))?\.mp3$/i;
  const match = filename.match(regex);

  let artist = "Unknown";
  let title = filename.replace(/\.[^/.]+$/, "").replace(/^\d+-/, "");
  let detectedStyle = "Unknown";
  let hintBpm = 0;

  if (match) {
    detectedStyle = match[2].trim().toUpperCase();
    artist = match[3].trim();
    title = match[4].trim();
    if (match[5]) {
      hintBpm = parseInt(match[5], 10);
    }
  }

  return { title, artist, style: detectedStyle, hintBpm };
}

function resolveBpm(
  filename: string,
  rawBpm: number,
  explicitStyle?: string,
  hintBpm?: number,
): { bpm: number; calculatedMpm: number; usedHint: boolean } {
  // Determine Multiplier based on Style (same logic as TracksService)
  const styleToUse = explicitStyle
    ? explicitStyle.toLowerCase()
    : filename.toLowerCase();
  let multiplier = 4; // Default

  if (styleToUse.match(/valse|waltz|viennoise|viennese/i)) {
    multiplier = 3;
  } else if (styleToUse.match(/samba|paso/i)) {
    multiplier = 2;
  } else if (
    styleToUse.match(/cha-cha|rapido|rumba|jive|tango|fox|quickstep/i)
  ) {
    multiplier = 4;
  }

  // Calculate MPM from raw audio BPM (same as TracksService)
  const calculatedMpm = rawBpm > 0 ? Math.round(rawBpm / multiplier) : 0;

  // Resolve final BPM (same logic as TracksService)
  if (hintBpm && hintBpm > 0) {
    let targetMpm = hintBpm;
    // If hint is large (> 70), convert to MPM
    if (targetMpm > 70) {
      targetMpm = Math.round(targetMpm / multiplier);
    }

    // Verification: check if calculated MPM matches hint (tolerance: 3)
    if (calculatedMpm > 0 && Math.abs(calculatedMpm - targetMpm) <= 3) {
      console.warn(
        `     Verified: Audio ${calculatedMpm} matches Hint ${targetMpm}`,
      );
    } else if (calculatedMpm > 0) {
      console.warn(
        `     Mismatch: Audio ${calculatedMpm} vs Hint ${targetMpm}. Using Hint.`,
      );
    }

    return { bpm: targetMpm, calculatedMpm, usedHint: true };
  }

  // No hint: use calculated MPM from audio analysis
  return { bpm: calculatedMpm, calculatedMpm, usedHint: false };
}

// (scraping types and license number helpers are now defined in sync-licensees-from-compete script)

async function main() {
  console.warn("🌱 Starting Advanced Seed...");

  // 1. CLEAN DB
  console.warn("🧹 Clearing database...");
  try {
    await prisma.bugReport.deleteMany();
    await prisma.scheduleItem.deleteMany();
    await prisma.result.deleteMany();
    await prisma.registration.deleteMany();
    await prisma.event.deleteMany();
    await prisma.competition.deleteMany();
    await prisma.track.deleteMany();
    await prisma.license.deleteMany();
    await prisma.user.deleteMany();
  } catch (e) {
    console.warn("⚠️ Cleanup warning:", e);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // 2. Test accounts (admin, E2E licensee, club, staff) are NOT created
  // here any more: `pnpm --filter backend seed:e2e` (prisma/seed-e2e.ts) owns
  // them, with the exact profiles the Maestro flows log in with.

  // 2.6 CLUB CVDS (Club Villeurbannais de Danse Sportive) — pour le couple de dev (voir seed-owner-couple.ts)
  const CVDS_NAME = "Club Villeurbannais de Danse Sportive";
  console.warn("🏢 Ensuring Club CVDS exists...");
  let cvds = await prisma.club.findFirst({
    where: { name: { equals: CVDS_NAME, mode: "insensitive" } },
  });
  if (!cvds) {
    cvds = await prisma.club.create({
      data: { name: CVDS_NAME },
    });
    console.warn("   ✓ Created club:", cvds.name);
  }

  // 2.7 / 2.8 Couple de dev (membres CVDS). Fictional by default; real values
  // can be provided locally through SEED_OWNER_* / SEED_PARTNER_* in .env.
  const { owner, partner } = SEED_COUPLE;

  console.warn(`👤 Creating dev couple leader ${fullName(owner)} (CVDS)...`);
  const ownerUser = await prisma.user.upsert({
    where: { email: owner.email },
    update: {
      clubId: cvds.id,
      clubName: CVDS_NAME,
      category: owner.category,
      ageGroup: "Adult",
      birthDate: new Date(owner.birthDate),
    },
    create: {
      email: owner.email,
      password: passwordHash,
      firstName: owner.firstName,
      lastName: owner.lastName,
      role: UserRole.LICENSEE,
      clubId: cvds.id,
      clubName: CVDS_NAME,
      category: owner.category,
      ageGroup: "Adult",
      birthDate: new Date(owner.birthDate),
    },
  });

  await prisma.license.upsert({
    where: { number: owner.licenseNumber },
    update: { category: owner.category, clubName: CVDS_NAME },
    create: {
      number: owner.licenseNumber,
      validUntil: new Date("2026-08-31"),
      category: owner.category,
      clubName: CVDS_NAME,
      userId: ownerUser.id,
    },
  });

  console.warn(
    `👤 Creating dev couple follower ${fullName(partner)} (CVDS)...`,
  );
  const partnerUser = await prisma.user.upsert({
    where: { email: partner.email },
    update: {
      clubId: cvds.id,
      clubName: CVDS_NAME,
      category: partner.category,
      ageGroup: "Adult",
      birthDate: new Date(partner.birthDate),
    },
    create: {
      email: partner.email,
      password: passwordHash,
      firstName: partner.firstName,
      lastName: partner.lastName,
      role: UserRole.LICENSEE,
      clubId: cvds.id,
      clubName: CVDS_NAME,
      category: partner.category,
      ageGroup: "Adult",
      birthDate: new Date(partner.birthDate),
    },
  });

  await prisma.license.upsert({
    where: { number: partner.licenseNumber },
    update: { category: partner.category, clubName: CVDS_NAME },
    create: {
      number: partner.licenseNumber,
      validUntil: new Date("2026-08-31"),
      category: partner.category,
      clubName: CVDS_NAME,
      userId: partnerUser.id,
    },
  });
  console.warn(
    `   ✓ Couple de dev CVDS: ${fullName(owner)} + ${fullName(partner)}`,
  );

  // 2.9 Compte organisateur CVDS (pour voir les membres depuis l’app club)
  await prisma.user.upsert({
    where: { email: "direction@cvds.com" },
    update: { clubId: cvds.id, clubName: CVDS_NAME },
    create: {
      email: "direction@cvds.com",
      password: passwordHash,
      firstName: "Direction",
      lastName: "CVDS",
      role: UserRole.CLUB,
      clubId: cvds.id,
      clubName: CVDS_NAME,
    },
  });
  console.warn("   ✓ Organisateur CVDS: direction@cvds.com");

  // 2.10 SEED TRACKS FROM UPLOADS DIRECTORY
  console.warn("🎵 Seeding tracks from uploads directory...");
  const uploadsDir = path.join(__dirname, "../uploads");
  if (fs.existsSync(uploadsDir)) {
    const files = fs
      .readdirSync(uploadsDir)
      .filter((f) => f.endsWith(".mp3") || f.endsWith(".m4a"));

    if (files.length > 0) {
      let addedCount = 0;
      let skippedCount = 0;
      let analyzedCount = 0;
      let failedAnalysisCount = 0;

      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        // Check if track already exists (by filename - should be unique)
        const existing = await prisma.track.findFirst({
          where: { filename: file },
        });

        // Parse filename to extract metadata
        const { title, artist, style, hintBpm } = parseFilename(file);

        // Analyze audio BPM (same process as TracksService)
        let bpm = 0;
        let rawBpm = 0;
        try {
          console.warn(`   Analyzing audio BPM for ${file}...`);
          rawBpm = await analyzeBpm(filePath);
          if (rawBpm > 0) {
            analyzedCount++;
            console.warn(`   Raw Analysis Result: ${rawBpm}`);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn(`   BPM Analysis Failed: ${errorMessage}`);
          failedAnalysisCount++;
        }

        // Resolve BPM logic (same as TracksService)
        const {
          bpm: resolvedBpm,
          calculatedMpm,
          usedHint,
        } = resolveBpm(file, rawBpm, style, hintBpm);
        bpm = resolvedBpm;

        // Log results
        if (rawBpm > 0) {
          console.warn(
            `   ✓ ${file}: Raw BPM=${rawBpm}, Calculated MPM=${calculatedMpm}, Final MPM=${bpm}, Style=${style}${usedHint ? " (used hint)" : ""}`,
          );
        } else {
          // Fallback to default if analysis failed
          if (bpm === 0) {
            bpm = 30; // Default fallback
          }
          console.warn(
            `   ⚠ ${file}: Analysis failed, using ${usedHint ? "hint" : "fallback"} BPM=${bpm}`,
          );
        }

        // Check for artwork
        const fileBaseName = file.replace(/\.[^/.]+$/, "");
        let artworkFilename: string | null = null;
        const potentialArtwork = `${fileBaseName}.jpg`;
        if (fs.existsSync(path.join(uploadsDir, potentialArtwork))) {
          artworkFilename = potentialArtwork;
        } else {
          const files = fs.readdirSync(uploadsDir);
          const found = files.find(
            (f) =>
              f.startsWith(fileBaseName) && f.match(/\.(jpg|jpeg|png|webp)$/i),
          );
          if (found) {
            artworkFilename = found;
          }
        }

        if (existing) {
          // Update existing track if needed
          let needsUpdate = false;
          const updateData: {
            bpm?: number;
            artist?: string;
            style?: string | null;
            title?: string;
            artwork?: string | null;
          } = {};

          // Update BPM if different
          if (Math.abs(existing.bpm - bpm) > 0.1 && bpm > 0) {
            console.warn(`   ↻ Updating BPM: ${existing.bpm} -> ${bpm}`);
            updateData.bpm = Math.round(bpm);
            needsUpdate = true;
          }

          // Update metadata if different
          if (existing.artist !== artist) {
            updateData.artist = artist;
            needsUpdate = true;
          }
          if (existing.style !== (style !== "Unknown" ? style : null)) {
            updateData.style = style !== "Unknown" ? style : null;
            needsUpdate = true;
          }
          if (existing.title !== title) {
            updateData.title = title;
            needsUpdate = true;
          }

          // Update artwork if missing
          if (!existing.artwork && artworkFilename) {
            console.warn(`   ↻ Updating Artwork: ${artworkFilename}`);
            updateData.artwork = artworkFilename;
            needsUpdate = true;
          }

          if (needsUpdate) {
            await prisma.track.update({
              where: { id: existing.id },
              data: updateData,
            });
            console.warn(`   ✓ Updated: ${file}`);
            addedCount++;
          } else {
            skippedCount++;
          }
        } else {
          // Create new track
          try {
            await prisma.track.create({
              data: {
                title: title,
                artist: artist,
                filename: file,
                style: style !== "Unknown" ? style : null,
                bpm: bpm > 0 ? Math.round(bpm) : 30,
                artwork: artworkFilename,
              },
            });
            addedCount++;
          } catch (error: unknown) {
            // Handle potential duplicate filename error
            const err = error as { code?: string; message?: string };
            if (
              err.code === "P2002" ||
              err.message?.includes("Unique constraint")
            ) {
              console.warn(
                `   ⚠ ${file}: Track with this filename already exists, skipping.`,
              );
              skippedCount++;
            } else {
              throw error;
            }
          }
        }
      }

      console.warn(
        `   - Added ${addedCount} tracks, skipped ${skippedCount} (already exist).`,
      );
      console.warn(
        `   - BPM Analysis: ${analyzedCount} successful, ${failedAnalysisCount} failed.`,
      );
    } else {
      console.warn("   - No audio files found in uploads directory.");
    }
  } else {
    console.warn(`   - Uploads directory does not exist at ${uploadsDir}`);
  }

  // 3. SEED COMPETITIONS (realistic upcoming competitions in Auvergne-Rhône-Alpes)
  console.warn("🏆 Seeding competitions...");

  const competitions = [
    {
      title: "Championnat Régional AURA Latines",
      date: new Date("2026-06-14T09:00:00+02:00"),
      location: "Gymnase Léo Lagrange, Villeurbanne",
      address: "30 Rue Léo Lagrange, 69100 Villeurbanne",
      city: "Villeurbanne",
      zipCode: "69100",
      latitude: 45.7676,
      longitude: 4.8843,
      status: "UPCOMING" as const,
      competitionType: "MAJEURE" as const,
      majorSubType: "CHAMPIONNAT_REGIONAL",
      organizer: CVDS_NAME,
      registrationDeadline: new Date("2026-06-07T23:59:00+02:00"),
      description:
        "Championnat régional Auvergne-Rhône-Alpes en danses latines. Toutes classes d'âge.",
      events: [
        { category: "Latin", ageGroup: "Junior", level: "Intermédiaire" },
        { category: "Latin", ageGroup: "Adult", level: "Intermédiaire" },
        { category: "Latin", ageGroup: "Adult", level: "Avancé" },
        { category: "Latin", ageGroup: "Senior", level: "Open" },
      ],
    },
    {
      title: "Open de Lyon - Standard & Latines",
      date: new Date("2026-07-05T10:00:00+02:00"),
      location: "Palais des Sports de Gerland, Lyon",
      address: "350 Avenue Jean Jaurès, 69007 Lyon",
      city: "Lyon",
      zipCode: "69007",
      latitude: 45.7275,
      longitude: 4.8277,
      status: "UPCOMING" as const,
      competitionType: "NATIONALE" as const,
      organizer: "Lyon Danse Sportive",
      registrationDeadline: new Date("2026-06-28T23:59:00+02:00"),
      description:
        "Grand Open de Lyon réunissant les meilleurs couples Standard et Latines de France.",
      events: [
        { category: "Standard", ageGroup: "Adult", level: "Avancé" },
        { category: "Latin", ageGroup: "Adult", level: "Avancé" },
        { category: "Ten Dance", ageGroup: "Adult", level: "Open" },
        {
          category: "Standard",
          ageGroup: "Junior",
          level: "Intermédiaire",
        },
        { category: "Latin", ageGroup: "Junior", level: "Intermédiaire" },
      ],
    },
    {
      title: "Compétition de Proximité Grenoble",
      date: new Date("2026-05-24T14:00:00+02:00"),
      location: "Salle Polyvalente, Grenoble",
      address: "12 Boulevard Gambetta, 38000 Grenoble",
      city: "Grenoble",
      zipCode: "38000",
      latitude: 45.1885,
      longitude: 5.7245,
      status: "UPCOMING" as const,
      competitionType: "PROXIMITE" as const,
      organizer: "Grenoble Danse Club",
      registrationDeadline: new Date("2026-05-17T23:59:00+02:00"),
      description:
        "Compétition de proximité ouverte aux débutants et intermédiaires. Ambiance conviviale.",
      events: [
        { category: "Latin", ageGroup: "Adult", level: "Débutant" },
        { category: "Standard", ageGroup: "Adult", level: "Débutant" },
        { category: "Latin", ageGroup: "Adult", level: "Intermédiaire" },
        {
          category: "Standard",
          ageGroup: "Adult",
          level: "Intermédiaire",
        },
      ],
    },
    {
      title: "Coupe de France Latines",
      date: new Date("2026-09-20T08:30:00+02:00"),
      location: "Halle Tony Garnier, Lyon",
      address: "20 Place Docteurs Charles et Christophe Mérieux, 69007 Lyon",
      city: "Lyon",
      zipCode: "69007",
      latitude: 45.7311,
      longitude: 4.8247,
      status: "UPCOMING" as const,
      competitionType: "MAJEURE" as const,
      majorSubType: "COUPE_DE_FRANCE",
      organizer: "Fédération Française de Danse",
      registrationDeadline: new Date("2026-09-06T23:59:00+02:00"),
      description:
        "Coupe de France de danses latines. Qualification via les championnats régionaux.",
      events: [
        { category: "Latin", ageGroup: "Junior", level: "International" },
        { category: "Latin", ageGroup: "Adult", level: "International" },
        { category: "Latin", ageGroup: "Adult", level: "Avancé" },
        { category: "Latin", ageGroup: "Senior", level: "International" },
      ],
    },
    {
      title: "Gala & Compétition Saint-Étienne",
      date: new Date("2026-06-28T15:00:00+02:00"),
      location: "Salle Jeanne d'Arc, Saint-Étienne",
      address: "5 Rue Jeanne d'Arc, 42000 Saint-Étienne",
      city: "Saint-Étienne",
      zipCode: "42000",
      latitude: 45.4397,
      longitude: 4.3872,
      status: "UPCOMING" as const,
      competitionType: "PROXIMITE" as const,
      organizer: "Stéphanois Danse Club",
      registrationDeadline: new Date("2026-06-21T23:59:00+02:00"),
      description:
        "Compétition de proximité suivie d'un gala de démonstration. Ouvert à tous les niveaux.",
      events: [
        { category: "Latin", ageGroup: "Adult", level: "Débutant" },
        { category: "Standard", ageGroup: "Adult", level: "Débutant" },
        {
          category: "Show Danse",
          ageGroup: "Adult",
          eventKind: "SHOW_DANSE" as const,
        },
      ],
    },
  ];

  for (const comp of competitions) {
    const { events, ...compData } = comp;
    const created = await prisma.competition.create({
      data: compData,
    });

    for (const event of events) {
      await prisma.event.create({
        data: {
          competitionId: created.id,
          category: event.category,
          ageGroup: event.ageGroup,
          level: "level" in event ? event.level : null,
          eventKind: "eventKind" in event ? event.eventKind : "CLASSIFICATRICE",
        },
      });
    }
    console.warn(`   ✓ ${comp.title} (${comp.city}, ${events.length} events)`);
  }

  // Register the dev couple to the first competition (Championnat Régional)
  const regComp = await prisma.competition.findFirst({
    where: { title: { contains: "Championnat Régional" } },
    include: { events: true },
  });
  if (regComp) {
    const adultLatin = regComp.events.find(
      (e) => e.category === "Latin" && e.ageGroup === "Adult",
    );
    if (adultLatin) {
      await prisma.registration.create({
        data: {
          eventId: adultLatin.id,
          userId: ownerUser.id,
          partnerName: fullName(partner),
          partnerUserId: partnerUser.id,
          status: "CONFIRMED",
          bibNumber: 42,
        },
      });
      console.warn(
        "   ✓ Registered couple de dev to Championnat Régional (Latin Adult)",
      );
    }
  }

  console.warn("\n✅ Seed (bootstrap) completed.");
  console.warn(
    "   To load compete results (licenciés, clubs, compétitions), run:\n   pnpm run sync:compete -- --scrape\n",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
