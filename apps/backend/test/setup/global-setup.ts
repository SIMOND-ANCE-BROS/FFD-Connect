import * as dotenv from "dotenv";
import * as path from "path";
import { prepareTestDatabaseWithPrisma } from "../../scripts/prepare-test-db";

export default function globalSetup() {
  // Load test environment variables only if not already set (CI injects them directly)
  if (!process.env.DATABASE_URL) {
    dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });
  }

  // Real migration chain (`prisma migrate deploy`), not `db push` (#272).
  // Runs once per jest invocation; a no-op when the database is up to date.
  prepareTestDatabaseWithPrisma();
}
