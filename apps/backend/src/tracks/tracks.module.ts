import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { AdminAuditModule } from "../admin/admin-audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminTracksController } from "./admin-tracks.controller";
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import { BpmService } from "./bpm.service";
import { TrackFilesService } from "./track-files.service";
import { TrackImportService } from "./track-import.service";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";
import { UploadsFallbackController } from "./uploads-fallback.controller";

@Module({
  // The audit trail on its own (no AdminModule auth/users imports).
  imports: [PrismaModule, HttpModule, AdminAuditModule],
  controllers: [
    TracksController,
    AdminTracksController,
    UploadsFallbackController,
  ],
  providers: [
    TracksService,
    BpmService,
    TrackFilesService,
    AdminTracksQueryService,
    TrackImportService,
  ],
  exports: [TracksService],
})
export class TracksModule {}
