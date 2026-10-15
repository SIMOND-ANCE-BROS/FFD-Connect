/**
 * One-shot recompute of the track MPMs stored as a raw BPM (#338).
 *
 * Until #338 the backend stored the rounded raw BPM as the MPM of a track
 * whose dance it did not recognise (« valse anglaise », « Slow-fox »…, or no
 * dance at all), and applied an admin's BPM typed as an MPM as is. Those tracks
 * showed a wrong MPM and were dropped from the competition mode as off-tempo.
 * This script converts them (known dance) or clears their MPM (unknown dance:
 * 0 = unknown, the app shows « - »). Idempotent: a second run changes nothing.
 * Compare-and-set per track, so a concurrent edit is never overwritten.
 *
 * Dry run by default (prints what would change); `--apply` writes.
 *
 * Usage (inside the backend container, which has DATABASE_URL):
 *   node dist/scripts/recompute-track-mpm.js            # dry run
 *   node dist/scripts/recompute-track-mpm.js --apply
 * Locally: pnpm --filter backend exec tsx scripts/recompute-track-mpm.ts [--apply]
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { Pool } from "pg";
import { BpmService } from "../src/tracks/bpm.service";
import { recomputeTrackMpm } from "./recompute-track-mpm.utils";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const report = await recomputeTrackMpm(
    {
      findPage: (cursor, take) =>
        prisma.track.findMany({
          select: { id: true, style: true, bpm: true, rawBpm: true },
          orderBy: { id: "asc" },
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      replaceMpm: async (id, previous, next) =>
        (
          await prisma.track.updateMany({
            where: { id, bpm: previous },
            data: { bpm: next },
          })
        ).count,
    },
    new BpmService(),
    { apply },
  );

  for (const change of report.changes) {
    console.log(
      `[recompute-track-mpm] ${change.id}: ${change.from} → ${change.to}`,
    );
  }
  console.log(
    `[recompute-track-mpm] ${apply ? "applied" : "dry run"}: scanned=${report.scanned} ` +
      `corrected=${report.corrected} cleared=${report.cleared} skipped=${report.skipped}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      `[recompute-track-mpm] failed: ${
        error instanceof Error ? error.message.split("\n")[0] : "unknown error"
      }`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
