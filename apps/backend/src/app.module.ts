import { Inject, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { TrackCorrectionsModule } from "./track-corrections/track-corrections.module";
import { TracksModule } from "./tracks/tracks.module";

import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuthModule } from "./auth/auth.module";
import { StoreReviewInterceptor } from "./auth/store-review/store-review.interceptor";
import { CareerModule } from "./career/career.module";
import { CircuitBreakerModule } from "./common/circuit-breaker/circuit-breaker.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { GlobalThrottlerGuard } from "./common/guards/global-throttler.guard";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { LoggerModule } from "./common/logger/logger.module";
import { MetricsInterceptor } from "./common/metrics/metrics.interceptor";
import { MetricsModule } from "./common/metrics/metrics.module";
import { IpBlacklistMiddleware } from "./common/middleware/ip-blacklist.middleware";
import { ClubsModule } from "./clubs/clubs.module";
import { CompetitionsModule } from "./competitions/competitions.module";
import { validate } from "./config/env.validation";
import ffdConfig from "./config/ffd.config";
import { HealthModule } from "./health/health.module";
import { LicensesModule } from "./licenses/licenses.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ParentalConsentModule } from "./parental-consent/parental-consent.module";
import { PrivacyPolicyModule } from "./privacy-policy/privacy-policy.module";
import { PaymentModule } from "./payment/payment.module";
import { buildBullConnection } from "./redis/bullmq-connection";
import { RedisModule } from "./redis/redis.module";
import { ReportsModule } from "./reports/reports.module";
import { StorageModule } from "./storage/storage.module";
import { TtsModule } from "./tts/tts.module";
import { UsersModule } from "./users/users.module";
import { WdsfModule } from "./wdsf/wdsf.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [ffdConfig],
      validate,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requêtes par minute
      },
    ]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: buildBullConnection,
      inject: [ConfigService],
    }),
    CircuitBreakerModule,
    LoggerModule,
    MetricsModule,
    RedisModule,
    StorageModule,
    AuthModule,
    AdminModule,
    AnalyticsModule,
    TracksModule,
    TrackCorrectionsModule,
    TtsModule,
    PrismaModule,
    // No static file server on uploads/: track media are served by
    // UploadsFallbackController (flat media names only, #293).
    CareerModule,
    ClubsModule,
    CompetitionsModule,
    ReportsModule,
    UsersModule,
    WdsfModule,
    NotificationsModule,
    LicensesModule,
    ParentalConsentModule,
    PrivacyPolicyModule,
    HealthModule,
    PaymentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      // Per user for a verified access token, else per client IP; always per
      // IP on @ThrottleByIp() routes (login, register…) (#182, #633).
      provide: APP_GUARD,
      useClass: GlobalThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
    {
      // Last global interceptor: logging and metrics still see simulated writes.
      provide: APP_INTERCEPTOR,
      useClass: StoreReviewInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  @Inject(ConfigService) private readonly configService!: ConfigService;

  configure(consumer: MiddlewareConsumer): void {
    if (this.configService.get<string>("ENABLE_IP_BLACKLIST") === "true") {
      consumer.apply(IpBlacklistMiddleware).forRoutes("*");
    }
  }
}
