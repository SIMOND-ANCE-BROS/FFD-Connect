import { ExecutionContext, Injectable } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
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
import { ThrottlerUserGuard } from "./throttler-user.guard";

/**
 * Global rate limiter (APP_GUARD). It runs before any route guard, so before
 * authentication, and keys each request on:
 *
 * - `gsub:<sub>` on a route that declares a per-user limit with
 *   `ThrottlerUserGuard`, when the request carries a validly signed, unexpired
 *   access token (same secret and checks as JwtStrategy, #182). Users behind
 *   the same address (a gym Wi-Fi on competition day, mobile CGNAT) then no
 *   longer share a budget sized for one person;
 * - the client IP (`req.ip`, real client address once `trust proxy` is set —
 *   see `config/trust-proxy.ts`) everywhere else: public routes (login,
 *   refresh, register, Wallet pass links…), and per-user routes hit with a
 *   missing, forged or expired token.
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
    if (context && this.hasPerUserLimit(context)) {
      const subject = await this.verifiedSubject(req);
      if (subject) {
        return `gsub:${subject}`;
      }
    }
    return super.getTracker(req);
  }

  private hasPerUserLimit(context: ExecutionContext): boolean {
    return [
      ...this.routeGuards(context.getClass()),
      ...this.routeGuards(context.getHandler()),
    ].some(isPerUserThrottler);
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

  private routeGuards(target: object): unknown[] {
    return (
      this.reflector.get<unknown[] | undefined>(
        GUARDS_METADATA,
        target as () => unknown,
      ) ?? []
    );
  }
}

function isPerUserThrottler(guard: unknown): boolean {
  if (guard instanceof ThrottlerUserGuard) {
    return true;
  }
  return (
    typeof guard === "function" &&
    (guard === ThrottlerUserGuard ||
      (guard.prototype as unknown) instanceof ThrottlerUserGuard)
  );
}
