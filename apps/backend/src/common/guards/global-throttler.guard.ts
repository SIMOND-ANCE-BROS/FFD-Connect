import { ExecutionContext, Injectable } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerUserGuard } from "./throttler-user.guard";

/**
 * Global rate limiter (APP_GUARD), keyed by the client IP (`req.ip`, real
 * client address once `trust proxy` is set — see `config/trust-proxy.ts`).
 *
 * It runs before any route guard, so before authentication: it cannot know
 * the user. Routes that declare their own per-user limit with
 * `ThrottlerUserGuard` are therefore skipped here and counted ONLY per user
 * by that guard (#182). Otherwise their `@Throttle` override would also apply
 * per IP, and everyone behind the same address (a gym Wi-Fi on competition
 * day, mobile CGNAT) would share a budget sized for one person.
 *
 * Every other route — public ones (login, refresh, register, Wallet pass
 * links…) included — keeps the per-IP limit.
 */
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    const guards = [
      ...this.routeGuards(context.getClass()),
      ...this.routeGuards(context.getHandler()),
    ];
    return Promise.resolve(guards.some(isPerUserThrottler));
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
