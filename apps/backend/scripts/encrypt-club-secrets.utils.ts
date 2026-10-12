/**
 * Core of scripts/encrypt-club-secrets.ts (kept separate so it can be
 * unit-tested without a database). See the script header for the run book.
 */
import type { DecryptedSecret } from "../src/common/crypto/secret-cipher.service";

export interface ClubSecretRow {
  id: string;
  helloAssoClientSecret: string | null;
}

/** The two Prisma calls the migration needs (PrismaClient satisfies it). */
export interface ClubSecretStore {
  findPage(cursor: string | undefined, take: number): Promise<ClubSecretRow[]>;
  /** Compare-and-set: rewrites only if the stored value is still `previous`. */
  replaceSecret(id: string, previous: string, next: string): Promise<number>;
}

export interface SecretCipher {
  readonly isEnabled: boolean;
  encrypt(plaintext: string): string;
  decrypt(stored: string): DecryptedSecret;
}

export interface ClubSecretMigrationReport {
  scanned: number;
  /** Rewritten with the current key (legacy plaintext or previous key). */
  migrated: number;
  /** Already encrypted with the current key: nothing to do. */
  upToDate: number;
  /** Changed concurrently between the read and the write: left as is. */
  skipped: number;
  /** Could not be decrypted with any configured key (club ids only). */
  failed: string[];
}

export const CLUB_SECRET_PAGE_SIZE = 100;

/**
 * Re-encrypts every club HelloAsso secret that is not yet encrypted with the
 * current key. Idempotent: a second run migrates nothing. Never logs nor
 * returns a secret value.
 */
export async function migrateClubSecrets(
  store: ClubSecretStore,
  cipher: SecretCipher,
  pageSize = CLUB_SECRET_PAGE_SIZE,
): Promise<ClubSecretMigrationReport> {
  if (!cipher.isEnabled) {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY is not set: nothing can be encrypted",
    );
  }
  const report: ClubSecretMigrationReport = {
    scanned: 0,
    migrated: 0,
    upToDate: 0,
    skipped: 0,
    failed: [],
  };
  let cursor: string | undefined;
  for (;;) {
    const page = await store.findPage(cursor, pageSize);
    for (const row of page) {
      const stored = row.helloAssoClientSecret;
      if (!stored) continue;
      report.scanned += 1;
      let decrypted: DecryptedSecret;
      try {
        decrypted = cipher.decrypt(stored);
      } catch {
        report.failed.push(row.id);
        continue;
      }
      if (!decrypted.needsReEncryption) {
        report.upToDate += 1;
        continue;
      }
      const count = await store.replaceSecret(
        row.id,
        stored,
        cipher.encrypt(decrypted.plaintext),
      );
      if (count > 0) report.migrated += 1;
      else report.skipped += 1;
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return report;
}
