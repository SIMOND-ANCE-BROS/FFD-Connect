import { ConfigService } from "@nestjs/config";
import { REDIS_PROTOCOL, buildBullConnection } from "./bullmq-connection";

describe("buildBullConnection", () => {
  it("maps the Redis settings and pins the shared protocol", () => {
    const values: Record<string, string | number> = {
      REDIS_HOST: "redis.internal",
      REDIS_PORT: 6380,
      REDIS_PASSWORD: "s3cret",
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    expect(buildBullConnection(config)).toEqual({
      connection: {
        host: "redis.internal",
        port: 6380,
        password: "s3cret",
        protocol: REDIS_PROTOCOL,
      },
    });
  });

  it("falls back to localhost:6379 without a password", () => {
    const config = new ConfigService({});

    expect(buildBullConnection(config)).toEqual({
      connection: {
        host: "localhost",
        port: 6379,
        password: undefined,
        protocol: REDIS_PROTOCOL,
      },
    });
  });

  it("keeps RESP2 until the production Redis version is verified (#36)", () => {
    expect(REDIS_PROTOCOL).toBe(2);
  });
});
