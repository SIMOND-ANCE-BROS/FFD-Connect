import { ConfigService } from "@nestjs/config";

/**
 * Reverse-proxy hops in front of the backend in production: the Azure
 * Container Apps ingress (Envoy) is the only one. It appends the address of
 * the client it received the connection from to `X-Forwarded-For`.
 */
export const PRODUCTION_PROXY_HOPS = 1;

/**
 * Number of proxy hops Express trusts to compute `req.ip` (#182).
 *
 * `trust proxy = N` makes Express take the N-th address from the right of
 * `X-Forwarded-For` (the socket address counting as the first). Only the
 * entries appended by our own proxies are trusted, so a client cannot spoof
 * its IP by sending its own header: anything it writes ends up further left
 * and is ignored. `true` (trust every hop) would take the left-most entry,
 * which the client controls — never use it.
 *
 * - `TRUST_PROXY_HOPS` set: that value (validated as an integer in [0, 10]).
 * - otherwise `PRODUCTION_PROXY_HOPS` in production (staging and prod both run
 *   with `NODE_ENV=production` behind the ingress), and 0 elsewhere: in local
 *   dev the client talks to the socket directly and the header is ignored.
 */
export function resolveTrustProxyHops(configService: ConfigService): number {
  const configured: unknown = configService.get("TRUST_PROXY_HOPS");
  if (configured !== undefined && configured !== null && configured !== "") {
    const hops = Number(configured);
    if (Number.isInteger(hops) && hops >= 0) {
      return hops;
    }
  }
  return configService.get<string>("NODE_ENV") === "production"
    ? PRODUCTION_PROXY_HOPS
    : 0;
}

/** Minimal surface of `NestExpressApplication` used to apply the setting. */
export interface TrustProxyTarget {
  set(setting: string, value: number): unknown;
}

/** Applies {@link resolveTrustProxyHops} to the Express app; returns the hops. */
export function applyTrustProxy(
  app: TrustProxyTarget,
  configService: ConfigService,
): number {
  const hops = resolveTrustProxyHops(configService);
  app.set("trust proxy", hops);
  return hops;
}
