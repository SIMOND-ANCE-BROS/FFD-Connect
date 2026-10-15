/**
 * Prepares the integration/e2e test database with the real migration chain.
 *
 * Used by the jest globalSetup of the integration and e2e suites and by the
 * CI backend-test job. Local run (throwaway database only):
 *
 *   DATABASE_URL=postgresql://test:test@localhost:5440/test pnpm --filter backend test:db:prepare
 *
 * See prepare-test-db.utils.ts for what it checks.
 */
import { spawnSync } from "child_process";
import * as path from "path";
import {
  type CommandResult,
  prepareTestDatabase,
  TestDatabasePreparationError,
} from "./prepare-test-db.utils";

const BACKEND_DIR = path.resolve(__dirname, "..");
// Resolve the CLI entry rather than a node_modules/.bin link: pnpm may hoist
// the bin to the workspace root, and spawning node directly needs no shell.
const PRISMA_CLI = require.resolve("prisma/build/index.js", {
  paths: [BACKEND_DIR],
});

function runPrisma(args: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: BACKEND_DIR,
    env: process.env,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  // Echo Prisma's output so a failing migration is readable in the CI log.
  process.stdout.write(output);
  if (result.error) {
    return { status: null, output: `${output}${result.error.message}` };
  }
  return { status: result.status, output };
}

export function prepareTestDatabaseWithPrisma(): void {
  if (!process.env.DATABASE_URL) {
    throw new TestDatabasePreparationError(
      "DATABASE_URL is not set: point it at a throwaway test database.",
    );
  }
  console.log(
    "\n🔧 Applying Prisma migrations to the test database (migrate deploy)...",
  );
  prepareTestDatabase(runPrisma);
  console.log("✅ Test database migrated and in sync with the schema\n");
}

if (require.main === module) {
  try {
    prepareTestDatabaseWithPrisma();
  } catch (error) {
    console.error(
      `\n❌ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
