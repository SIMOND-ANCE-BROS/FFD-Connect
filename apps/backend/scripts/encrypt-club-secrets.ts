/**
 * One-shot migration of the club HelloAsso secrets to encryption at rest
 * (#389). Runbook: docs/exploitation/chiffrement-secrets-clubs.md.
 *
 * Re-encrypts with SECRETS_ENCRYPTION_KEY every secret still stored in
 * plaintext, or encrypted with SECRETS_ENCRYPTION_KEY_PREVIOUS (rotation).
 * Idempotent: a second run migrates nothing. Compare-and-set per club, so a
 * club reconnecting HelloAsso meanwhile is never overwritten. Never prints a
 * secret: only counts and club ids.
 *
 * The backend also migrates lazily (on the next payment read), so this script
 * only speeds things up and is required before removing a previous key.
 *
 * Usage (inside the backend container, which has the env vars):
 *   node dist/scripts/encrypt-club-secrets.js
 * Locally: pnpm --filter backend exec tsx scripts/encrypt-club-secrets.ts
 *
 * Exit code 1 when the key is missing or a secret could not be decrypted.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { ConfigService } from "@nestjs/config";
import "dotenv/config";
import { Pool } from "pg";
import { SecretCipherService } from "../src/common/crypto/secret-cipher.service";
import { migrateClubSecrets } from "./encrypt-club-secrets.utils";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main(): Promise<void> {
  // Same parsing and validation as the running backend.
  const cipher = new SecretCipherService({
    get: (name: string) => process.env[name],
  } as unknown as ConfigService);

  const report = await migrateClubSecrets(
    {
      findPage: (cursor, take) =>
        prisma.club.findMany({
          where: { helloAssoClientSecret: { not: null } },
          select: { id: true, helloAssoClientSecret: true },
          orderBy: { id: "asc" },
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      replaceSecret: async (id, previous, next) =>
        (
          await prisma.club.updateMany({
            where: { id, helloAssoClientSecret: previous },
            data: { helloAssoClientSecret: next },
          })
        ).count,
    },
    cipher,
  );

  console.log(
    `[encrypt-club-secrets] scanned=${report.scanned} migrated=${report.migrated} ` +
      `upToDate=${report.upToDate} skipped=${report.skipped} failed=${report.failed.length}`,
  );
  if (report.failed.length > 0) {
    console.error(
      `[encrypt-club-secrets] could not decrypt the secret of clubs: ${report.failed.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    // Error name/message only: never a query echo that could hold a secret.
    console.error(
      `[encrypt-club-secrets] failed: ${
        error instanceof Error ? error.message.split("\n")[0] : "unknown error"
      }`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
