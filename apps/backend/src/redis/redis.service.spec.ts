import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import Redis from "ioredis";
import { RedisService } from "./redis.service";

const mockRedisInstance = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  keys: jest.fn(),
  scan: jest.fn(),
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

describe("RedisService", () => {
  let service: RedisService;
  const mockRedis = mockRedisInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockConfigService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);

    // Trigger the 'connect' event manually to simulate availability
    const connectCallback = (
      mockRedisInstance.on.mock.calls as [string, () => void][]
    ).find((call) => call[0] === "connect")?.[1];
    if (connectCallback) connectCallback();
  });

  // Guards the RESP2 pin. ioredis 6 defaults to protocol 3; nothing here needs
  // it, and no test connects BullMQ or this client to a real Redis (issue
  // #771), so dropping the pin would silently change the wire format for the
  // job queue. If this fails because the pin was removed on purpose, remove it
  // together with the comments in redis.service.ts and app.module.ts.
  it("pins the RESP2 protocol on the client it constructs", () => {
    expect(service).toBeDefined();
    const RedisCtor = Redis as unknown as jest.Mock;
    expect(RedisCtor).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 2 }),
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("get", () => {
    it("should return value from redis", async () => {
      mockRedis.get.mockResolvedValue("value");
      const result = await service.get("key");
      expect(result).toBe("value");
      expect(mockRedis["get"]).toHaveBeenCalledWith("key");
    });

    it("should return null if redis fails", async () => {
      mockRedis.get.mockRejectedValue(new Error("error"));
      const result = await service.get("key");
      expect(result).toBeNull();
    });

    it("should return null if redis is unavailable", async () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      const result = await service.get("key");
      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("should set value in redis without TTL", async () => {
      await service.set("key", "value");
      expect(mockRedis["set"]).toHaveBeenCalledWith("key", "value");
    });

    it("should set value in redis with TTL", async () => {
      await service.set("key", "value", 100);
      expect(mockRedis["setex"]).toHaveBeenCalledWith("key", 100, "value");
    });

    it("should handle set errors silently", async () => {
      mockRedis.set.mockRejectedValue(new Error("error"));
      await expect(service.set("key", "value")).resolves.toBeUndefined();
    });

    it("should skip if redis is unavailable", async () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      await service.set("key", "value");
      expect(mockRedis["set"]).not.toHaveBeenCalled();
    });
  });

  describe("exists", () => {
    it("should return true if key exists", async () => {
      mockRedis.exists.mockResolvedValue(1);
      const result = await service.exists("key");
      expect(result).toBe(true);
    });

    it("should return false if key does not exist", async () => {
      mockRedis.exists.mockResolvedValue(0);
      const result = await service.exists("key");
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockRedis.exists.mockRejectedValue(new Error("error"));
      const result = await service.exists("key");
      expect(result).toBe(false);
    });

    it("should return false if redis is unavailable", async () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      const result = await service.exists("key");
      expect(result).toBe(false);
      expect(mockRedis["exists"]).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete key from redis", async () => {
      await service.delete("key");
      expect(mockRedis["del"]).toHaveBeenCalledWith("key");
    });

    it("should handle delete errors silently", async () => {
      mockRedis.del.mockRejectedValue(new Error("error"));
      await expect(service.delete("key")).resolves.toBeUndefined();
    });

    it("should skip if redis is unavailable", async () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      await service.delete("key");
      expect(mockRedis["del"]).not.toHaveBeenCalled();
    });
  });

  describe("deleteByPattern", () => {
    it("should scan and delete matching keys", async () => {
      // First scan returns keys, second scan returns cursor "0" to end the loop
      mockRedis.scan
        .mockResolvedValueOnce(["42", ["key:1", "key:2"]])
        .mockResolvedValueOnce(["0", ["key:3"]]);
      mockRedis.del.mockResolvedValue(undefined);

      await service.deleteByPattern("key:*");

      expect(mockRedis["scan"]).toHaveBeenCalledTimes(2);
      expect(mockRedis["scan"]).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "key:*",
        "COUNT",
        100,
      );
      expect(mockRedis["scan"]).toHaveBeenCalledWith(
        "42",
        "MATCH",
        "key:*",
        "COUNT",
        100,
      );
      expect(mockRedis["del"]).toHaveBeenCalledWith("key:1", "key:2");
      expect(mockRedis["del"]).toHaveBeenCalledWith("key:3");
    });

    it("should not call del when scan returns no keys", async () => {
      mockRedis.scan.mockResolvedValueOnce(["0", []]);

      await service.deleteByPattern("nonexistent:*");

      expect(mockRedis["scan"]).toHaveBeenCalledTimes(1);
      expect(mockRedis["del"]).not.toHaveBeenCalled();
    });

    it("should skip if redis is unavailable", async () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      await service.deleteByPattern("key:*");
      expect(mockRedis["scan"]).not.toHaveBeenCalled();
    });

    it("should handle scan errors gracefully", async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, "error");
      mockRedis.scan.mockRejectedValue(new Error("scan failed"));

      await expect(service.deleteByPattern("key:*")).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to delete keys by pattern"),
      );
    });
  });

  describe("keys", () => {
    it("should return keys matching pattern", async () => {
      const mockKeys = ["key1", "key2"];
      mockRedis.keys.mockResolvedValue(mockKeys);
      const result = await service.keys("pattern*");
      expect(result).toBe(mockKeys);
    });

    it("should return empty array on error", async () => {
      mockRedis.keys.mockRejectedValue(new Error("error"));
      const result = await service.keys("pattern*");
      expect(result).toEqual([]);
    });

    it("should return empty array if redis is unavailable", async () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      const result = await service.keys("pattern*");
      expect(result).toEqual([]);
      expect(mockRedis["keys"]).not.toHaveBeenCalled();
    });
  });

  describe("getClient", () => {
    it("should return the redis client instance", () => {
      const client = service.getClient();
      expect(client).toBe(mockRedisInstance);
    });

    it("should return null when client is null", () => {
      (service as unknown as { client: unknown }).client = null;
      const client = service.getClient();
      expect(client).toBeNull();
    });
  });

  describe("constructor & connection", () => {
    it("should configure retryStrategy correctly", () => {
      const Redis = require("ioredis") as unknown as jest.Mock;
      const lastCallIndex = Redis.mock.calls.length - 1;
      const calls = Redis.mock.calls as unknown[][];
      const args = calls[lastCallIndex] || [];
      const config = args[0] as {
        retryStrategy: (times: number) => number | null;
      };
      const strategy = config.retryStrategy;

      expect(strategy(1)).toBe(100);
      expect(strategy(3)).toBe(300);
      expect(strategy(4)).toBeNull();
    });

    it("should log connection success", () => {
      const loggerSpy = jest.spyOn(Logger.prototype, "log");
      const connectCallback = (
        mockRedis.on.mock.calls as [string, () => void][]
      ).find((call) => call[0] === "connect")?.[1];
      if (connectCallback) connectCallback();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Redis connected"),
      );
    });

    it("should log warning on ECONNREFUSED error", () => {
      const loggerSpy = jest.spyOn(Logger.prototype, "warn");
      const errorCallback = (
        mockRedis.on.mock.calls as [
          string,
          (err: { message: string }) => void,
        ][]
      ).find((call) => call[0] === "error")?.[1];

      if (errorCallback) {
        errorCallback({ message: "ECONNREFUSED" });
      }

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Redis not available"),
      );
    });

    it("should NOT log warning on other errors", () => {
      const loggerSpy = jest.spyOn(Logger.prototype, "warn");
      const errorCallback = (
        mockRedis.on.mock.calls as [
          string,
          (err: { message: string }) => void,
        ][]
      ).find((call) => call[0] === "error")?.[1];

      if (errorCallback) {
        // Clear previous calls from constructor
        loggerSpy.mockClear();
        errorCallback({ message: "OTHER_ERROR" });
      }

      const redisNotAvailableCalls = loggerSpy.mock.calls.filter((call) =>
        String(call[0]).includes("Redis not available"),
      );
      expect(redisNotAvailableCalls.length).toBe(0);
    });

    it("should handle connection failure in constructor", async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, "warn");

      // We need to re-instantiate to test constructor catch
      mockRedis.connect.mockRejectedValueOnce(new Error("Connection failed"));

      const mockConfigService2 = {
        get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          { provide: ConfigService, useValue: mockConfigService2 },
        ],
      }).compile();
      module.get<RedisService>(RedisService);

      // Await microtasks to let .catch() run
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const connectionFailedCall = loggerSpy.mock.calls.find((call) =>
        String(call[0]).includes("Redis connection failed"),
      );
      expect(connectionFailedCall).toBeDefined();
    });
  });

  describe("isAvailable", () => {
    it("should return true when redis is available", () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        true;
      expect(service.isAvailable()).toBe(true);
    });

    it("should return false when redis is not available", () => {
      (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable =
        false;
      expect(service.isAvailable()).toBe(false);
    });

    it("should return false when client is null", () => {
      (service as unknown as { client: unknown }).client = null;
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe("onModuleDestroy", () => {
    it("should disconnect from client if it exists", () => {
      service.onModuleDestroy();
      expect(mockRedis.disconnect).toHaveBeenCalled();
    });

    it("should not throw if client does not exist", () => {
      (service as unknown as { client: unknown }).client = null;
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
