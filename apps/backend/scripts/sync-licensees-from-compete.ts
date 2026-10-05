/**
 * Sync licensees and clubs from compete results (scraped_data.json).
 *
 * Options:
 *   --scrape    Re-scrape data from compete URLs, update scraped_data.json, then sync (sans doublons).
 *
 * - Clears all licensees and clubs EXCEPT: the dev couple (seed-owner-couple.ts) and CVDS.
 * - Loads results from prisma/seeds/scraped_data.json (or from scrape if --scrape).
 *
 * scraped_data.json is deliberately NOT committed (see apps/backend/.gitignore).
 * It holds the names of 865 real dancers, including youth categories (Juv. under
 * 12, Jun. 12-15, Youth 16-18) — i.e. identified minors — collected from a
 * third-party results site. Keeping personal data of that kind under version
 * control is wrong on a private repo and unacceptable on a public one. Run with
 * --scrape to regenerate it locally; the script already exits with a clear
 * message when the file is absent.
 * - Associates each person to the correct club (no fake "inter-club" club).
 * - For inter-club couples: Partnership with primary + secondary club, no composite club.
 * - Normalizes special characters. Toutes les créations sont en upsert/findFirst pour éviter les doublons.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CompetitionStatus,
  PrismaClient,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import * as https from "https";
import * as iconv from "iconv-lite";
import { SEED_COUPLE } from "./seed-owner-couple";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PASSWORD = "password123";
const CVDS_NAME = "Club Villeurbannais de Danse Sportive";

/** Prénoms (normalisés) des licenciés connus du CVDS : ils apparaissent dans les membres du club pour les couples inter-club. L'autre partenaire est rattaché à l'autre club. */
const CVDS_MEMBER_FIRST_NAMES = new Set([
  normalizeForMatch(SEED_COUPLE.owner.firstName),
  normalizeForMatch(SEED_COUPLE.partner.firstName),
  "lilly",
  "lily",
]);

/** Page d'index qui liste toutes les compétitions (remplace la liste statique). */
const RESULTATS_INDEX_URL =
  "https://chairperson.ddsbagnols.com/resultats/index.php";

/** Liste statique de secours si l'index n'est pas disponible. */
const FALLBACK_URLS = [
  "https://chairperson.ddsbagnols.com/resultats/20260131_cr_aura/index.htm",
  "https://chairperson.ddsbagnols.com/resultats/20260131toulouse/index.htm",
  "https://chairperson.ddsbagnols.com/resultats/20260117bourgenbresse/index.htm",
  "https://chairperson.ddsbagnols.com/resultats/20260111_muret/index.htm",
  "https://chairperson.ddsbagnols.com/resultats/20260110reims/index.htm",
  "https://chairperson.ddsbagnols.com/resultats/20260131toulousecr/index.htm",
];

// Emails to keep (couple de dev, direction CVDS, admin, e2e)
const KEEP_EMAILS = new Set([
  "admin@ffd.com",
  "test.e2e@ffd.com",
  SEED_COUPLE.owner.email, // Couple de dev — leader
  SEED_COUPLE.partner.email, // Couple de dev — follower
  "direction@cvds.com", // Compte club CVDS
]);

// ---- Scrape (option --scrape) ----
function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCharCode(parseInt(dec, 10)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function fetchContent(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let decoded = iconv.decode(buffer, "win1252");
          if (
            decoded.includes("charset=utf-8") ||
            decoded.includes("charset=UTF-8")
          ) {
            decoded = iconv.decode(buffer, "utf8");
          }
          resolve(decoded);
        });
      })
      .on("error", reject);
  });
}

/** Récupère la liste des URLs de compétitions depuis la page d'index. */
async function getCompetitionUrlsFromIndex(): Promise<string[]> {
  try {
    console.warn(`📋 Fetching competition list from ${RESULTATS_INDEX_URL}...`);
    const html = await fetchContent(RESULTATS_INDEX_URL);
    const urls: string[] = [];
    // Liens absolus: href="https://...resultats/.../index.htm"
    const absRegex =
      /href=["'](https?:\/\/[^"']*\/resultats\/[^"']+\/index\.htm)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = absRegex.exec(html)) !== null) {
      urls.push(m[1]);
    }
    // Liens relatifs: href="20260131_cr_aura/index.htm" (par rapport à resultats/)
    const relRegex = /href=["'](?!https?:\/\/)([^"']+\/index\.htm)["']/gi;
    while ((m = relRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const base = "https://chairperson.ddsbagnols.com/resultats/";
      urls.push(new URL(href, base).href);
    }
    const unique = [...new Set(urls)];
    console.warn(`   Found ${unique.length} competition(s).\n`);
    return unique.length > 0 ? unique : FALLBACK_URLS;
  } catch (err: unknown) {
    console.warn(
      "   Index fetch failed, using fallback URLs:",
      (err as Error).message,
    );
    return FALLBACK_URLS;
  }
}

async function scrapeCompetitions(): Promise<ScrapedCompetition[]> {
  const competitionUrls = await getCompetitionUrlsFromIndex();
  const competitions: ScrapedCompetition[] = [];
  for (const startUrl of competitionUrls) {
    console.warn(`📡 Scraping ${startUrl}...`);
    try {
      const indexHtml = await fetchContent(startUrl);
      const baseUrl = startUrl.substring(0, startUrl.lastIndexOf("/"));
      const titleMatch = /<TITLE>(.*?)<\/TITLE>/i.exec(indexHtml);
      let rawTitle = titleMatch ? titleMatch[1] : "Unknown Competition";
      rawTitle = decodeEntities(rawTitle);
      let dateStr = new Date().toISOString();
      const dateMatchUrl = /(\d{8})/.exec(startUrl);
      if (dateMatchUrl) {
        const ds = dateMatchUrl[1];
        dateStr = `${ds.substring(0, 4)}-${ds.substring(4, 6)}-${ds.substring(6, 8)}T10:00:00Z`;
      } else {
        const dateMatchTitle = /vom\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(
          rawTitle,
        );
        if (dateMatchTitle) {
          dateStr = `${dateMatchTitle[3]}-${dateMatchTitle[2]}-${dateMatchTitle[1]}T10:00:00Z`;
        }
      }
      let location = "Unknown";
      const locationMatch =
        /in\s+([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ][A-Za-zÀ-ÿ\s-]+?)(?:\s+vom|\s*$)/i.exec(
          rawTitle,
        );
      if (locationMatch) location = locationMatch[1].trim();
      const cleanTitle = rawTitle
        .replace(/\s+vom\s+\d{2}\.\d{2}\.\d{4}/gi, "")
        .replace(
          /\s+in\s+[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ][A-Za-zÀ-ÿ\s-]+/gi,
          "",
        )
        .trim();
      const comp: ScrapedCompetition = {
        title: cleanTitle,
        date: dateStr,
        location,
        events: [],
        sourceUrl: startUrl,
      };
      const eventLinkRegex = /<A HREF="([^"]*?\/index\.htm)"[^>]*>(.*?)<\/A>/gi;
      let match;
      while ((match = eventLinkRegex.exec(indexHtml)) !== null) {
        const subPath = match[1];
        const eventName = match[2].replace(/<[^>]+>/g, "").trim();
        const eventDir = subPath.substring(0, subPath.lastIndexOf("/"));
        const resultUrl = `${baseUrl}/${eventDir}/erg.htm`;
        try {
          const resultHtml = await fetchContent(resultUrl);
          const results: ScrapedResult[] = [];
          const rows = resultHtml.split(/<TR>/i);
          for (const row of rows) {
            if (!row.includes('class="td3c"')) continue;
            const rankM = /class="td3c"[^>]*>(.*?)<\/TD>/i.exec(row);
            const bibM = /class="td2c"[^>]*>(.*?)<\/TD>/i.exec(row);
            const partsM = /class="td5"[^>]*>(.*?)<\/TD>/i.exec(row);
            let club = "";
            const td5Regex = /class="td5"[^>]*>(.*?)<\/TD>/gi;
            let td5Match = td5Regex.exec(row);
            if (td5Match) {
              td5Match = td5Regex.exec(row);
              if (td5Match) club = td5Match[1].replace(/<[^>]+>/g, "").trim();
            }
            if (rankM && bibM && partsM) {
              results.push({
                rank: rankM[1].replace(/\./g, "").trim(),
                bib: bibM[1].replace(/<[^>]+>/g, "").trim(),
                participants: decodeEntities(
                  partsM[1].replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, ""),
                ).trim(),
                club: decodeEntities(club).trim(),
              });
            }
          }
          comp.events.push({ title: eventName, url: resultUrl, results });
        } catch (err: unknown) {
          console.warn(`    Failed ${eventName}:`, (err as Error).message);
        }
      }
      competitions.push(comp);
    } catch (err: unknown) {
      console.error(`Failed ${startUrl}:`, (err as Error).message);
    }
  }
  return competitions;
}

// ---- Helpers ----

import {
  normalizeForMatch,
  parseClubNames,
  parseFullName,
  parseRank,
} from "./sync-licensees.utils";

interface ScrapedResult {
  rank: string;
  bib: string;
  participants: string;
  club: string;
}

interface ScrapedEvent {
  title: string;
  url: string;
  results: ScrapedResult[];
}

interface ScrapedCompetition {
  title: string;
  date: string;
  location: string;
  events: ScrapedEvent[];
  sourceUrl?: string;
}

function generateLicenseNumber(
  firstName: string,
  lastName: string,
  ageGroup: string,
): { number: string; birthDate: Date } {
  const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, "");
  const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const currentYear = new Date().getFullYear();
  let birthYear = currentYear - 20;
  const lowerAge = ageGroup.toLowerCase();
  if (lowerAge.includes("juv")) birthYear = currentYear - 10;
  else if (lowerAge.includes("jun")) birthYear = currentYear - 14;
  else if (lowerAge.includes("youth")) birthYear = currentYear - 17;
  else if (lowerAge.includes("21")) birthYear = currentYear - 19;
  else if (lowerAge.includes("adult")) birthYear = currentYear - 25;
  else if (lowerAge.includes("sen")) birthYear = currentYear - 35;
  const month = Math.floor(Math.random() * 12);
  const day = Math.floor(Math.random() * 28) + 1;
  const birthDate = new Date(birthYear, month, day);
  const yyyy = birthDate.getFullYear();
  const mm = String(birthDate.getMonth() + 1).padStart(2, "0");
  const dd = String(birthDate.getDate()).padStart(2, "0");
  const lll =
    cleanLast.length >= 3
      ? cleanLast.substring(0, 3)
      : cleanLast.padEnd(3, "x");
  const ff =
    cleanFirst.length >= 2
      ? cleanFirst.substring(0, 2)
      : cleanFirst.padEnd(2, "x");
  const nn = String(Math.floor(Math.random() * 99)).padStart(2, "0");
  return {
    number: `${yyyy}${mm}${dd}-${lll}-${ff}${nn}`,
    birthDate,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.warn(`
sync-licensees-from-compete [options]

  Sync les licenciés et clubs à partir des résultats compete (scraped_data.json).
  Conserve toujours : le couple de dev (SEED_OWNER_* / SEED_PARTNER_*), CVDS. Pas de club factice pour les couples inter-club.

Options:
  --scrape    Re-scraper les URLs compete, mettre à jour scraped_data.json, puis synchroniser.
              Sans --scrape : utilise uniquement le fichier scraped_data.json existant.

  --help, -h  Afficher cette aide.

Exemples:
  pnpm run sync:compete              # Sync depuis le JSON existant
  pnpm run sync:compete -- --scrape  # Re-scraper puis sync (créer/mettre à jour sans doublons)
`);
    return;
  }

  const doScrape = process.argv.includes("--scrape");
  if (doScrape) {
    console.warn("📡 Option --scrape: re-scraping data from compete URLs...\n");
  }
  console.warn("🔄 Sync licensees & clubs from compete results...\n");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ---- 1) Resolve CVDS and users to keep ----
  const cvds = await prisma.club.findFirst({
    where: { name: { equals: CVDS_NAME, mode: "insensitive" } },
  });
  if (!cvds) {
    console.error(
      "Club CVDS not found. Run seed first to create the dev couple and CVDS.",
    );
    process.exit(1);
  }

  const keepUsers = await prisma.user.findMany({
    where: { email: { in: Array.from(KEEP_EMAILS) } },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const keepUserIds = new Set(keepUsers.map((u) => u.id));
  console.warn(
    `✓ Keeping ${keepUsers.length} users (couple de dev, CVDS, admin, e2e).`,
  );

  // ---- 2) Delete in dependency order ----
  console.warn("\n🧹 Clearing data (except kept users & CVDS)...");

  await prisma.seatBooking.deleteMany();
  await prisma.partnership.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.result.deleteMany();
  await prisma.scheduleItem.deleteMany();
  await prisma.event.deleteMany();
  await prisma.competition.deleteMany();

  await prisma.soloTeamMember.deleteMany();
  await prisma.soloTeam.deleteMany({ where: { clubId: { not: cvds.id } } });

  await prisma.license.deleteMany({
    where: { userId: { notIn: Array.from(keepUserIds) } },
  });

  await prisma.user.deleteMany({
    where: {
      id: { notIn: Array.from(keepUserIds) },
    },
  });

  await prisma.club.deleteMany({
    where: { id: { not: cvds.id } },
  });

  console.warn("   Done.\n");

  // Re-link direction@cvds.com to CVDS (in case clubId was cleared)
  await prisma.user.updateMany({
    where: { email: "direction@cvds.com" },
    data: { clubId: cvds.id, clubName: CVDS_NAME },
  });

  // ---- 3) Load or scrape data ----
  let competitionsRaw: ScrapedCompetition[];
  const scrapedPath = path.join(__dirname, "../prisma/seeds/scraped_data.json");

  if (doScrape) {
    competitionsRaw = await scrapeCompetitions();
    console.warn(`\n✅ Scraped ${competitionsRaw.length} competitions.`);
    const dir = path.dirname(scrapedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(scrapedPath, JSON.stringify(competitionsRaw, null, 2));
    console.warn(`💾 Saved to ${scrapedPath}\n`);
  } else {
    if (!fs.existsSync(scrapedPath)) {
      console.error(
        `Scraped data not found: ${scrapedPath}. Use --scrape to fetch data.`,
      );
      process.exit(1);
    }
    competitionsRaw = JSON.parse(
      fs.readFileSync(scrapedPath, "utf-8"),
    ) as ScrapedCompetition[];
    console.warn(
      `📂 Loaded ${competitionsRaw.length} competitions from scraped_data.json\n`,
    );
  }

  // Ensure sourceUrl for compatibility (unique per competition)
  const competitions = competitionsRaw.map((c, i) => ({
    ...c,
    sourceUrl:
      c.sourceUrl ??
      `file://${i}-${(c.title + c.date + c.location).replace(/[^a-z0-9-]/gi, "-")}`,
  }));

  // ---- 4) Collect distinct club names (no fake inter-club) ----
  const clubNamesSet = new Set<string>();
  for (const comp of competitions) {
    for (const event of comp.events) {
      for (const res of event.results) {
        const { clubs } = parseClubNames(res.club);
        clubs.forEach((name) => clubNamesSet.add(name));
      }
    }
  }
  clubNamesSet.add(CVDS_NAME);
  const clubNames = Array.from(clubNamesSet);
  console.warn(
    `🏢 ${clubNames.length} distinct clubs (no composite "inter-club" names).\n`,
  );

  // ---- 5) Create Club records (CVDS already exists) ----
  const clubIdByName = new Map<string, string>();
  clubIdByName.set(CVDS_NAME, cvds.id);
  for (const name of clubNames) {
    if (name === CVDS_NAME) continue;
    const club = await prisma.club.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    clubIdByName.set(name, club.id);
  }

  // ---- 6) Match / create users: normalized key -> userId ----
  const userByNormalizedKey = new Map<string, string>();
  for (const u of keepUsers) {
    const key = `${normalizeForMatch(u.firstName)}_${normalizeForMatch(u.lastName)}`;
    userByNormalizedKey.set(key, u.id);
  }

  // The dev couple must match its scraped results even if the stored names
  // differ (e.g. accents), so register its keys explicitly from the config.
  const coupleUserIds: string[] = [];
  for (const dancer of [SEED_COUPLE.owner, SEED_COUPLE.partner]) {
    const dancerUserId = keepUsers.find((u) => u.email === dancer.email)?.id;
    if (!dancerUserId) continue;
    const dancerKey = `${normalizeForMatch(dancer.firstName)}_${normalizeForMatch(dancer.lastName)}`;
    userByNormalizedKey.set(dancerKey, dancerUserId);
    coupleUserIds.push(dancerUserId);
  }

  // Ensure the dev couple has CVDS as club
  for (const coupleUserId of coupleUserIds) {
    await prisma.user.update({
      where: { id: coupleUserId },
      data: { clubId: cvds.id, clubName: CVDS_NAME },
    });
  }

  // ---- 7) Process each result: create users + assign club; collect partnerships ----
  type CoupleKey = string;
  const partnershipCreated = new Set<CoupleKey>();

  for (const comp of competitions) {
    for (const event of comp.events) {
      let category = "Standard";
      const titleLower = event.title.toLowerCase();
      if (titleLower.includes("latin")) category = "Latin";
      else if (titleLower.includes("std") || titleLower.includes("standard"))
        category = "Standard";
      else if (titleLower.includes("ten") || titleLower.includes("10"))
        category = "Ten Dance";
      let ageGroup = "Adult";
      if (titleLower.includes("juv")) ageGroup = "Juvenile";
      else if (titleLower.includes("jun")) ageGroup = "Junior";
      else if (titleLower.includes("youth")) ageGroup = "Youth";
      else if (titleLower.includes("21")) ageGroup = "Under 21";
      else if (titleLower.includes("sen")) ageGroup = "Senior";

      for (const res of event.results) {
        const names = res.participants
          .split(/[/|&]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (names.length === 0) continue;

        const { clubs: clubList, isInterClub } = parseClubNames(res.club);
        const club1Name = clubList[0] || "Unknown Club";
        const club2Name = clubList[1] || club1Name;
        const club1Id = clubIdByName.get(club1Name);
        const club2Id = clubIdByName.get(club2Name);
        const isCvds1 = club1Name === CVDS_NAME;
        const isCvds2 = club2Name === CVDS_NAME;

        let primaryClubId: string;
        let secondaryClubId: string | null;
        const clubAssignments: { clubId: string; clubName: string }[] = [];

        if (isInterClub && (isCvds1 || isCvds2)) {
          const otherClubId = isCvds1 ? club2Id : club1Id;
          const otherClubName = isCvds1 ? club2Name : club1Name;
          primaryClubId = cvds.id;
          secondaryClubId =
            otherClubId && otherClubId !== cvds.id ? otherClubId : null;
          for (let i = 0; i < names.length; i++) {
            const { firstName } = parseFullName(names[i]);
            const isCvdsMember = CVDS_MEMBER_FIRST_NAMES.has(
              normalizeForMatch(firstName),
            );
            if (isCvdsMember) {
              clubAssignments.push({ clubId: cvds.id, clubName: CVDS_NAME });
            } else {
              clubAssignments.push({
                clubId: otherClubId ?? cvds.id,
                clubName: otherClubName,
              });
            }
          }
          if (clubAssignments.length !== names.length) {
            clubAssignments.length = 0;
            clubAssignments.push({
              clubId: club1Id ?? cvds.id,
              clubName: club1Name,
            });
            if (names.length > 1) {
              clubAssignments.push({
                clubId: club2Id ?? cvds.id,
                clubName: club2Name,
              });
            }
            primaryClubId = club1Id ?? cvds.id;
            secondaryClubId =
              club2Id && club2Id !== primaryClubId ? club2Id : null;
          }
        } else {
          primaryClubId = club1Id ?? cvds.id;
          secondaryClubId =
            isInterClub && club2Id && club2Id !== primaryClubId
              ? club2Id
              : null;
          for (let i = 0; i < names.length; i++) {
            const clubId =
              i === 0 ? (club1Id ?? primaryClubId) : (club2Id ?? primaryClubId);
            const clubName = i === 0 ? club1Name : club2Name;
            clubAssignments.push({ clubId, clubName });
          }
        }

        const coupleUserIds: string[] = [];
        for (let i = 0; i < names.length; i++) {
          const { firstName, lastName } = parseFullName(names[i]);
          const key = `${normalizeForMatch(firstName)}_${normalizeForMatch(lastName)}`;
          let userId = userByNormalizedKey.get(key);
          const { clubId, clubName } = clubAssignments[i] ?? {
            clubId: primaryClubId,
            clubName: CVDS_NAME,
          };

          if (!userId) {
            const emailBase = `${firstName.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüÿç]/gi, "")}.${lastName.toLowerCase().replace(/[^a-zàâäéèêëïîôùûüÿç]/gi, "")}`;
            const email = `${emailBase}@ffd.com`;
            const { number, birthDate } = generateLicenseNumber(
              firstName,
              lastName,
              ageGroup,
            );

            const user = await prisma.user.upsert({
              where: { email },
              update: {
                clubId,
                clubName,
                category,
                ageGroup,
              },
              create: {
                email,
                password: passwordHash,
                firstName,
                lastName,
                role: UserRole.LICENSEE,
                clubId: clubId || undefined,
                clubName: clubName,
                category,
                ageGroup,
                birthDate,
                license: {
                  create: {
                    number,
                    validUntil: new Date("2026-12-31"),
                    category,
                    clubName: clubName,
                  },
                },
              },
            });
            userId = user.id;
            userByNormalizedKey.set(key, userId);
          } else if (clubId === cvds.id) {
            await prisma.user.update({
              where: { id: userId },
              data: { clubId: cvds.id, clubName: CVDS_NAME },
            });
          }
          coupleUserIds.push(userId);
        }

        if (coupleUserIds.length >= 2) {
          const [u1, u2] = coupleUserIds;
          const pairKey: CoupleKey = [u1, u2].sort().join("_");
          if (!partnershipCreated.has(pairKey)) {
            const existingPartnership = await prisma.partnership.findFirst({
              where: {
                endDate: null,
                OR: [
                  { user1Id: u1, user2Id: u2 },
                  { user1Id: u2, user2Id: u1 },
                ],
              },
            });
            if (!existingPartnership) {
              partnershipCreated.add(pairKey);
              await prisma.partnership.create({
                data: {
                  clubId: primaryClubId,
                  secondaryClubId,
                  user1Id: u1,
                  user2Id: u2,
                  status: "ACTIVE",
                },
              });
            } else {
              partnershipCreated.add(pairKey);
            }
          }
        }
      }
    }
  }

  console.warn(`✓ ${userByNormalizedKey.size} users (licenciés).`);
  console.warn(`✓ ${partnershipCreated.size} partnerships (couples).\n`);

  // ---- 8) Recreate competitions, events, results, registrations ----
  const competitionIdBySource = new Map<string, string>();

  for (const compData of competitions) {
    const competition = await prisma.competition.upsert({
      where: { ffdId: compData.sourceUrl },
      update: {
        title: compData.title,
        date: new Date(compData.date),
        location: compData.location === "Unknown" ? "TBD" : compData.location,
        status:
          new Date(compData.date) < new Date()
            ? CompetitionStatus.PAST
            : CompetitionStatus.UPCOMING,
      },
      create: {
        title: compData.title,
        date: new Date(compData.date),
        location: compData.location === "Unknown" ? "TBD" : compData.location,
        status:
          new Date(compData.date) < new Date()
            ? CompetitionStatus.PAST
            : CompetitionStatus.UPCOMING,
        ffdId: compData.sourceUrl,
      },
    });
    competitionIdBySource.set(compData.sourceUrl, competition.id);
  }

  let eventCounter = 0;
  for (const compData of competitions) {
    const compId = competitionIdBySource.get(compData.sourceUrl);
    if (!compId) continue;

    for (const eventData of compData.events) {
      eventCounter++;
      let category = "Standard";
      const titleLower = eventData.title.toLowerCase();
      if (titleLower.includes("latin")) category = "Latin";
      else if (titleLower.includes("std") || titleLower.includes("standard"))
        category = "Standard";
      else if (titleLower.includes("ten") || titleLower.includes("10"))
        category = "Ten Dance";
      let ageGroup = "Adult";
      if (titleLower.includes("juv")) ageGroup = "Juvenile";
      else if (titleLower.includes("jun")) ageGroup = "Junior";
      else if (titleLower.includes("youth")) ageGroup = "Youth";
      else if (titleLower.includes("21")) ageGroup = "Under 21";
      else if (titleLower.includes("sen")) ageGroup = "Senior";

      let event = await prisma.event.findFirst({
        where: { competitionId: compId, category, ageGroup },
      });
      event ??= await prisma.event.create({
        data: {
          competitionId: compId,
          category,
          ageGroup,
          eventType: "COUPLE",
        },
      });

      const startTime = new Date(compData.date);
      startTime.setHours(9 + Math.floor(eventCounter / 6));
      startTime.setMinutes((eventCounter % 6) * 10);
      const existingSchedule = await prisma.scheduleItem.findFirst({
        where: {
          competitionId: compId,
          eventId: event.id,
          title: eventData.title,
        },
      });
      if (!existingSchedule) {
        await prisma.scheduleItem.create({
          data: {
            competitionId: compId,
            eventId: event.id,
            title: eventData.title,
            startTime,
            type: "ROUND",
          },
        });
      }

      for (const res of eventData.results) {
        const names = res.participants
          .split(/[/|&]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (names.length === 0) continue;

        const coupleUserIds: string[] = [];
        const coupleNames: string[] = [];
        for (const fullName of names) {
          const { firstName, lastName } = parseFullName(fullName);
          const key = `${normalizeForMatch(firstName)}_${normalizeForMatch(lastName)}`;
          const userId = userByNormalizedKey.get(key);
          if (userId) {
            coupleUserIds.push(userId);
            coupleNames.push(`${firstName} ${lastName}`);
          }
        }

        if (coupleUserIds.length === 0) continue;

        const u1 = coupleUserIds[0];
        const u2 = coupleUserIds.length > 1 ? coupleUserIds[1] : null;
        const bib = parseInt(res.bib, 10) || 0;
        const ranking = parseRank(res.rank);

        const existingReg1 = await prisma.registration.findFirst({
          where: { eventId: event.id, userId: u1 },
        });
        if (!existingReg1) {
          await prisma.registration.create({
            data: {
              eventId: event.id,
              userId: u1,
              partnerName: coupleNames[1],
              status: RegistrationStatus.CONFIRMED,
              bibNumber: bib,
              checkedIn: true,
              feePaid: true,
            },
          });
        }
        if (u2) {
          const existingReg2 = await prisma.registration.findFirst({
            where: { eventId: event.id, userId: u2 },
          });
          if (!existingReg2) {
            await prisma.registration.create({
              data: {
                eventId: event.id,
                userId: u2,
                partnerName: coupleNames[0],
                status: RegistrationStatus.CONFIRMED,
                bibNumber: bib,
                checkedIn: true,
                feePaid: true,
              },
            });
          }
        }

        const existingResults = await prisma.result.findMany({
          where: { eventId: event.id, ranking },
        });
        const isDuplicateResult = existingResults.some(
          (r) =>
            (r.details as Record<string, unknown>).participant ===
            res.participants,
        );
        if (!isDuplicateResult) {
          await prisma.result.create({
            data: {
              eventId: event.id,
              userId: u1,
              round: "Final",
              ranking,
              details: {
                participant: res.participants,
                bib: res.bib,
                club: res.club,
              },
            },
          });
        }
      }
    }
  }

  console.warn("✅ Competitions, events, registrations and results synced.\n");
  console.warn("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    void pool.end();
  });
