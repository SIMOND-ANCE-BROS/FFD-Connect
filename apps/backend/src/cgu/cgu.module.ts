import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CguAcceptanceQueryService } from "./cgu-acceptance.query-service";
import { CguAcceptanceService } from "./cgu-acceptance.service";
import { CguController } from "./cgu.controller";

/** CGU acceptance recorded per account (#894). */
@Module({
  imports: [PrismaModule],
  controllers: [CguController],
  providers: [CguAcceptanceQueryService, CguAcceptanceService],
})
export class CguModule {}
