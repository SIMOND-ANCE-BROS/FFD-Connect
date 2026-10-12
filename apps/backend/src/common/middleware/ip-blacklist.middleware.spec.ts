import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Request, Response } from "express";
import request from "supertest";
import { RedisService } from "../../redis/redis.service";
import {
  IpBlacklistMiddleware,
  ipBlacklistKey,
} from "./ip-blacklist.middleware";

describe("IpBlacklistMiddleware", () => {
  const mockRedis = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
  });

  describe("use (unit)", () => {
    const middleware = new IpBlacklistMiddleware(
      mockRedis as unknown as RedisService,
    );
    const createRequest = (ip: string | undefined): Request =>
      ({ ip, headers: {} }) as Request;

    it("calls next() when the IP is not blocked", async () => {
      const next = jest.fn();

      await middleware.use(createRequest("192.0.2.1"), {} as Response, next);

      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:192.0.2.1");
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("rejects with 403 when the IP is blocked", async () => {
      mockRedis.get.mockResolvedValue("true");
      const next = jest.fn();

      await expect(
        middleware.use(createRequest("192.0.2.1"), {} as Response, next),
      ).rejects.toThrow("Your IP address has been blocked");
      expect(next).not.toHaveBeenCalled();
    });

    it("only treats the exact value 'true' as blocked", async () => {
      mockRedis.get.mockResolvedValue("1");
      const next = jest.fn();

      await middleware.use(createRequest("192.0.2.1"), {} as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it("lets the request through without a Redis lookup when req.ip is unknown", async () => {
      const next = jest.fn();

      await middleware.use(createRequest(undefined), {} as Response, next);

      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("ipBlacklistKey", () => {
    const keyOf = (ip: string | undefined) => ipBlacklistKey({ ip } as Request);

    it("keeps an IPv4 address as is", () => {
      expect(keyOf("203.0.113.7")).toBe("blacklist:ip:203.0.113.7");
    });

    it("unwraps an IPv4-mapped IPv6 address", () => {
      expect(keyOf("::ffff:203.0.113.7")).toBe("blacklist:ip:203.0.113.7");
    });

    it("groups IPv6 addresses by /64 like the rate limiter", () => {
      expect(keyOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(
        "blacklist:ip:2001:db8:1:2::/64",
      );
      expect(keyOf("2001:db8:1:2::1")).toBe("blacklist:ip:2001:db8:1:2::/64");
    });

    it("returns null when req.ip is missing", () => {
      expect(keyOf(undefined)).toBeNull();
      expect(keyOf("")).toBeNull();
    });
  });

  /**
   * Real Express stack: `req.ip` comes from `trust proxy`, exactly as in
   * `main.ts`. supertest connects from 127.0.0.1, which plays the ingress.
   */
  describe("behind trust proxy (#383)", () => {
    @Controller()
    class PingController {
      @Get("ping")
      ping(): string {
        return "pong";
      }
    }

    @Module({
      controllers: [PingController],
      providers: [{ provide: RedisService, useValue: mockRedis }],
    })
    class PingModule implements NestModule {
      // Same wiring as AppModule when ENABLE_IP_BLACKLIST=true.
      configure(consumer: MiddlewareConsumer): void {
        consumer.apply(IpBlacklistMiddleware).forRoutes("*");
      }
    }

    let app: INestApplication;

    const boot = async (trustProxyHops: number) => {
      const moduleRef = await Test.createTestingModule({
        imports: [PingModule],
      }).compile();
      const nestApp = moduleRef.createNestApplication<NestExpressApplication>({
        logger: false,
      });
      nestApp.set("trust proxy", trustProxyHops);
      await nestApp.init();
      app = nestApp;
    };

    const blockOnly = (blockedIp: string) =>
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === `blacklist:ip:${blockedIp}` ? "true" : null),
      );

    afterEach(async () => {
      await app.close();
    });

    it("blocks the client address appended by the trusted proxy", async () => {
      await boot(1);
      blockOnly("198.51.100.9");

      await request(app.getHttpServer())
        .get("/ping")
        .set("X-Forwarded-For", "198.51.100.9")
        .expect(403);
    });

    it("does not block another client behind the same proxy", async () => {
      await boot(1);
      blockOnly("198.51.100.9");

      await request(app.getHttpServer())
        .get("/ping")
        .set("X-Forwarded-For", "203.0.113.20")
        .expect(200);
      // The proxy (socket) address is never the key: blocking a client must
      // not block everyone behind the ingress.
      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:203.0.113.20");
      expect(mockRedis.get).not.toHaveBeenCalledWith("blacklist:ip:127.0.0.1");
    });

    it("cannot be evaded by a forged X-Forwarded-For entry", async () => {
      await boot(1);
      blockOnly("198.51.100.9");

      // The blocked client prepends a clean address; the proxy appends the
      // real one on the right, which is the only entry trusted.
      await request(app.getHttpServer())
        .get("/ping")
        .set("X-Forwarded-For", "203.0.113.20, 198.51.100.9")
        .expect(403);
    });

    it("cannot be used to look up (or frame) another IP", async () => {
      await boot(1);
      blockOnly("203.0.113.20");

      // A client forging the victim's address on the left is still keyed on
      // its own (right-most) address.
      await request(app.getHttpServer())
        .get("/ping")
        .set("X-Forwarded-For", "203.0.113.20, 198.51.100.9")
        .expect(200);
      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:198.51.100.9");
      expect(mockRedis.get).not.toHaveBeenCalledWith(
        "blacklist:ip:203.0.113.20",
      );
    });

    it("ignores X-Forwarded-For entirely without trust proxy (local dev)", async () => {
      await boot(0);
      blockOnly("198.51.100.9");

      await request(app.getHttpServer())
        .get("/ping")
        .set("X-Forwarded-For", "198.51.100.9")
        .expect(200);
      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:127.0.0.1");
    });
  });
});
