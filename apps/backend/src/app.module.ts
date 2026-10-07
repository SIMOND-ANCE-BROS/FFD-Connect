import { Inject, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { TrackCorrectionsModule } from "./track-corrections/track-corrections.module";
import { TracksModule } from "./tracks/tracks.module";

import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CareerModule } from "./career/career.module";
import { CircuitBreakerModule } from "./common/circuit-breaker/circuit-breaker.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
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
import { PaymentModule } from "./payment/payment.module";
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
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>("REDIS_HOST", "localhost"),
          port: configService.get<number>("REDIS_PORT", 6379),
          password: configService.get<string>("REDIS_PASSWORD"),
          // BullMQ constructs its own ioredis client from these options, so
          // ioredis 6's RESP3 default would reach the queue without any code
          // change here. BullMQ leans on raw replies from Lua scripts and no
          // test connects it to a real Redis (issue #771), so pin RESP2 until
          // that coverage exists. Same rationale as RedisService.
          protocol: 2,
        },
      }),
      inject: [ConfigService],
    }),
    CircuitBreakerModule,
    LoggerModule,
    MetricsModule,
    RedisModule,
    StorageModule,
    AuthModule,
    AdminModule,
    TracksModule,
    TrackCorrectionsModule,
    TtsModule,
    PrismaModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "uploads"),
      serveRoot: "/uploads",
    }),
    CareerModule,
    ClubsModule,
    CompetitionsModule,
    ReportsModule,
    UsersModule,
    WdsfModule,
    NotificationsModule,
    LicensesModule,
    HealthModule,
    PaymentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
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
