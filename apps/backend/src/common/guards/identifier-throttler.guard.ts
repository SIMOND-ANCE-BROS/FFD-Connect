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

export interface IdentifierThrottleRule {
  /** Body field holding the identifier (login username, e-mail). */
  field: string;
  /** Requests allowed within `ttl`. */
  limit: number;
  /** Window in milliseconds. */
  ttl: number;
  /**
   * Count per (identifier, client IP) pair instead of per identifier alone.
   * Someone hammering an account from one address then only blocks that
   * address, not the account owner signing in from elsewhere.
   */
  perIp?: boolean;
}

/**
 * Per-identifier limits on a public anti-abuse route (#636).
 *
 * The route's own `@Throttle` limit stays keyed on the client IP
 * (`@ThrottleByIp`) and is sized for a venue sharing one address — a gym
 * Wi-Fi or mobile CGNAT on competition day. The rules added here key on the
 * identifier the caller typed, normalised like stored e-mails and hashed (no
 * address sits in the throttler storage):
 *
 * - a tight `perIp` rule (identifier + address): brute force on one account
 *   from one address, without letting a third party lock the owner out from
 *   their own network;
 * - a looser rule on the identifier alone: brute force spread over many
 *   addresses. A distributed attacker can still exhaust it for a window —
 *   the residual cost of not letting one address lock an account.
 *
 * A request without a usable identifier is left to the IP limit alone: the
 * DTO validation rejects it anyway.
 */
export const ThrottleByIdentifier = (...rules: IdentifierThrottleRule[]) =>
  applyDecorators(
    SetMetadata(THROTTLE_BY_IDENTIFIER_KEY, rules),
    UseGuards(IdentifierThrottlerGuard),
  );

@Injectable()
export class IdentifierThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const rules = this.rulesOf(requestProps.context);
    if (!rules?.length) return true;
    const req = requestProps.context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const ip = rules.some((rule) => rule.perIp)
      ? await super.getTracker(req)
      : "";
    for (const rule of rules) {
      const tracker = identifierTracker(
        req["body"],
        rule.field,
        rule.perIp ? ip : undefined,
      );
      if (!tracker) continue;
      // Throws ThrottlerException (429) once this rule's budget is spent.
      await super.handleRequest({
        ...requestProps,
        limit: rule.limit,
        ttl: rule.ttl,
        blockDuration: rule.ttl,
        getTracker: () => tracker,
      });
    }
    return true;
  }

  private rulesOf(
    context: ExecutionContext,
  ): IdentifierThrottleRule[] | undefined {
    return this.reflector.getAllAndOverride<
      IdentifierThrottleRule[] | undefined
    >(THROTTLE_BY_IDENTIFIER_KEY, [context.getHandler(), context.getClass()]);
  }
}

/**
 * Tracker of the normalised identifier found at `field` — `ident:<sha256>`,
 * or `identip:<sha256>` when combined with the client `ip` — or null when the
 * body carries no non-blank string there.
 */
export function identifierTracker(
  body: unknown,
  field: string,
  ip?: string,
): string | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>)[field];
  if (typeof raw !== "string") return null;
  const normalized = normalizeEmail(raw);
  if (!normalized) return null;
  const subject = ip === undefined ? normalized : `${normalized}|${ip}`;
  const digest = createHash("sha256").update(subject).digest("hex");
  return `${ip === undefined ? "ident" : "identip"}:${digest}`;
}
