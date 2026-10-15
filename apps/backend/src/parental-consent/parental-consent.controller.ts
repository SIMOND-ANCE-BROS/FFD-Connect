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
import { Throttle } from "@nestjs/throttler";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { StoreReviewOwnData } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import {
  ConfirmParentalConsentDto,
  ParentalConsentLinkDto,
  ParentalConsentStateDto,
  ParentalConsentTokenDto,
  RequestParentalConsentDto,
} from "./dto/parental-consent.dto";
import { ParentalConsentQueryService } from "./parental-consent.query-service";
import { ParentalConsentService } from "./parental-consent.service";

/**
 * Parental consent of minors (#61). Two audiences:
 * - the minor (JWT): their state, and the parent's address to write to;
 * - the parent (no account): the link's token, sent in the BODY — never in a
 *   path or query string that access logs would keep.
 */
@ApiTags("parental-consent")
@Controller("parental-consent")
@ApiCommonErrorResponses()
export class ParentalConsentController {
  constructor(
    private readonly service: ParentalConsentService,
    private readonly query: ParentalConsentQueryService,
  ) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @StoreReviewOwnData()
  @ApiOperation({
    summary: "État du consentement parental de mon compte",
    description:
      "NOT_REQUIRED pour un majeur (ou un âge inconnu) ; sinon REQUIRED, PENDING ou GRANTED.",
  })
  @ApiResponse({ status: 200, type: ParentalConsentStateDto })
  async getMine(@Req() req: RequestWithUser): Promise<ParentalConsentStateDto> {
    return this.query.getState(req.user.userId);
  }

  @Post("request")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({
    summary:
      "Envoyer (ou renvoyer) la demande d'accord à un représentant légal",
    description:
      "Envoie un lien de confirmation à l'adresse indiquée. Une demande encore en attente est remplacée (son lien cesse de fonctionner). Refusé pour un compte qui n'en a pas besoin (400) ou déjà autorisé (409).",
  })
  @ApiResponse({ status: 200, type: ParentalConsentStateDto })
  @ApiResponse({
    status: 503,
    description: "L'e-mail n'a pas pu être envoyé ; la demande est annulée",
  })
  async request(
    @Req() req: RequestWithUser,
    @Body() body: RequestParentalConsentDto,
  ): Promise<ParentalConsentStateDto> {
    return this.service.request(req.user.userId, body.parentEmail);
  }

  @Post("lookup")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      "Lire la demande désignée par un lien (page du représentant légal)",
  })
  @ApiResponse({ status: 200, type: ParentalConsentLinkDto })
  async lookup(
    @Body() body: ParentalConsentTokenDto,
  ): Promise<ParentalConsentLinkDto> {
    return this.query.lookup(body.token);
  }

  @Post("confirm")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: "Le représentant légal donne son accord",
    description:
      "Une seule fois, avant l'expiration du lien. Les deux accords (données, données de santé) sont requis.",
  })
  @ApiResponse({ status: 200, type: ParentalConsentLinkDto })
  async confirm(
    @Body() body: ConfirmParentalConsentDto,
  ): Promise<ParentalConsentLinkDto> {
    return this.service.confirm(body.token);
  }

  @Post("revoke")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: "Le représentant légal retire (ou refuse) son accord",
    description:
      "Possible à tout moment avec le même lien. Le compte redevient limité et les certificats médicaux du mineur sont supprimés.",
  })
  @ApiResponse({ status: 200, type: ParentalConsentLinkDto })
  async revoke(
    @Body() body: ParentalConsentTokenDto,
  ): Promise<ParentalConsentLinkDto> {
    return this.service.revoke(body.token);
  }
}
