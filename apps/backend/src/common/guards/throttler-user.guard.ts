import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Guard de rate limiting qui utilise l'ID utilisateur (JWT) comme clé
 * si l'utilisateur est authentifié, sinon fallback sur l'IP.
 *
 * Le guard global (`GlobalThrottlerGuard`) ignore les routes qui portent ce
 * guard : leur limite n'est comptée QUE par utilisateur (#182).
 *
 * Permet d'avoir des limites per-user indépendamment de l'IP :
 * - Un utilisateur derrière un NAT partagé est limité individuellement
 * - Un attaquant changeant d'IP reste limité par son token JWT
 *
 * @example Utilisation avec des limites strictes sur un endpoint sensible :
 * ```typescript
 * @UseGuards(ThrottlerUserGuard)
 * @Throttle({ default: { ttl: 60000, limit: 5 } })
 * @Post('sync')
 * async sync() { ... }
 * ```
 */
@Injectable()
export class ThrottlerUserGuard extends ThrottlerGuard {
  /**
   * Retourne l'identifiant à utiliser comme clé de rate limiting.
   * Priorité : userId (JWT) > IP
   *
   * `JwtStrategy.validate` peuple `req.user` avec `{ userId, email, role,
   * impersonatedBy }` : il n'y a pas de champ `id`. Ne lire que `id` faisait
   * donc retomber TOUTES les requêtes authentifiées sur la clé IP, et le rate
   * limiting per-user annoncé par ce guard n'existait pas. `id` reste accepté en
   * second, pour toute stratégie future qui poserait cette forme.
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req["user"] as { userId?: string; id?: string } | undefined;
    const userId = user?.userId ?? user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    // Fallback on the client IP, exactly as the base ThrottlerGuard computes
    // it: `req.ip` (real client address once `trust proxy` is set, #182),
    // IPv6 grouped by subnet. Never read `X-Forwarded-For` here: the client
    // writes that header, so trusting it raw would let anyone pick its key.
    const ip = (await super.getTracker(req)) as string | undefined;
    return `ip:${ip ?? ""}`;
  }
}
