import { INestApplication, Logger, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { HEALTH_PREFIX_EXCLUDE, HealthController } from "./health.controller";
import { HealthService } from "./health.service";

/**
 * Regression guard for #43.
 *
 * `/health` is the target of the deployment smoke test (it compares `version`
 * to the SHA it just deployed and rolls back on a mismatch), of the Uptime
 * workflow and of the client's pre-wake. If it ever slipped under the `api/v1`
 * global prefix, all three would break at once — and the smoke test would read
 * that as a failed deployment.
 *
 * The exclusion used to be `["health", "health/(.*)"]`. NestJS still accepted
 * the second pattern through `LegacyRouteConverter`, which rewrote it to
 * `health/{*path}` and logged a warning on every boot; that converter is going
 * away. These tests assert both halves: no legacy conversion happens, and the
 * routes really are served at the root.
 */
describe("health route prefix exclusion", () => {
  let app: INestApplication;
  let warn: jest.SpyInstance;

  const mockHealthService = {
    check: jest.fn().mockResolvedValue({ status: "ok", version: "test-sha" }),
    getMetrics: jest.fn().mockReturnValue({ uptime: 1 }),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: mockHealthService }],
    }).compile();

    app = moduleRef.createNestApplication();

    // Installed before setGlobalPrefix(): that call is where NestJS resolves
    // the exclusion list through LegacyRouteConverter, so it is where the
    // warning would be emitted — not at init().
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    app.setGlobalPrefix("api/v1", { exclude: HEALTH_PREFIX_EXCLUDE });
    await app.init();
  });

  afterEach(async () => {
    warn.mockRestore();
    await app.close();
  });

  it("boots without a LegacyRouteConverter warning", () => {
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(
      messages.filter((message) => message.includes("Unsupported route path")),
    ).toEqual([]);
  });

  it.each([
    ["/health", 200],
    ["/health/live", 200],
    ["/health/metrics", 200],
  ])("serves %s at the root, outside api/v1", async (path, status) => {
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get(path);
    expect(res.status).toBe(status);
  });

  it("does not also expose /health under the api/v1 prefix", async () => {
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    ).get("/api/v1/health");
    expect(res.status).toBe(404);
  });

  /**
   * The exclusion is an explicit list rather than a wildcard, so a route added
   * to the controller without a matching entry would silently move under
   * `api/v1`. This test is what makes that trade-off safe.
   */
  it("excludes every route the controller declares", () => {
    const basePath = Reflect.getMetadata(
      PATH_METADATA,
      HealthController,
    ) as string;

    const declared = Object.getOwnPropertyNames(HealthController.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => {
        const handler = HealthController.prototype[
          name as keyof HealthController
        ] as unknown as object;
        return {
          path: Reflect.getMetadata(PATH_METADATA, handler) as
            | string
            | undefined,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as
            | RequestMethod
            | undefined,
        };
      })
      .filter(
        (route): route is { path: string; method: RequestMethod } =>
          route.path !== undefined && route.method !== undefined,
      )
      .map((route) => ({
        path: [basePath, route.path].join("/").replace(/\/+$/, ""),
        method: route.method,
      }));

    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared.map((r) => `${r.method} ${r.path}`))).toEqual(
      new Set(
        HEALTH_PREFIX_EXCLUDE.map((r) => `${r.method} ${String(r.path)}`),
      ),
    );
  });
});
