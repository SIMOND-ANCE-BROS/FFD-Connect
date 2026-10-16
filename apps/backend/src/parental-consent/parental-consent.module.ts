import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ParentalConsentEmailService } from "./parental-consent-email.service";
import { ParentalConsentController } from "./parental-consent.controller";
import { ParentalConsentQueryService } from "./parental-consent.query-service";
import { ParentalConsentService } from "./parental-consent.service";

/** Parental consent of minors (#61, epic #23). */
@Module({
  imports: [PrismaModule],
  controllers: [ParentalConsentController],
  providers: [
    ParentalConsentService,
    ParentalConsentQueryService,
    ParentalConsentEmailService,
  ],
  exports: [ParentalConsentService, ParentalConsentQueryService],
})
export class ParentalConsentModule {}
