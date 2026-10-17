import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import {
  AcknowledgePrivacyPolicyDto,
  PrivacyPolicyNoticeDto,
} from "./dto/privacy-policy-notice.dto";
import { PrivacyPolicyNoticeQueryService } from "./privacy-policy-notice.query-service";
import { PrivacyPolicyNoticeService } from "./privacy-policy-notice.service";

/**
 * In-app notice of a substantial change to the privacy policy (#734, policy
 * §11). Information, not consent: nothing here gates any feature.
 *
 * Store-review account: neither route is on its read allowlist, so its GET
 * reads `{}` (no notice) — it could never acknowledge, its writes being
 * simulated, and would otherwise see the notice at every launch.
 */
@ApiTags("users")
@Controller("users/me/privacy-policy")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
@ApiCommonErrorResponses()
export class PrivacyPolicyController {
  constructor(
    private readonly query: PrivacyPolicyNoticeQueryService,
    private readonly service: PrivacyPolicyNoticeService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Avis de mise à jour de la politique de confidentialité",
    description:
      "Version en vigueur, dernière version dont l'utilisateur a pris connaissance, et s'il faut lui signaler la mise à jour (pending).",
  })
  @ApiResponse({ status: 200, type: PrivacyPolicyNoticeDto })
  getNotice(@Req() req: RequestWithUser): Promise<PrivacyPolicyNoticeDto> {
    return this.query.getNotice(req.user.userId);
  }

  @Post("acknowledge")
  // Only the user can be informed: a staff member using "log in as" (#545)
  // must not dismiss the notice on their behalf.
  @UseGuards(NoImpersonationGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: "J'ai pris connaissance de la politique de confidentialité",
    description:
      "Enregistre la version dont l'utilisateur a pris connaissance ; l'avis ne s'affiche plus pour cette version. 409 si la version envoyée n'est plus celle en vigueur.",
  })
  @ApiResponse({ status: 200, type: PrivacyPolicyNoticeDto })
  @ApiResponse({
    status: 409,
    description: "La version envoyée n'est plus celle en vigueur",
  })
  acknowledge(
    @Req() req: RequestWithUser,
    @Body() body: AcknowledgePrivacyPolicyDto,
  ): Promise<PrivacyPolicyNoticeDto> {
    return this.service.acknowledge(req.user.userId, body.version);
  }
}
