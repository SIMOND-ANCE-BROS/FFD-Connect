import { Request, Response } from "express";
import { Test, TestingModule } from "@nestjs/testing";
import { RedisService } from "../../redis/redis.service";
import { IpBlacklistMiddleware } from "./ip-blacklist.middleware";

describe("IpBlacklistMiddleware", () => {
  let middleware: IpBlacklistMiddleware;
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };

  const createRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      ip: "192.168.1.1",
      socket: { remoteAddress: "192.168.1.1" },
      headers: {},
      ...overrides,
    }) as Request;

  const createNext = () => jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpBlacklistMiddleware,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    middleware = module.get(IpBlacklistMiddleware);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
  });

  it("should call next() when IP is not blacklisted and has no failed attempts", async () => {
    const req = createRequest();
    const next = createNext();

    await middleware.use(req, {} as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it("should throw when IP is blacklisted", async () => {
    mockRedis.get.mockImplementation((key: string) =>
      key.includes("blacklist")
        ? Promise.resolve("true")
        : Promise.resolve(null),
    );
    const req = createRequest();

    await expect(
      middleware.use(req, {} as Response, createNext()),
    ).rejects.toThrow("Your IP address has been blocked");
  });

  it("should throw when failed attempts exceed threshold", async () => {
    mockRedis.get
      .mockResolvedValueOnce(null) // blacklist check
      .mockResolvedValueOnce("10"); // failed_attempts
    mockRedis.set.mockResolvedValue(undefined);
    const req = createRequest();

    await expect(
      middleware.use(req, {} as Response, createNext()),
    ).rejects.toThrow("Too many failed attempts");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "blacklist:ip:192.168.1.1",
      "true",
      3600,
    );
  });

  it("recordFailedAttempt increments count", async () => {
    mockRedis.get.mockResolvedValue("2");
    mockRedis.set.mockResolvedValue(undefined);

    await middleware.recordFailedAttempt("10.0.0.1");

    expect(mockRedis.set).toHaveBeenCalledWith(
      "failed_attempts:10.0.0.1",
      "3",
      3600,
    );
  });

  it("resetFailedAttempts and unblacklistIp call delete", async () => {
    mockRedis.delete.mockResolvedValue(undefined);

    await middleware.resetFailedAttempts("10.0.0.1");
    expect(mockRedis.delete).toHaveBeenCalledWith("failed_attempts:10.0.0.1");

    mockRedis.delete.mockClear();
    await middleware.unblacklistIp("10.0.0.1");
    expect(mockRedis.delete).toHaveBeenCalledWith("blacklist:ip:10.0.0.1");
  });

  describe("getClientIp proxy validation", () => {
    it("trusts X-Forwarded-For from trusted proxy (127.0.0.1)", async () => {
      const req = createRequest({
        socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
        headers: { "x-forwarded-for": "203.0.113.50, 10.0.0.1" },
      });
      const next = createNext();

      await middleware.use(req, {} as Response, next);

      // Should check blacklist for the forwarded client IP, not the proxy IP
      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:203.0.113.50");
    });

    it("ignores X-Forwarded-For from untrusted source (spoofing attempt)", async () => {
      const req = createRequest({
        socket: { remoteAddress: "198.51.100.1" } as Request["socket"],
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      const next = createNext();

      await middleware.use(req, {} as Response, next);

      // Should check blacklist for the direct socket IP, ignoring the forged header
      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:198.51.100.1");
    });

    it("uses socket remoteAddress for direct connections without proxy", async () => {
      const req = createRequest({
        socket: { remoteAddress: "203.0.113.99" } as Request["socket"],
        headers: {},
      });
      const next = createNext();

      await middleware.use(req, {} as Response, next);

      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:203.0.113.99");
    });

    it("trusts X-Forwarded-For from Docker bridge gateway (172.17.0.1)", async () => {
      const req = createRequest({
        socket: { remoteAddress: "172.17.0.1" } as Request["socket"],
        headers: { "x-forwarded-for": "192.0.2.42" },
      });
      const next = createNext();

      await middleware.use(req, {} as Response, next);

      expect(mockRedis.get).toHaveBeenCalledWith("blacklist:ip:192.0.2.42");
    });
  });

  it("blacklistIp sets key with TTL", async () => {
    mockRedis.set.mockResolvedValue(undefined);

    await middleware.blacklistIp("10.0.0.1", 7200);

    expect(mockRedis.set).toHaveBeenCalledWith(
      "blacklist:ip:10.0.0.1",
      "true",
      7200,
    );
  });
});
