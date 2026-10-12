/**
 * Manual IP blocklist (opt-in via `ENABLE_IP_BLACKLIST=true`).
 *
 * Rejects with 403 any request whose client IP has a `blacklist:ip:<ip>` key
 * set to `"true"` in Redis. The key is written by an operator (redis-cli, with
 * a TTL), never by the application: there is no automatic blocking.
 *
 * Client IP: `req.ip`, i.e. the address Express resolves with `trust proxy`
 * (`TRUST_PROXY_HOPS`, `src/config/trust-proxy.ts`, #182), normalized exactly
 * like the rate limiter does (`normalizeIp`: IPv4 as is, IPv4-mapped IPv6
 * unwrapped, IPv6 grouped by /64). Never read `X-Forwarded-For` here: the
 * client writes that header, so trusting it raw would let anyone evade the
 * blocklist or get another address blocked (#383).
 */

import { ForbiddenException, Injectable, NestMiddleware } from "@nestjs/common";
import { normalizeIp } from "@nestjs/throttler";
import { NextFunction, Request, Response } from "express";
import { RedisService } from "../../redis/redis.service";

/** Redis key prefix of a blocked client IP (or IPv6 /64 subnet). */
export const IP_BLACKLIST_KEY_PREFIX = "blacklist:ip:";

/**
 * Blocklist key of a request's client IP, or `null` when Express could not
 * resolve one (closed socket).
 */
export function ipBlacklistKey(req: Request): string | null {
  const ip = req.ip;
  if (!ip) {
    return null;
  }
  return `${IP_BLACKLIST_KEY_PREFIX}${normalizeIp(ip)}`;
}

@Injectable()
export class IpBlacklistMiddleware implements NestMiddleware {
  constructor(private readonly redis: RedisService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const key = ipBlacklistKey(req);
    if (key && (await this.redis.get(key)) === "true") {
      throw new ForbiddenException("Your IP address has been blocked");
    }
    next();
  }
}
