import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Throttle, ThrottlerModule } from "@nestjs/throttler";
import type { Request } from "express";
import request from "supertest";
import { applyTrustProxy } from "../../config/trust-proxy";
import { GlobalThrottlerGuard } from "./global-throttler.guard";
import { ThrottlerUserGuard } from "./throttler-user.guard";

const GLOBAL_LIMIT = 3;
const ROUTE_LIMIT = 2;
const ROUTE_THROTTLE = { default: { ttl: 60_000, limit: ROUTE_LIMIT } };

/** Stands in for JwtAuthGuard: `x-test-user` becomes `req.user.userId`. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId: string } }>();
    const userId = req.headers["x-test-user"];
    if (typeof userId !== "string") throw new UnauthorizedException();
    req.user = { userId };
    return true;
  }
}

@Controller("t")
class RoutesController {
  @Get("ip")
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }

  @Post("public")
  @Throttle(ROUTE_THROTTLE)
  publicRoute(): { ok: true } {
    return { ok: true };
  }

  @Post("per-user")
  @UseGuards(FakeAuthGuard, ThrottlerUserGuard)
  @Throttle(ROUTE_THROTTLE)
  perUser(): { ok: true } {
    return { ok: true };
  }
}

@UseGuards(FakeAuthGuard, ThrottlerUserGuard)
@Controller("class-level")
class ClassLevelController {
  @Post()
  @Throttle(ROUTE_THROTTLE)
  run(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Global per-IP throttler + per-user throttler over HTTP, with the same
 * `trust proxy` setup as main.ts (#182).
 */
describe("GlobalThrottlerGuard (HTTP)", () => {
  let app: NestExpressApplication;

  const boot = async (trustProxyHops: number) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: GLOBAL_LIMIT }]),
      ],
      controllers: [RoutesController, ClassLevelController],
      providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    const config = {
      get: (key: string) =>
        key === "TRUST_PROXY_HOPS" ? trustProxyHops : undefined,
    } as unknown as ConfigService;
    applyTrustProxy(app, config);
    await app.init();
  };

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const from = (forwardedFor: string) => ({ "X-Forwarded-For": forwardedFor });

  describe("client IP behind one proxy hop", () => {
    beforeEach(() => boot(1));

    it("takes the address appended by the ingress", async () => {
      const res = await request(server()).get("/t/ip").set(from("203.0.113.7"));
      expect(res.body).toEqual({ ip: "203.0.113.7" });
    });

    it("ignores addresses forged by the client further left", async () => {
      const res = await request(server())
        .get("/t/ip")
        .set(from("6.6.6.6, 203.0.113.7"));
      expect(res.body).toEqual({ ip: "203.0.113.7" });
    });
  });

  it("ignores X-Forwarded-For entirely when no proxy is trusted", async () => {
    await boot(0);
    const res = await request(server()).get("/t/ip").set(from("203.0.113.7"));
    expect(res.body.ip).not.toBe("203.0.113.7");
  });

  describe("public routes: limited per real client IP", () => {
    beforeEach(() => boot(1));

    it("limits one IP without limiting another one", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await request(server())
          .post("/t/public")
          .set(from("203.0.113.1"))
          .expect(201);
      }
      const blocked = await request(server())
        .post("/t/public")
        .set(from("203.0.113.1"));
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

      await request(server())
        .post("/t/public")
        .set(from("203.0.113.2"))
        .expect(201);
    });

    it("cannot be bypassed by forging X-Forwarded-For", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await request(server())
          .post("/t/public")
          .set(from(`198.51.100.${i}, 203.0.113.1`))
          .expect(201);
      }
      await request(server())
        .post("/t/public")
        .set(from("198.51.100.99, 203.0.113.1"))
        .expect(429);
    });
  });

  describe("per-user routes: limited per user only", () => {
    beforeEach(() => boot(1));

    const asUser = (path: string, userId: string, ip = "203.0.113.1") =>
      request(server()).post(path).set(from(ip)).set("x-test-user", userId);

    it.each(["/t/per-user", "/class-level"])(
      "two users behind the same IP do not consume each other's quota (%s)",
      async (path) => {
        for (let i = 0; i < ROUTE_LIMIT; i++) {
          await asUser(path, "alice").expect(201);
        }
        await asUser(path, "alice").expect(429);

        // Same address as alice: with a per-IP counter bob would be blocked.
        for (let i = 0; i < ROUTE_LIMIT; i++) {
          await asUser(path, "bob").expect(201);
        }
        await asUser(path, "bob").expect(429);
      },
    );

    it("keeps a user limited when they change IP", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await asUser("/t/per-user", "alice", `203.0.113.${10 + i}`).expect(201);
      }
      await asUser("/t/per-user", "alice", "203.0.113.99").expect(429);
    });

    it("lets more users share an IP than the global per-IP limit", async () => {
      for (let u = 0; u <= GLOBAL_LIMIT; u++) {
        await asUser("/t/per-user", `user-${u}`).expect(201);
      }
    });
  });
});

describe("GlobalThrottlerGuard.shouldSkip", () => {
  class CustomPerUserGuard extends ThrottlerUserGuard {}
  const handler = () => undefined;
  class Ctrl {}

  const shouldSkip = (guards: Map<unknown, unknown[]>) => {
    const reflector = {
      get: (_key: string, target: unknown) => guards.get(target),
    } as unknown as Reflector;
    const guard = new GlobalThrottlerGuard(
      null as never,
      null as never,
      reflector,
    );
    const context = {
      getHandler: () => handler,
      getClass: () => Ctrl,
    } as unknown as ExecutionContext;
    return (
      guard as unknown as {
        shouldSkip(c: ExecutionContext): Promise<boolean>;
      }
    ).shouldSkip(context);
  };

  it.each([
    ["the guard class", ThrottlerUserGuard],
    ["a subclass", CustomPerUserGuard],
    [
      "a guard instance",
      new ThrottlerUserGuard(null as never, null as never, null as never),
    ],
  ])("skips a route guarded by %s", async (_label, perUserGuard) => {
    await expect(
      shouldSkip(new Map([[handler, [FakeAuthGuard, perUserGuard]]])),
    ).resolves.toBe(true);
  });

  it("counts routes without a per-user throttler", async () => {
    await expect(
      shouldSkip(new Map<unknown, unknown[]>([[Ctrl, [FakeAuthGuard]]])),
    ).resolves.toBe(false);
    await expect(shouldSkip(new Map())).resolves.toBe(false);
  });
});
