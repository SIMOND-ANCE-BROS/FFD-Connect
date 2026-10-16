import { HttpModule } from "@nestjs/axios";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuditModule } from "../admin/admin-audit.module";
import { ClubsModule } from "../clubs/clubs.module";
import { LicenseQrModule } from "../licenses/qr/license-qr.module";
import { RedisModule } from "../redis/redis.module";
import { CompetitionsController } from "./competitions.controller";
import { LiveGateway } from "./live.gateway";
import { CompetitionAccessService } from "./services/competition-access.service";
import { CompetitionCacheService } from "./services/competition-cache.service";
import { CompetitionManagementService } from "./services/competition-management.service";
import { CompetitionProgramQueryService } from "./services/competition-program-query.service";
import { CompetitionProgramService } from "./services/competition-program.service";
import { CompetitionQueryService } from "./services/competition-query.service";
import { CompetitionRegistrationService } from "./services/competition-registration.service";
import { CompetitionResultsService } from "./services/competition-results.service";
import { CompetitionResultsImportService } from "./services/competition-results-import.service";
import { RegistrationNotificationService } from "./services/registration-notification.service";
import { CompetitionEventNotificationService } from "./services/competition-event-notification.service";
import { CompetitionEventsDeductionService } from "./services/competition-events-deduction.service";
import { CompetitionSyncService } from "./services/competition-sync.service";
import { ffdSyncQueueOptions } from "./sync-queue.config";
import { SyncProcessor } from "./sync.processor";

@Module({
  imports: [
    AdminAuditModule,
    HttpModule,
    RedisModule,
    ClubsModule,
    LicenseQrModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>("JWT_SECRET"),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(ffdSyncQueueOptions),
  ],
  controllers: [CompetitionsController],
  providers: [
    CompetitionAccessService,
    CompetitionManagementService,
    CompetitionProgramQueryService,
    CompetitionProgramService,
    CompetitionQueryService,
    CompetitionRegistrationService,
    CompetitionResultsService,
    CompetitionResultsImportService,
    RegistrationNotificationService,
    CompetitionEventNotificationService,
    CompetitionCacheService,
    CompetitionSyncService,
    CompetitionEventsDeductionService,
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
