import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Throttle, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { applyTrustProxy } from "../../config/trust-proxy";
import { ThrottleByIp } from "../decorators/throttle-by-ip.decorator";
import { GlobalThrottlerGuard } from "./global-throttler.guard";
import {
  ThrottleByIdentifier,
  identifierTracker,
} from "./identifier-throttler.guard";

const IP_LIMIT = 6;
const IDENTIFIER_LIMIT = 2;

@Controller("auth")
class LoginController {
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: IP_LIMIT } })
  @ThrottleByIp()
  @ThrottleByIdentifier({
    field: "username",
    limit: IDENTIFIER_LIMIT,
    ttl: 60_000,
  })
  login(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }
}

const config = {
  get: (key: string) =>
    ({ JWT_SECRET: "identifier-throttler-spec", TRUST_PROXY_HOPS: 1 })[key],
  getOrThrow: (key: string) =>
    ({ JWT_SECRET: "identifier-throttler-spec", TRUST_PROXY_HOPS: 1 })[key],
} as unknown as ConfigService;

describe("IdentifierThrottlerGuard (HTTP, #636)", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [LoginController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    applyTrustProxy(app, config);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = (username: unknown, ip: string) =>
    request(app.getHttpServer())
      .post("/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ username, password: "x" });

  it("lets many people sign in from one shared address", async () => {
    for (let i = 0; i < IP_LIMIT; i += 1) {
      await login(`dancer${i}@club.fr`, "203.0.113.7").expect(200);
    }
    // The per-IP budget (sized for a venue) is what eventually applies.
    await login("late@club.fr", "203.0.113.7").expect(429);
  });

  it("limits attempts on one account whatever the address", async () => {
    for (let i = 0; i < IDENTIFIER_LIMIT; i += 1) {
      await login("victim@club.fr", `198.51.100.${i + 1}`).expect(200);
    }
    await login("victim@club.fr", "198.51.100.99").expect(429);
  });

  it("counts case and surrounding spaces as the same account", async () => {
    await login("Victim@Club.fr", "192.0.2.1").expect(200);
    await login(" victim@club.fr ", "192.0.2.2").expect(200);
    await login("VICTIM@CLUB.FR", "192.0.2.3").expect(429);
  });

  it("leaves a body without identifier to the IP limit", async () => {
    for (let i = 0; i < IDENTIFIER_LIMIT + 1; i += 1) {
      await login(undefined, "192.0.2.50").expect(200);
    }
  });
});

describe("identifierTracker", () => {
  it("hashes the normalised identifier", () => {
    const a = identifierTracker({ email: "A@B.fr" }, "email");
    expect(a).toMatch(/^ident:[0-9a-f]{64}$/);
    expect(identifierTracker({ email: " a@b.fr" }, "email")).toBe(a);
    expect(a).not.toContain("a@b.fr");
  });

  it.each([[null], ["text"], [{}], [{ email: 42 }], [{ email: "   " }]])(
    "returns null without a usable identifier (%p)",
    (body) => {
      expect(identifierTracker(body, "email")).toBeNull();
    },
  );
});
