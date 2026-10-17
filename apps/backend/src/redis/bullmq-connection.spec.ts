import { ConfigService } from "@nestjs/config";
import { buildBullConnection } from "./bullmq-connection";

const defaultsOnlyConfig = (): ConfigService =>
  // Mocked rather than `new ConfigService({})`: the real one also reads
  // process.env, and CI sets REDIS_HOST/REDIS_PORT for the backend-test job.
  ({
    get: jest.fn(
      <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    ),
  }) as unknown as ConfigService;

describe("buildBullConnection", () => {
  it("maps the Redis settings", () => {
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
      },
    });
  });

  it("falls back to localhost:6379 without a password", () => {
    expect(buildBullConnection(defaultsOnlyConfig())).toEqual({
      connection: {
        host: "localhost",
        port: 6379,
        password: undefined,
      },
    });
  });

  it("leaves the wire protocol to ioredis' default, RESP3 (#36)", () => {
    expect(
      buildBullConnection(defaultsOnlyConfig()).connection,
    ).not.toHaveProperty("protocol");
  });
});
