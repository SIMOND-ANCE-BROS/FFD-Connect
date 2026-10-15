/**
 * Builds the integration/e2e test database from the real migration chain
 * (`prisma migrate deploy`), the same command the container runs at boot,
 * then checks that the Prisma schema has no change missing a migration.
 *
 * Replaces `prisma db push`, which built the schema straight from the
 * `.prisma` files: hand-written data migrations never ran in CI and a broken
 * migration was only caught at deploy time (#272).
 *
 * Idempotent: `migrate deploy` only applies pending migrations (no-op on an
 * up-to-date database) and takes a Postgres advisory lock, so concurrent runs
 * are serialised.
 */

export interface CommandResult {
  status: number | null;
  output: string;
}

export type CommandRunner = (args: readonly string[]) => CommandResult;

export const MIGRATE_DEPLOY_ARGS = ["migrate", "deploy"] as const;

/** Exit code 2 = the database differs from the Prisma schema. */
export const SCHEMA_DRIFT_ARGS = [
  "migrate",
  "diff",
  "--from-config-datasource",
  "--to-schema",
  "./prisma/schema",
  "--exit-code",
] as const;

const DIFF_EXIT_NO_CHANGE = 0;
const DIFF_EXIT_CHANGES = 2;

export class TestDatabasePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabasePreparationError";
  }
}

/** Database already has tables but no `_prisma_migrations` history. */
const isUnbaselinedDatabase = (output: string): boolean =>
  output.includes("P3005");

export function migrateDeployFailureMessage(output: string): string {
  if (isUnbaselinedDatabase(output)) {
    return [
      "prisma migrate deploy refused the test database (P3005): it is not empty and has no migration history.",
      "It was most likely created by the former `prisma db push` setup.",
      "Point DATABASE_URL at a fresh, empty test database (or drop and recreate this throwaway one) and run again.",
    ].join("\n");
  }
  return "prisma migrate deploy failed on the test database: a migration does not apply. See the Prisma output above.";
}

export const SCHEMA_DRIFT_MESSAGE = [
  "The Prisma schema differs from the database built by the migrations:",
  "a schema change has no migration. Create it with `pnpm --filter backend migrate`",
  "(or `prisma migrate diff` offline) and commit it.",
].join("\n");

export function prepareTestDatabase(run: CommandRunner): void {
  const deploy = run(MIGRATE_DEPLOY_ARGS);
  if (deploy.status !== 0) {
    throw new TestDatabasePreparationError(
      migrateDeployFailureMessage(deploy.output),
    );
  }

  const drift = run(SCHEMA_DRIFT_ARGS);
  if (drift.status === DIFF_EXIT_CHANGES) {
    throw new TestDatabasePreparationError(SCHEMA_DRIFT_MESSAGE);
  }
  if (drift.status !== DIFF_EXIT_NO_CHANGE) {
    throw new TestDatabasePreparationError(
      "prisma migrate diff failed while checking the schema against the migrated test database. See the Prisma output above.",
    );
  }
}
