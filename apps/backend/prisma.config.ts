import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // Prisma 7 with a multi-file schema resolves migrations relative to the
    // schema DIRECTORY (i.e. <schema>/migrations). Keep this in sync with the
    // real location so migrate deploy/status find them.
    directory: "./prisma/schema/migrations",
    seed: "tsx ./scripts/seed.ts",
  },
});
