import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { AdminAuditModule } from "../admin/admin-audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { BpmService } from "./bpm.service";
import { TrackFilesService } from "./track-files.service";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";
import { UploadsFallbackController } from "./uploads-fallback.controller";

@Module({
  // The audit trail on its own (no AdminModule auth/users imports).
  imports: [PrismaModule, HttpModule, AdminAuditModule],
  controllers: [TracksController, UploadsFallbackController],
  providers: [TracksService, BpmService, TrackFilesService],
  exports: [TracksService],
})
export class TracksModule {}
