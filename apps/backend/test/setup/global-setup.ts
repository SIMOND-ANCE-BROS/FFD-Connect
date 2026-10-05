import * as dotenv from "dotenv";
import * as path from "path";
import { execSync } from "child_process";

export default function globalSetup() {
  // Load test environment variables only if not already set (CI injects them directly)
  if (!process.env.DATABASE_URL) {
    dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });
  }

  console.log("\n🔧 Pushing Prisma schema to test database...");
  try {
    execSync("npx prisma db push --accept-data-loss", {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env },
      stdio: "inherit",
    });
    console.log("✅ Schema pushed\n");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}
