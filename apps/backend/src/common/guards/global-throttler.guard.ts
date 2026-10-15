import { ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from "@nestjs/throttler";
import { THROTTLE_BY_IP_KEY } from "../decorators/throttle-by-ip.decorator";

/**
 * Global rate limiter (APP_GUARD). It runs before any route guard, so before
 * authentication, and keys each request on:
 *
 * - `gsub:<sub>` when the request carries a validly signed, unexpired access
 *   token (same secret and checks as JwtStrategy, verified here — never just
 *   decoded). Users behind the same address (a gym Wi-Fi on competition day,
 *   mobile CGNAT) then no longer share a budget sized for one person (#182,
 *   #633). This holds on every route, public ones included (`GET
 *   /competitions/:id` is public but the app calls it signed in);
 * - the client IP (`req.ip`, real client address once `trust proxy` is set —
 *   see `config/trust-proxy.ts`) for a request without a token, or with a
 *   missing, malformed, forged or expired one: an unverified token never picks
 *   its bucket, so rotating fake tokens cannot dodge the limit;
 * - the client IP, always, on a route marked `@ThrottleByIp()`: anti-abuse
 *   limits aimed at anonymous callers (login, register, password reset,
 *   Wallet pass links, volunteer check-in…), where one budget per account
 *   would multiply an attacker's budget by the accounts they hold.
 *
 * A valid token of a disabled or deleted account still gets its own bucket:
 * the request is then refused (401) by JwtAuthGuard, and the token expires
 * within the access-token lifetime.
 *
 * It never skips: `ThrottlerUserGuard` runs after `JwtAuthGuard` (and
 * `RolesGuard`), so a request refused in between — 401 for a disabled or
 * deleted account, 403 for a missing role — is counted by no other guard.
 * Counting it here, before authentication, keeps the route limit in force
 * whatever the outcome.
 *
 * The `gsub:` prefix differs from `ThrottlerUserGuard`'s `user:` on purpose:
 * both guards share the storage and key format (class, handler, throttler
 * name, tracker), and the same prefix would decrement one bucket twice per
 * request, halving the limit.
 */
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  private readonly jwt: JwtService;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    configService: ConfigService,
  ) {
    super(options, storageService, reflector);
    // Same secret and checks (signature + expiry) as JwtStrategy.
    this.jwt = new JwtService({
      secret: configService.getOrThrow<string>("JWT_SECRET"),
    });
  }

  /** The base guard calls the tracker with `(req, context)`. */
  protected async getTracker(
    req: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    if (context && !this.isKeyedByIp(context)) {
      const subject = await this.verifiedSubject(req);
      if (subject) {
        return `gsub:${subject}`;
      }
    }
    return super.getTracker(req);
  }

  private isKeyedByIp(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(
        THROTTLE_BY_IP_KEY,
        [context.getHandler(), context.getClass()],
      ) === true
    );
  }

  /** `sub` of a validly signed, unexpired bearer token; otherwise null. */
  private async verifiedSubject(
    req: Record<string, unknown>,
  ): Promise<string | null> {
    const headers = req["headers"] as Record<string, unknown> | undefined;
    const authorization = headers?.["authorization"];
    if (typeof authorization !== "string") {
      return null;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) {
      return null;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(match[1]);
      return typeof payload.sub === "string" && payload.sub.length > 0
        ? payload.sub
        : null;
    } catch {
      return null;
    }
  }
}
