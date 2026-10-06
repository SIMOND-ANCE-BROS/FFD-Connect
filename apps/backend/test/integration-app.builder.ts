/**
 * Shared builder for integration & e2e test apps.
 *
 * Provides two flavours:
 *
 *   buildServiceModule()  — no HTTP layer, for testing services directly.
 *   buildHttpApp()        — full NestJS HTTP app with ValidationPipe, for
 *                           supertest HTTP tests.
 *
 * Both mock the heavy infrastructure providers (TTS, Notifications, Throttler,
 * Redis) so tests don't need to repeat that boilerplate.
 *
 * Extra overrides can be passed via the `extra` callback:
 *
 *   const { module } = await buildServiceModule({
 *     extra: (builder) =>
 *       builder.overrideProvider(SomeService).useValue({ ... }),
 *   });
 *
 * Usage — HTTP app:
 *   const { app, prisma, jwt } = await buildHttpApp({ throttle: true });
 *   // throttle: true  →  also mocks ThrottlerGuard / ThrottlerUserGuard
 *
 * Usage — Service module:
 *   const { module, prisma } = await buildServiceModule();
 *   const myService = module.get(MyService);
 */

import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModuleBuilder, TestingModule } from "@nestjs/testing";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { AppModule } from "../src/app.module";
import { SessionCleanupService } from "../src/auth/session-cleanup.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { TtsService } from "../src/tts/tts.service";
import { ThrottlerUserGuard } from "../src/common/guards/throttler-user.guard";
import { configureTestApp } from "./test-app.factory";

// ─── Mock values ──────────────────────────────────────────────────────────────

const mockTts = { speak: jest.fn(), getOrCreateCachedAudio: jest.fn() };

const mockNotifications = {
  createForUser: jest.fn().mockResolvedValue(undefined),
  // Les producteurs envoient désormais de vraies push (#38) : sans ces
  // doublures, le service réel manquerait à l'appel et l'inscription
  // échouerait — ce que seules les suites sur base réelle ont montré.
  createManyForUsers: jest.fn().mockResolvedValue({ count: 0 }),
  sendToUser: jest.fn().mockResolvedValue({ sent: 0, failed: 0, pruned: 0 }),
  sendToUsers: jest
    .fn()
    .mockResolvedValue({ recipients: 0, sent: 0, failed: 0, pruned: 0 }),
  sendToDevice: jest.fn().mockResolvedValue(undefined),
  sendToTopic: jest.fn().mockResolvedValue(undefined),
};

const mockSessionCleanup = {
  onModuleInit: jest.fn(),
  cleanupExpiredSessions: jest.fn(),
  cleanupUserSessions: jest.fn(),
  manualCleanup: jest.fn(),
};

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  delete: jest.fn(),
  deleteByPattern: jest.fn(),
};

const mockThrottlerStorage = {
  storage: {},
  increment: jest
    .fn()
    .mockResolvedValue({ totalHits: 1, timeToExpire: 60, isBlocked: false }),
  getRecord: jest.fn().mockResolvedValue([]),
};

// ─── Options ──────────────────────────────────────────────────────────────────

interface BuildOptions {
  /** Also mock throttler guards (needed for HTTP tests that hit rate-limited routes). */
  throttle?: boolean;
  /** Also mock RedisService (needed for services that cache via Redis). */
  redis?: boolean;
  /** Apply additional provider/guard overrides before compile(). */
  extra?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

// ─── Core builder ─────────────────────────────────────────────────────────────

function applyBaseOverrides(
  builder: TestingModuleBuilder,
  opts: BuildOptions,
): TestingModuleBuilder {
  builder = builder
    .overrideProvider(TtsService)
    .useValue(mockTts)
    .overrideProvider(NotificationsService)
    .useValue(mockNotifications)
    .overrideProvider(SessionCleanupService)
    .useValue(mockSessionCleanup);

  if (opts.throttle) {
    builder = builder
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorageService)
      .useValue(mockThrottlerStorage)
      .overrideProvider(ThrottlerStorage)
      .useValue(mockThrottlerStorage);
  }

  if (opts.redis) {
    builder = builder.overrideProvider(RedisService).useValue(mockRedis);
  }

  if (opts.extra) {
    builder = opts.extra(builder);
  }

  return builder;
}

// ─── Service module (no HTTP) ─────────────────────────────────────────────────

export async function buildServiceModule(
  opts: BuildOptions = {},
): Promise<{ module: TestingModule; prisma: PrismaService }> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  builder = applyBaseOverrides(builder, opts);

  const module = await builder.compile();
  const prisma = module.get<PrismaService>(PrismaService);

  return { module, prisma };
}

// ─── HTTP app (supertest) ─────────────────────────────────────────────────────

export async function buildHttpApp(
  opts: BuildOptions & { throttle?: boolean } = {},
): Promise<{ app: INestApplication; prisma: PrismaService; jwt: JwtService }> {
  const { module, prisma } = await buildServiceModule({
    throttle: true,
    ...opts,
  });

  const app = module.createNestApplication();
  await configureTestApp(app);
  await app.init();

  const jwt = module.get<JwtService>(JwtService);

  return { app, prisma, jwt };
}
