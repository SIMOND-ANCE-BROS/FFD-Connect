import {
  ExecutionContext,
  Injectable,
  SetMetadata,
  applyDecorators,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerRequest } from "@nestjs/throttler";
import { createHash } from "crypto";
import { normalizeEmail } from "../../auth/email-identity";

export const THROTTLE_BY_IDENTIFIER_KEY = "ffd:throttle-by-identifier";

export interface IdentifierThrottleOptions {
  /** Body field holding the identifier (login username, e-mail). */
  field: string;
  /** Requests allowed per identifier within `ttl`. */
  limit: number;
  /** Window in milliseconds. */
  ttl: number;
}

/**
 * A second, per-identifier limit on a public anti-abuse route (#636).
 *
 * The route's own `@Throttle` limit stays keyed on the client IP
 * (`@ThrottleByIp`) and is sized for a whole venue sharing one address — a
 * gym Wi-Fi or mobile CGNAT on competition day. This guard adds the tight
 * limit that protects one account against brute force, keyed on the
 * identifier the caller typed (normalised like stored e-mails, then hashed so
 * no address sits in the throttler storage). Spreading attempts on one
 * account over many addresses gains nothing; many people signing in from the
 * same address no longer share a budget sized for one.
 *
 * A request without a usable identifier is left to the IP limit alone: the
 * DTO validation rejects it anyway.
 */
export const ThrottleByIdentifier = (options: IdentifierThrottleOptions) =>
  applyDecorators(
    SetMetadata(THROTTLE_BY_IDENTIFIER_KEY, options),
    UseGuards(IdentifierThrottlerGuard),
  );

@Injectable()
export class IdentifierThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const options = this.optionsOf(requestProps.context);
    if (!options) return true;
    const tracker = identifierTracker(
      requestProps.context.switchToHttp().getRequest<{ body?: unknown }>().body,
      options.field,
    );
    if (!tracker) return true;
    return super.handleRequest({
      ...requestProps,
      limit: options.limit,
      ttl: options.ttl,
      blockDuration: options.ttl,
      getTracker: () => tracker,
    });
  }

  private optionsOf(
    context: ExecutionContext,
  ): IdentifierThrottleOptions | undefined {
    return this.reflector.getAllAndOverride<
      IdentifierThrottleOptions | undefined
    >(THROTTLE_BY_IDENTIFIER_KEY, [context.getHandler(), context.getClass()]);
  }
}

/**
 * `ident:<sha256>` of the normalised identifier found at `field`, or null when
 * the body carries no non-blank string there.
 */
export function identifierTracker(body: unknown, field: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>)[field];
  if (typeof raw !== "string") return null;
  const normalized = normalizeEmail(raw);
  if (!normalized) return null;
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `ident:${digest}`;
}
