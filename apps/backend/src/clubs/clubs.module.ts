import { Module } from "@nestjs/common";
import { ClubsController } from "./clubs.controller";
import { ClubsHelloAssoService } from "./clubs-helloasso.service";
import { ClubsService } from "./clubs.service";
import { PartnershipQueryService } from "./partnership-query.service";
import { PartnershipService } from "./partnership.service";
import { PrismaModule } from "../prisma/prisma.module";
import { SoloTeamService } from "./solo-team.service";

@Module({
  imports: [PrismaModule],
  controllers: [ClubsController],
  providers: [
    ClubsService,
    ClubsHelloAssoService,
    PartnershipService,
    PartnershipQueryService,
    SoloTeamService,
  ],
  exports: [
    ClubsService,
    ClubsHelloAssoService,
    PartnershipService,
    SoloTeamService,
  ],
})
export class ClubsModule {}
