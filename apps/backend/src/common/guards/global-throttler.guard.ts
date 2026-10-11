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
 * Global rate limiter (APP_GUARD), keyed by the client IP (`req.ip`, real
 * client address once `trust proxy` is set — see `config/trust-proxy.ts`).
 *
 * It runs before any route guard, so before authentication. Routes that
 * declare their own per-user limit with `ThrottlerUserGuard` are counted ONLY
 * per user by that guard (#182) — otherwise their `@Throttle` override would
 * also apply per IP, and everyone behind the same address (a gym Wi-Fi on
 * competition day, mobile CGNAT) would share a budget sized for one person.
 *
 * The skip is granted only to a request that carries a validly signed,
 * unexpired access token: `ThrottlerUserGuard` runs after `JwtAuthGuard`, so
 * a request rejected with 401 never reaches it. Skipping on the route alone
 * (or on a mere `Authorization` header) would leave forged or garbage tokens
 * unlimited; they stay counted here, per IP, with the route's limit.
 *
 * Every other route — public ones (login, refresh, register, Wallet pass
 * links…) included — keeps the per-IP limit.
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

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const guards = [
      ...this.routeGuards(context.getClass()),
      ...this.routeGuards(context.getHandler()),
    ];
    if (!guards.some(isPerUserThrottler)) {
      return false;
    }
    const { req } = this.getRequestResponse(context);
    return this.hasValidAccessToken(req);
  }

  private async hasValidAccessToken(
    req: Record<string, unknown>,
  ): Promise<boolean> {
    const headers = req["headers"] as Record<string, unknown> | undefined;
    const authorization = headers?.["authorization"];
    if (typeof authorization !== "string") {
      return false;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) {
      return false;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(match[1]);
      return typeof payload.sub === "string" && payload.sub.length > 0;
    } catch {
      return false;
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
