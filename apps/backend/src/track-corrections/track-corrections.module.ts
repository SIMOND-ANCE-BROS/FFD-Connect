import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TracksModule } from "../tracks/tracks.module";
import { TrackCorrectionsController } from "./track-corrections.controller";
import { TrackCorrectionsQueryService } from "./track-corrections.query-service";
import { TrackCorrectionsService } from "./track-corrections.service";
import { TrackReportController } from "./track-report.controller";

/**
 * Propositions de correction des métadonnées des musiques (file de
 * modération admin). NotificationsModule est global.
 */
@Module({
  imports: [PrismaModule, TracksModule],
  controllers: [TrackCorrectionsController, TrackReportController],
  providers: [TrackCorrectionsService, TrackCorrectionsQueryService],
})
export class TrackCorrectionsModule {}
