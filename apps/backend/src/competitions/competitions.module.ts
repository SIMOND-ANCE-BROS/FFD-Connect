import { HttpModule } from "@nestjs/axios";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ClubsModule } from "../clubs/clubs.module";
import { RedisModule } from "../redis/redis.module";
import { CompetitionsController } from "./competitions.controller";
import { LiveGateway } from "./live.gateway";
import { CompetitionAccessService } from "./services/competition-access.service";
import { CompetitionCacheService } from "./services/competition-cache.service";
import { CompetitionManagementService } from "./services/competition-management.service";
import { CompetitionQueryService } from "./services/competition-query.service";
import { CompetitionRegistrationService } from "./services/competition-registration.service";
import { CompetitionResultsService } from "./services/competition-results.service";
import { RegistrationNotificationService } from "./services/registration-notification.service";
import { CompetitionEventNotificationService } from "./services/competition-event-notification.service";
import { CompetitionSyncService } from "./services/competition-sync.service";
import { SyncProcessor } from "./sync.processor";

@Module({
  imports: [
    HttpModule,
    RedisModule,
    ClubsModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>("JWT_SECRET"),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: "ffd-sync",
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    }),
  ],
  controllers: [CompetitionsController],
  providers: [
    CompetitionAccessService,
    CompetitionManagementService,
    CompetitionQueryService,
    CompetitionRegistrationService,
    CompetitionResultsService,
    RegistrationNotificationService,
    CompetitionEventNotificationService,
    CompetitionCacheService,
    CompetitionSyncService,
    LiveGateway,
    SyncProcessor,
  ],
  exports: [
    CompetitionManagementService,
    CompetitionRegistrationService,
    CompetitionResultsService,
    LiveGateway,
  ],
})
export class CompetitionsModule {}
