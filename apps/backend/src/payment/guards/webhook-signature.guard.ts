import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  RawBodyRequest,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";

/** Header carrying the HelloAsso notification signature (lower-case hex). */
export const HELLOASSO_SIGNATURE_HEADER = "x-ha-signature";

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Optional HelloAsso notification signature check (#404).
 *
 * HelloAsso only signs notifications for PARTNER accounts: each notification
 * URL configured through the partner API gets a `signatureKey`, and every
 * notification carries `x-ha-signature` = hex HMAC-SHA256 of the raw body
 * with that key (https://dev.helloasso.com/docs/secure-webhook). A club that
 * connects its own association account (our model, #389) registers its
 * notification URL in its HelloAsso back-office and gets NO signature.
 *
 * So the signature is defense-in-depth, not the source of trust: the webhook
 * never acts on the payload it receives — it re-reads the payment from the
 * HelloAsso API with the organising club's credentials
 * (`HelloAssoNotificationService`).
 *
 * - `HELLOASSO_SIGNATURE_KEY` set (partner mode): a missing, malformed or
 *   wrong signature is rejected (401).
 * - not set (association mode): notifications are accepted unsigned.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.configService.get<string>("HELLOASSO_SIGNATURE_KEY");
    if (!key) return true;

    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const signature = request.headers[HELLOASSO_SIGNATURE_HEADER];
    if (typeof signature !== "string" || !HEX_SHA256.test(signature)) {
      this.logger.warn("Webhook received without a valid signature header");
      throw new UnauthorizedException("Missing webhook signature");
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        "Raw body not available — is rawBody enabled in NestFactory?",
      );
      throw new UnauthorizedException("Cannot verify webhook signature");
    }

    const expected = createHmac("sha256", key).update(rawBody).digest();
    const received = Buffer.from(signature, "hex");

    if (!timingSafeEqual(received, expected)) {
      this.logger.warn("Webhook signature mismatch — rejecting");
      throw new UnauthorizedException("Invalid webhook signature");
    }

    return true;
  }
}
