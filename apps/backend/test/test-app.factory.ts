import { INestApplication, ValidationPipe } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import {
  ThrottlerGuard,
  ThrottlerStorage,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { TestingModuleBuilder } from "@nestjs/testing";
import { SessionCleanupService } from "./../src/auth/session-cleanup.service";
import { API_GLOBAL_PREFIX } from "./../src/common/api-prefix";
import { HEALTH_PREFIX_EXCLUDE } from "./../src/health/health.controller";
import { ThrottlerUserGuard } from "./../src/common/guards/throttler-user.guard";
import { MetricsService } from "./../src/common/metrics/metrics.service";
import { SyncProcessor } from "./../src/competitions/sync.processor";
import { UPLOADS_FALLBACK_PREFIX_EXCLUDE } from "./../src/tracks/uploads-fallback.controller";

/**
 * Configure l'application de test avec la même configuration que main.ts
 * (ValidationPipe, etc.) pour que les tests E2E reflètent le comportement réel.
 */

export async function configureTestApp(app: INestApplication): Promise<void> {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: [...HEALTH_PREFIX_EXCLUDE, UPLOADS_FALLBACK_PREFIX_EXCLUDE],
  });
}

const mockQueue = {
  add: jest.fn(),
  getJobCounts: jest.fn().mockResolvedValue({}),
  close: jest.fn(),
};

/**
 * Applies standard overrides to prevent background services and
 * open handles from interfering with e2e tests.
 * BullMQ uses real Redis (available in CI) — we only mock the queues
 * and background services that would cause side effects.
 */
export function applyE2EOverrides(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder
    .overrideProvider(SessionCleanupService)
    .useValue({
      onModuleInit: jest.fn(),
      cleanupExpiredSessions: jest.fn(),
      cleanupUserSessions: jest.fn(),
      manualCleanup: jest.fn(),
    })
    .overrideProvider(MetricsService)
    .useValue({
      onModuleInit: jest.fn(),
      recordHttpMetric: jest.fn(),
      recordDatabaseMetric: jest.fn(),
    })
    .overrideProvider(SyncProcessor)
    .useValue({ process: jest.fn() })
    .overrideProvider(getQueueToken("ffd-sync"))
    .useValue(mockQueue)
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(ThrottlerUserGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(ThrottlerStorageService)
    .useValue({
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60000,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60000,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    });
}
