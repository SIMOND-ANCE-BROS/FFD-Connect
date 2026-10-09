import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BpmService } from "./bpm.service";
import { TrackFilesService } from "./track-files.service";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";
import { UploadsFallbackController } from "./uploads-fallback.controller";

@Module({
  imports: [PrismaModule, HttpModule],
  controllers: [TracksController, UploadsFallbackController],
  providers: [TracksService, BpmService, TrackFilesService],
  exports: [TracksService],
})
export class TracksModule {}
