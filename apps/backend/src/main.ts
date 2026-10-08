// Sentry must be initialized before anything else for auto-instrumentation
import * as Sentry from "@sentry/nestjs";

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as fs from "fs";
import * as path from "path";

import compression from "compression";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { API_GLOBAL_PREFIX } from "./common/api-prefix";
import { HEALTH_PREFIX_EXCLUDE } from "./health/health.controller";
import { UPLOADS_FALLBACK_PREFIX_EXCLUDE } from "./tracks/uploads-fallback.controller";
import { requireProductionEnv } from "./utils/require-production-env";

function ensureUploadDirs() {
  const dirs = [
    path.join(process.cwd(), "uploads", "certificates"),
    path.join(process.cwd(), "uploads", "renewal"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Buffer logs until Pino logger is ready
    rawBody: true, // Required for webhook HMAC signature verification
  });

  // Utiliser Pino comme logger global pour Nest
  const logger = app.get(Logger);
  const configService = app.get(ConfigService);
  app.useLogger(logger);

  const prodEnvCallbacks = {
    onError: (msg: string) => logger.error(msg, "Bootstrap"),
    onWarn: (msg: string) => logger.warn(msg, "Bootstrap"),
    exit: (code: number) => process.exit(code),
  };
  const nodeEnv = configService.get<string>("NODE_ENV");

  // Initialize Sentry for error tracking and performance monitoring
  const sentryDsn = configService.get<string>("SENTRY_DSN");
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      // SENTRY_ENVIRONMENT lets prod & staging (both NODE_ENV=production) be
      // separated in Sentry; falls back to NODE_ENV.
      environment:
        configService.get<string>("SENTRY_ENVIRONMENT") ??
        configService.get<string>("NODE_ENV", "development"),
      tracesSampleRate:
        configService.get<string>("NODE_ENV") === "production" ? 0.2 : 1.0,
      // No profiling. `profilesSampleRate` lived here but was inert: it needs
      // `nodeProfilingIntegration()` from @sentry/profiling-node registered in
      // `integrations`, which was never done — so no profile was ever sent.
      // Sentry 11 removed the option outright (it was deprecated in 10.27).
      //
      // To actually turn profiling on, add the integration plus
      // `profileSessionSampleRate` and `profileLifecycle: "trace"`. Mind the
      // cost first: that rate samples SESSIONS, not transactions, and the
      // decision is re-evaluated on every service restart — on a scale-to-zero
      // app each cold start is a new session, so a given rate profiles far
      // more than the same rate did per-transaction.
    });
  } else {
    logger.warn(
      "SENTRY_DSN not configured. Error tracking disabled.",
      "Bootstrap",
    );
  }

  requireProductionEnv(
    "HELLOASSO_WEBHOOK_SECRET",
    configService.get<string>("HELLOASSO_WEBHOOK_SECRET"),
    nodeEnv,
    prodEnvCallbacks,
  );
  requireProductionEnv(
    "APP_URL",
    configService.get<string>("APP_URL"),
    nodeEnv,
    prodEnvCallbacks,
  );

  // Compression gzip pour améliorer les performances
  app.use(compression());

  // Sécurité: Headers HTTP avec Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Configure CORS with restrictive settings
  const isProduction = configService.get<string>("NODE_ENV") === "production";
  const corsOriginsRaw = configService.get<string>("CORS_ORIGINS");
  if (isProduction && !corsOriginsRaw) {
    logger.error(
      "CORS_ORIGINS must be set in production. Exiting.",
      "Bootstrap",
    );
    process.exit(1);
  }

  const allowedOrigins = corsOriginsRaw?.split(",") ?? [
    "http://localhost:3000",
    "http://localhost:19006", // Expo dev server
    "http://localhost:8081", // Metro bundler
    "http://localhost:8082", // Metro bundler alternative
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) {
        return callback(null, true);
      }

      // En développement, autoriser uniquement les origines locales configurées
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API versioning — all routes are prefixed with /api/v1 (health excluded for monitoring)
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: [...HEALTH_PREFIX_EXCLUDE, UPLOADS_FALLBACK_PREFIX_EXCLUDE],
  });

  // Swagger/OpenAPI documentation
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
      "JWT-auth", // This name here is important for matching up with @ApiBearerAuth() in your controller!
    )
    .addTag("auth", "Authentification et gestion des utilisateurs")
    .addTag("competitions", "Gestion des compétitions")
    .addTag("licenses", "Gestion des licences")
    .addTag("tracks", "Gestion des musiques")
    .addTag("users", "Gestion des utilisateurs")
    .addTag("reports", "Rapports et signalements")
    .addTag("notifications", "Notifications")
    .addTag("wdsf", "Intégration WDSF")
    .addTag("tts", "Text-to-Speech")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  if (!isProduction) {
    SwaggerModule.setup("api", app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  ensureUploadDirs();

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled promise rejection: ${String(reason)}`, "Process");
    Sentry.captureException(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  });

  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.message}`, "Process");
    Sentry.captureException(err);
    process.exit(1);
  });

  // Graceful shutdown: closes DB, Redis, BullMQ connections on SIGTERM (Docker stop, deploy)
  app.enableShutdownHooks();

  await app.listen(configService.get<number>("PORT", 3000), "0.0.0.0");
}
void bootstrap();
