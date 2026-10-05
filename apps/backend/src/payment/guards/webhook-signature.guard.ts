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

/**
 * Guard that verifies HelloAsso webhook signatures using HMAC-SHA256.
 *
 * HelloAsso signs webhook payloads with a shared secret. This guard:
 * 1. Reads the signature from the `X-HelloAsso-Signature` header
 * 2. Computes HMAC-SHA256 of the raw body using the configured secret
 * 3. Compares using timing-safe equality to prevent timing attacks
 *
 * If HELLOASSO_WEBHOOK_SECRET is not configured, the guard rejects all requests
 * to prevent unauthenticated webhook processing.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const secret = this.configService.get<string>("HELLOASSO_WEBHOOK_SECRET");
    if (!secret) {
      this.logger.error(
        "HELLOASSO_WEBHOOK_SECRET is not configured — rejecting webhook",
      );
      throw new UnauthorizedException("Webhook verification not configured");
    }

    const signature = request.headers["x-helloasso-signature"] as
      | string
      | undefined;
    if (!signature) {
      this.logger.warn("Webhook received without signature header");
      throw new UnauthorizedException("Missing webhook signature");
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        "Raw body not available — is rawBody enabled in NestFactory?",
      );
      throw new UnauthorizedException("Cannot verify webhook signature");
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      this.logger.warn("Webhook signature mismatch — rejecting");
      throw new UnauthorizedException("Invalid webhook signature");
    }

    return true;
  }
}
