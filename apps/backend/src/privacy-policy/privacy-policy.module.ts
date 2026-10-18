import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PrivacyPolicyController } from "./privacy-policy.controller";
import { PrivacyPolicyNoticeQueryService } from "./privacy-policy-notice.query-service";
import { PrivacyPolicyNoticeService } from "./privacy-policy-notice.service";

/** In-app notice of privacy policy changes (#734). */
@Module({
  imports: [PrismaModule],
  controllers: [PrivacyPolicyController],
  providers: [PrivacyPolicyNoticeQueryService, PrivacyPolicyNoticeService],
})
export class PrivacyPolicyModule {}
