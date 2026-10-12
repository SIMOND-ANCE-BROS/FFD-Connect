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
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";
import { HelloAssoNotificationService } from "./helloasso-notification.service";
import { PaymentService } from "./payment.service";

@ApiTags("payment")
@ApiCommonErrorResponses()
@Controller("payment")
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly helloAssoNotificationService: HelloAssoNotificationService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post("checkout")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Crée un checkout HelloAsso",
    description:
      "Initie un paiement via HelloAsso pour une réservation de place en compétition. " +
      "Le montant est celui du tarif de la place (`priceCents` de l'élément du plan), jamais celui envoyé par le client.",
  })
  @ApiBody({ type: CreateCheckoutDto })
  @ApiResponse({ status: 201, description: "Checkout intent créé" })
  @ApiResponse({
    status: 400,
    description: "Club sans HelloAsso, place sans tarif ou données invalides",
  })
  @ApiResponse({ status: 401, description: "Non authentifié" })
  async createCheckout(
    @Req() req: RequestWithUser,
    @Body() body: CreateCheckoutDto,
  ) {
    return this.paymentService.createCheckout(req.user.userId, body);
  }

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  @ApiOperation({
    summary: "Webhook HelloAsso",
    description:
      "Reçoit les notifications HelloAsso. Le contenu de la notification n'est jamais cru : " +
      "le paiement est relu sur l'API HelloAsso (intention de paiement de la réservation, identifiants du club). " +
      "Signature `x-ha-signature` vérifiée si une clé partenaire est configurée. " +
      "Une réservation n'est confirmée que si l'ordre est payé, du montant attendu, pour la bonne compétition ; " +
      "sinon elle reste en attente et la réponse reste 200 (pas de rejeu). 503 si HelloAsso est injoignable (rejeu).",
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
    }
    return { received: true };
  }
}
