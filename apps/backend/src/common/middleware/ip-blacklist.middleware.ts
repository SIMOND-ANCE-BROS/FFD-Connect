/**
 * Middleware de blacklist pour les IPs suspectes
 * Bloque les requêtes provenant d'IPs suspectes ou blacklistées
 */

import { Injectable, NestMiddleware, ForbiddenException } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { RedisService } from "../../redis/redis.service";
import { Logger } from "@nestjs/common";

@Injectable()
export class IpBlacklistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IpBlacklistMiddleware.name);

  constructor(private readonly redis: RedisService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const ip = this.getClientIp(req);

    // Vérifier si l'IP est blacklistée
    const isBlacklisted = await this.redis.get(`blacklist:ip:${ip}`);

    if (isBlacklisted === "true") {
      throw new ForbiddenException("Your IP address has been blocked");
    }

    // Vérifier le nombre de tentatives échouées
    const failedAttempts = await this.redis.get(`failed_attempts:${ip}`);
    const failedCount = failedAttempts ? parseInt(failedAttempts, 10) : 0;

    // Blacklister après 10 tentatives échouées
    if (failedCount >= 10) {
      await this.redis.set(`blacklist:ip:${ip}`, "true", 3600); // 1 heure
      this.logger.warn(
        `IP ${ip} blacklisted after ${failedCount} failed attempts`,
      );
      throw new ForbiddenException(
        "Too many failed attempts. IP temporarily blocked",
      );
    }

    next();
  }

  /** Trusted proxy CIDRs — Caddy runs on the same host or Docker network */
  private static readonly TRUSTED_PROXIES = new Set([
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "172.17.0.1", // Docker bridge default gateway
  ]);

  /**
   * Extrait l'IP réelle du client depuis les headers.
   * Only trusts X-Forwarded-For when the direct connection is from a known
   * reverse proxy (Caddy). Otherwise, uses the socket address to prevent
   * IP spoofing via forged headers.
   */
  private getClientIp(req: Request): string {
    const directIp = req.socket.remoteAddress ?? "unknown";

    // Only trust forwarded headers from known proxies
    if (IpBlacklistMiddleware.TRUSTED_PROXIES.has(directIp)) {
      const forwarded = req.headers["x-forwarded-for"];
      if (typeof forwarded === "string") {
        return forwarded.split(",")[0].trim();
      }
    }

    return directIp;
  }

  /**
   * Enregistre une tentative échouée pour une IP
   */
  async recordFailedAttempt(ip: string): Promise<void> {
    const key = `failed_attempts:${ip}`;
    const current = await this.redis.get(key);
    const count = current ? parseInt(current, 10) : 0;
    await this.redis.set(key, (count + 1).toString(), 3600); // Expire après 1 heure
  }

  /**
   * Réinitialise les tentatives échouées pour une IP
   */
  async resetFailedAttempts(ip: string): Promise<void> {
    await this.redis.delete(`failed_attempts:${ip}`);
  }

  /**
   * Ajoute une IP à la blacklist manuellement
   */
  async blacklistIp(ip: string, ttlSeconds: number = 3600): Promise<void> {
    await this.redis.set(`blacklist:ip:${ip}`, "true", ttlSeconds);
  }

  /**
   * Retire une IP de la blacklist
   */
  async unblacklistIp(ip: string): Promise<void> {
    await this.redis.delete(`blacklist:ip:${ip}`);
  }
}
