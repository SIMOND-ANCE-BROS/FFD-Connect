import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import {
  CheckoutResponseDto,
  CreateCheckoutDto,
} from "./dto/create-checkout.dto";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";
import { HelloAssoNotificationService } from "./helloasso-notification.service";
import { PaymentService } from "./payment.service";
import { SeatReleaseService } from "./seat-release.service";

@ApiTags("payment")
@ApiCommonErrorResponses()
@Controller("payment")
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly helloAssoNotificationService: HelloAssoNotificationService,
    private readonly seatReleaseService: SeatReleaseService,
  ) {}

  // Per user (#402): a checkout holds a seat for 50 minutes; with the cap of
  // 4 pending bookings per competition (#428, in the database), a burst of
  // checkouts cannot lock a venue.
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("checkout")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Crée un checkout HelloAsso",
    description:
      "Initie un paiement via HelloAsso pour UNE place d'un élément du plan (vente à la place). " +
      "Élément numéroté (table, gradin) : `seatIndex` désigne la place (absent : première place libre). " +
      "Placement libre (autre élément) : pas de `seatIndex`, une place parmi la capacité. " +
      "Le montant est celui du tarif d'une place (`priceCents` de l'élément), jamais celui envoyé par le client. " +
      "La place est retenue 50 minutes. 409 si elle est déjà prise, si l'élément est complet " +
      "ou si l'utilisateur a déjà 4 réservations en attente pour la compétition. " +
      "Une place qu'on a laissée expirer ne peut être réservée de nouveau par le même utilisateur " +
      "qu'après un délai (30 minutes par défaut, `SEAT_REHOLD_COOLDOWN_MINUTES`) : 409 entre-temps " +
      "si elle est demandée explicitement ; sans `seatIndex`, le choix automatique l'évite (409 seulement s'il ne reste qu'elle). " +
      "Un nouveau checkout sur sa propre place en attente reprend le paiement (`resumed: true`).",
  })
  @ApiBody({ type: CreateCheckoutDto })
  @ApiResponse({
    status: 201,
    description: "Checkout intent créé ou repris",
    type: CheckoutResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      "Club sans HelloAsso, place sans tarif, place inexistante ou verrouillée, données invalides",
  })
  @ApiResponse({ status: 401, description: "Non authentifié" })
  @ApiResponse({
    status: 409,
    description:
      "Place déjà réservée, élément complet, 4 réservations en attente, place laissée expirer trop récemment, ou paiement déjà en cours",
  })
  @ApiResponse({
    status: 503,
    description: "HelloAsso injoignable lors de la reprise d'un paiement",
  })
  async createCheckout(
    @Req() req: RequestWithUser,
    @Body() body: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    return this.paymentService.createCheckout(req.user.userId, body);
  }

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  @ApiOperation({
    summary: "Webhook HelloAsso",
    description:
      "Route historique du connecteur HelloAsso (identique à `POST /payment/webhook/helloasso`, #388). " +
      "Reçoit les notifications HelloAsso. Le contenu de la notification n'est jamais cru : " +
      "le paiement est relu sur l'API HelloAsso (intention de paiement de la réservation, identifiants du club). " +
      "Signature `x-ha-signature` vérifiée si une clé partenaire est configurée. " +
      "Une réservation n'est confirmée que si l'ordre est payé, du montant attendu, pour la bonne compétition ; " +
      "sinon elle reste en attente et la réponse reste 200 (pas de rejeu). " +
      "Un paiement remboursé (`Refunded`) ou contesté (`Contested`), confirmé par l'API HelloAsso, libère la place (`CANCELLED`). " +
      "Un paiement reçu sur une ancienne intention d'une réservation libérée (`CANCELLED`) ne rend pas la place : il est noté remboursement dû et le club organisateur est alerté. " +
      "503 si HelloAsso est injoignable (rejeu).",
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: "Webhook traité" })
  @ApiResponse({ status: 401, description: "Signature invalide" })
  @ApiResponse({
    status: 503,
    description:
      "HelloAsso injoignable ou paiement pas encore autorisé : HelloAsso rejouera la notification",
  })
  async handleWebhook(
    // HelloAsso sends many fields we don't declare: the global pipe's
    // `forbidNonWhitelisted` would answer 400 (and trigger retries). The
    // parameter type is deliberately not the DTO class (`Readonly<…>` is
    // emitted as `Object`, which the global pipe skips); this local pipe
    // validates against the DTO and strips unknown fields instead.
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        expectedType: WebhookPayloadDto,
      }),
    )
    payload: Readonly<WebhookPayloadDto>,
  ) {
    if (payload.eventType === "Order") {
      // Never the received body: the order as HelloAsso's API reports it.
      const verified =
        await this.helloAssoNotificationService.resolveOrderNotification(
          payload,
        );
      if (verified) await this.paymentService.handleOrderWebhook(verified);
    } else if (payload.eventType === "Payment") {
      // Refund / dispute releases the seat (#403), state re-read from HelloAsso.
      await this.seatReleaseService.handlePaymentNotification(payload);
    }
    return { received: true };
  }

  /**
   * Webhook route of the HelloAsso connector (#388, ADR-0023: one route per
   * connector). Same guard, validation and processing as the historical
   * `POST /payment/webhook`, which stays the HelloAsso route while clubs'
   * notification URLs still point to it.
   */
  @Post("webhook/helloasso")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  @ApiOperation({
    summary: "Webhook du connecteur HelloAsso",
    description:
      "Route dédiée au connecteur HelloAsso (une route par connecteur de paiement, #388). " +
      "Même vérification et même traitement que `POST /payment/webhook` : la notification n'est jamais crue, " +
      "le paiement est relu sur l'API HelloAsso avec les identifiants du club organisateur. " +
      "Signature `x-ha-signature` vérifiée si une clé partenaire est configurée.",
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: "Webhook traité" })
  @ApiResponse({ status: 401, description: "Signature invalide" })
  @ApiResponse({
    status: 503,
    description:
      "HelloAsso injoignable ou paiement pas encore autorisé : HelloAsso rejouera la notification",
  })
  async handleHelloAssoWebhook(
    // Same local pipe as `handleWebhook` (undeclared HelloAsso fields
    // stripped, never a 400).
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        expectedType: WebhookPayloadDto,
      }),
    )
    payload: Readonly<WebhookPayloadDto>,
  ) {
    return this.handleWebhook(payload);
  }
}
