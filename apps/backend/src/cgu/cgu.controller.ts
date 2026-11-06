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
import { CguAcceptanceQueryService } from "./cgu-acceptance.query-service";
import { CguAcceptanceService } from "./cgu-acceptance.service";
import { AcceptCguDto, CguAcceptanceDto } from "./dto/cgu-acceptance.dto";

/**
 * Acceptance of the CGU, recorded per ACCOUNT (#894). It used to live on the
 * device only, so a second account on the same phone was never asked.
 *
 * Store-review account: neither route is on its read allowlist, so its GET
 * reads `{}` — the app then falls back to the acceptance it keeps for that
 * account on the device (its writes being simulated, the server would never
 * remember it).
 */
@ApiTags("users")
@Controller("users/me/cgu")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
@ApiCommonErrorResponses()
export class CguController {
  constructor(
    private readonly query: CguAcceptanceQueryService,
    private readonly service: CguAcceptanceService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Acceptation des CGU par le compte",
    description:
      "Version en vigueur des CGU, dernière version acceptée par ce compte (avec sa date) et si elle est à jour (accepted).",
  })
  @ApiResponse({ status: 200, type: CguAcceptanceDto })
  getAcceptance(@Req() req: RequestWithUser): Promise<CguAcceptanceDto> {
    return this.query.getAcceptance(req.user.userId);
  }

  @Post("accept")
  // Consent is personal: a staff member using "log in as" (#545) must not
  // accept the CGU on the user's behalf.
  @UseGuards(NoImpersonationGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: "J'accepte les CGU",
    description:
      "Enregistre l'acceptation de la version en vigueur par ce compte (idempotent : la date de la première acceptation est conservée). 409 si la version envoyée n'est plus celle en vigueur.",
  })
  @ApiResponse({ status: 200, type: CguAcceptanceDto })
  @ApiResponse({
    status: 409,
    description: "La version envoyée n'est plus celle en vigueur",
  })
  accept(
    @Req() req: RequestWithUser,
    @Body() body: AcceptCguDto,
  ): Promise<CguAcceptanceDto> {
    return this.service.accept(req.user.userId, body.version);
  }
}
