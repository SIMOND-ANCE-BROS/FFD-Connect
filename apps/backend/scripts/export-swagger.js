/**
 * Swagger JSON export script
 * Must be run AFTER `nest build` (or `pnpm run build`) so that dist/ contains
 * the properly compiled files with emitDecoratorMetadata.
 *
 * Usage: node scripts/export-swagger.js
 */
const path = require("path");

async function generate() {
  console.log("🚀 Starting Swagger export...");

  // Import from compiled dist — requires nest build to have been run first
  const { NestFactory } = require("@nestjs/core");
  const { SwaggerModule, DocumentBuilder } = require("@nestjs/swagger");
  const fs = require("fs");

  const { AppModule } = require(
    path.resolve(__dirname, "../dist/src/app.module"),
  );

  const app = await NestFactory.create(AppModule, { logger: false });
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

  for (const moduleName of modules) {
    try {
      console.log(`🔍 Testing module: ${moduleName}...`);
      const moduleClass = require(
        path.resolve(
          __dirname,
          `../dist/src/${moduleName.toLowerCase().replace("module", "")}/${moduleName.toLowerCase().replace("module", ".module")}`,
        ),
      )[moduleName];

      const doc = SwaggerModule.createDocument(app, config, {
        include: [moduleClass],
      });
      console.log(`✅ ${moduleName} is clean.`);
    } catch (err) {
      console.error(`❌ Error in ${moduleName}:`, err.message);
      if (err.message.includes("circular")) {
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

generate().catch((err) => {
  console.error("Error generating swagger spec:", err);
  process.exit(1);
});
