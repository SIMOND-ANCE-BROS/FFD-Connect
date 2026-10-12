/**
 * Swagger JSON export script
 * Must be run AFTER `nest build` (or `pnpm run build`) so that dist/ contains
 * the properly compiled files with emitDecoratorMetadata.
 *
 * Usage: tsx scripts/export-swagger.ts
 *
 * Run the source with tsx, not the compiled dist/scripts copy: paths below are
 * resolved from __dirname, so the compiled copy would write to dist/swagger.json.
 */
import * as fs from "fs";
import * as path from "path";
import type { Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

/**
 * Placeholders for the env vars the config validation requires (#256). The
 * export builds the module graph but never connects to the database nor signs
 * a token, so any well-formed value works; real values, when set, win. Same
 * values as the CI `backend-build` job, so the spec is identical either way.
 */
const EXPORT_ENV_DEFAULTS: Record<string, string> = {
  DATABASE_URL: "postgresql://localhost/dummy",
  JWT_SECRET: "test-secret-key-for-swagger-export-only",
};
for (const [name, value] of Object.entries(EXPORT_ENV_DEFAULTS)) {
  // An empty value counts as unset (it would fail the config validation).
  const current = process.env[name];
  if (current === undefined || current === "") {
    process.env[name] = value;
  }
}

/** Loads a class from the compiled dist/ (decorator metadata is only there). */
function requireCompiled(relativePath: string, exportName: string): Type {
  const loaded = require(path.resolve(__dirname, relativePath)) as Record<
    string,
    Type
  >;
  return loaded[exportName];
}

async function generate(): Promise<void> {
  console.log("🚀 Starting Swagger export...");

  // Import from compiled dist — requires nest build to have been run first
  const AppModule = requireCompiled("../dist/src/app.module", "AppModule");

  // abortOnError: false — otherwise Nest calls process.exit(1) itself on a
  // bootstrap error (e.g. invalid env), and with the logger off the command
  // died without a word (#256). The error now reaches the catch below.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  console.log("✅ Nest application created");

  const config = new DocumentBuilder()
    .setTitle("FFD Connect API")
    .setDescription(
      "API pour l'application FFD Connect - Gestion des compétitions de danse",
    )
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        name: "JWT",
        description: "Enter JWT token",
        in: "header",
      },
      "JWT-auth",
    )
    .build();

  console.log("📦 Creating OpenAPI document...");
  const modules = [
    "AuthModule",
    "TracksModule",
    "CompetitionsModule",
    "ReportsModule",
    "UsersModule",
    "WdsfModule",
    "NotificationsModule",
    "LicensesModule",
    "HealthModule",
  ];

  // Per-module dry run: pinpoints which module breaks document generation.
  for (const moduleName of modules) {
    try {
      console.log(`🔍 Testing module: ${moduleName}...`);
      const dir = moduleName.toLowerCase().replace("module", "");
      const file = moduleName.toLowerCase().replace("module", ".module");
      const moduleClass = requireCompiled(
        `../dist/src/${dir}/${file}`,
        moduleName,
      );

      SwaggerModule.createDocument(app, config, {
        include: [moduleClass],
      });
      console.log(`✅ ${moduleName} is clean.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ Error in ${moduleName}:`, message);
      if (message.includes("circular")) {
        console.error(`!!! CIRCULAR DEPENDENCY FOUND IN ${moduleName} !!!`);
      }
    }
  }

  const document = SwaggerModule.createDocument(app, config);
  const outputPath = path.resolve(__dirname, "../swagger.json");

  console.log(`💾 Writing to ${outputPath}...`);
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
  console.log(`✨ Swagger JSON exported successfully to ${outputPath}`);

  await app.close();
  process.exit(0);
}

generate().catch((err: unknown) => {
  console.error("❌ Error generating swagger spec:", err);
  process.exit(1);
});
