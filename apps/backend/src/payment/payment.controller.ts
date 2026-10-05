import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
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
import { PaymentService } from "./payment.service";

@ApiTags("payment")
@ApiCommonErrorResponses()
@Controller("payment")
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtAuthGuard)
  @Post("checkout")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Crée un checkout HelloAsso",
    description:
      "Initie un paiement via HelloAsso pour une réservation de place en compétition.",
  })
  @ApiBody({ type: CreateCheckoutDto })
  @ApiResponse({ status: 201, description: "Checkout intent créé" })
  @ApiResponse({
    status: 400,
    description: "Club sans HelloAsso ou données invalides",
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
      "Reçoit les notifications de paiement HelloAsso. Vérifié par signature HMAC-SHA256.",
  })
  @ApiBody({ type: WebhookPayloadDto })
  @ApiResponse({ status: 200, description: "Webhook traité" })
  @ApiResponse({ status: 401, description: "Signature invalide" })
  async handleWebhook(@Body() payload: WebhookPayloadDto) {
    if (payload.eventType === "Order" && payload.data.metadata?.bookingId) {
      await this.paymentService.confirmBooking(payload.data.metadata.bookingId);
    }
    return { received: true };
  }
}
