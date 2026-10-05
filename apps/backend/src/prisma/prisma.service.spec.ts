import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { slowQueryCallback, PrismaService } from "./prisma.service";

const makeConfigService = (env: Record<string, string>) =>
  ({
    get: (key: string) => env[key],
  }) as unknown as ConfigService;

describe("slowQueryCallback", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("does NOT log when query is fast", async () => {
    const query = jest.fn().mockResolvedValue("result");
    await slowQueryCallback({
      operation: "findMany",
      model: "User",
      args: {},
      query,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs a warning when query exceeds threshold", async () => {
    // Simulate a slow query by making Date.now advance 201ms
    let callCount = 0;
    jest.spyOn(Date, "now").mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 0 : 201;
    });

    const query = jest.fn().mockResolvedValue("result");
    await slowQueryCallback({
      operation: "findMany",
      model: "User",
      args: {},
      query,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SlowQuery]"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("User.findMany"),
    );

    jest.spyOn(Date, "now").mockRestore();
  });

  it("uses 'raw' as model fallback when model is undefined", async () => {
    let callCount = 0;
    jest.spyOn(Date, "now").mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 0 : 201;
    });

    const query = jest.fn().mockResolvedValue("result");
    await slowQueryCallback({
      operation: "queryRaw",
      model: undefined,
      args: {},
      query,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("raw.queryRaw"),
    );

    jest.spyOn(Date, "now").mockRestore();
  });
});

describe("PrismaService", () => {
  const DATABASE_URL = "postgresql://test:test@localhost:5432/test";

  it("should instantiate without errors", () => {
    expect(
      () => new PrismaService(makeConfigService({ DATABASE_URL })),
    ).not.toThrow();
  });

  describe("onModuleInit", () => {
    it("calls $extends in development mode", async () => {
      const service = new PrismaService(
        makeConfigService({ DATABASE_URL, NODE_ENV: "development" }),
      );

      jest.spyOn(service, "$connect").mockResolvedValue(undefined);
      const extendsSpy = jest
        .spyOn(service, "$extends")
        .mockReturnValue(service as never);

      await service.onModuleInit();

      expect(extendsSpy).toHaveBeenCalled();
      extendsSpy.mockRestore();
    });

    it("does NOT call $extends outside development mode", async () => {
      const service = new PrismaService(
        makeConfigService({ DATABASE_URL, NODE_ENV: "test" }),
      );

      jest.spyOn(service, "$connect").mockResolvedValue(undefined);
      const extendsSpy = jest
        .spyOn(service, "$extends")
        .mockReturnValue(service as never);

      await service.onModuleInit();

      expect(extendsSpy).not.toHaveBeenCalled();
      extendsSpy.mockRestore();
    });
  });
});
