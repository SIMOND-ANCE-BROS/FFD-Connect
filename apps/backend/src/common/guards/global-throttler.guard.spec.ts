import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Throttle, ThrottlerModule } from "@nestjs/throttler";
import type { Request } from "express";
import request from "supertest";
import { applyTrustProxy } from "../../config/trust-proxy";
import { ThrottleByIp } from "../decorators/throttle-by-ip.decorator";
import { GlobalThrottlerGuard } from "./global-throttler.guard";
import { ThrottlerUserGuard } from "./throttler-user.guard";

const JWT_SECRET = "global-throttler-spec-secret";
const GLOBAL_LIMIT = 3;
const ROUTE_LIMIT = 2;
const ROUTE_THROTTLE = { default: { ttl: 60_000, limit: ROUTE_LIMIT } };

const jwt = new JwtService({ secret: JWT_SECRET });
const tokenFor = (sub: string) => jwt.sign({ sub });

/** Subject of a validly signed token whose account is disabled. */
const DISABLED_USER = "disabled-user";
/** Only subject granted by FakeRolesGuard. */
const ADMIN_USER = "admin-user";

/**
 * Stands in for JwtAuthGuard: verifies the bearer token, sets `req.user`, and
 * like JwtStrategy refuses a valid token of a disabled account (401).
 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId: string } }>();
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    let userId: string;
    try {
      userId = jwt.verify<{ sub: string }>(token).sub;
    } catch {
      throw new UnauthorizedException();
    }
    if (userId === DISABLED_USER) throw new UnauthorizedException();
    req.user = { userId };
    return true;
  }
}

/** Stands in for RolesGuard: only ADMIN_USER passes (403 otherwise). */
@Injectable()
class FakeRolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { userId: string } }>();
    if (req.user?.userId !== ADMIN_USER) throw new ForbiddenException();
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
  @ThrottleByIp()
  publicRoute(): { ok: true } {
    return { ok: true };
  }

  /** Authenticated route on the global limit only (`/licenses/my`…, #633). */
  @Get("signed-in")
  @UseGuards(FakeAuthGuard)
  signedIn(): { ok: true } {
    return { ok: true };
  }

  /** Public route the app calls signed in (`GET /competitions/:id`, #633). */
  @Get("open")
  open(): { ok: true } {
    return { ok: true };
  }

  @Post("per-user")
  @UseGuards(FakeAuthGuard, ThrottlerUserGuard)
  @Throttle(ROUTE_THROTTLE)
  perUser(): { ok: true } {
    return { ok: true };
  }

  @Post("admin-only")
  @UseGuards(FakeAuthGuard, FakeRolesGuard, ThrottlerUserGuard)
  @Throttle(ROUTE_THROTTLE)
  adminOnly(): { ok: true } {
    return { ok: true };
  }
}

@ThrottleByIp()
@Controller("class-ip")
class ClassIpController {
  @Get()
  run(): { ok: true } {
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

const configWith = (values: Record<string, unknown>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  }) as unknown as ConfigService;

/**
 * Global per-IP throttler + per-user throttler over HTTP, with the same
 * `trust proxy` setup as main.ts (#182).
 */
describe("GlobalThrottlerGuard (HTTP)", () => {
  let app: NestExpressApplication;

  const boot = async (trustProxyHops: number) => {
    const config = configWith({
      JWT_SECRET,
      TRUST_PROXY_HOPS: trustProxyHops,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: GLOBAL_LIMIT }]),
      ],
      controllers: [RoutesController, ClassLevelController, ClassIpController],
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
        .set(from("6.6.6.6, 10.0.0.1, 203.0.113.7"));
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

    it("cannot be bypassed by forging several X-Forwarded-For entries", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await request(server())
          .post("/t/public")
          .set(from(`198.51.100.${i}, 192.0.2.${i}, 203.0.113.1`))
          .expect(201);
      }
      await request(server())
        .post("/t/public")
        .set(from("198.51.100.99, 192.0.2.99, 203.0.113.1"))
        .expect(429);
    });

    it("cannot be bypassed with a bearer token", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await request(server())
          .post("/t/public")
          .set(from("203.0.113.1"))
          .set("Authorization", `Bearer ${tokenFor(`user-${i}`)}`)
          .expect(201);
      }
      await request(server())
        .post("/t/public")
        .set(from("203.0.113.1"))
        .set("Authorization", `Bearer ${tokenFor("user-x")}`)
        .expect(429);
    });
  });

  // #633: every authenticated request is counted per user, not only on
  // routes carrying ThrottlerUserGuard. A gym Wi-Fi or a mobile CGNAT must
  // not make dancers share one budget on /licenses/my, /competitions/:id…
  describe("global limit: per user for a verified token", () => {
    beforeEach(() => boot(1));

    const get = (path: string, ip: string, authorization?: string) => {
      const req = request(server()).get(path).set(from(ip));
      return authorization ? req.set("Authorization", authorization) : req;
    };
    const bearer = (userId: string) => `Bearer ${tokenFor(userId)}`;

    it.each(["/t/signed-in", "/t/open"])(
      "two users behind the same IP do not consume each other's budget (%s)",
      async (path) => {
        for (let i = 0; i < GLOBAL_LIMIT; i++) {
          await get(path, "203.0.113.50", bearer("alice")).expect(200);
        }
        await get(path, "203.0.113.50", bearer("alice")).expect(429);
        // Same address, another account: its own budget.
        for (let i = 0; i < GLOBAL_LIMIT; i++) {
          await get(path, "203.0.113.50", bearer("bob")).expect(200);
        }
        await get(path, "203.0.113.50", bearer("bob")).expect(429);
      },
    );

    it("lets more signed-in users share an IP than the per-IP budget", async () => {
      for (let u = 0; u < GLOBAL_LIMIT * 3; u++) {
        await get("/t/signed-in", "203.0.113.51", bearer(`dancer-${u}`)).expect(
          200,
        );
      }
    });

    it("keeps a user limited when they change IP", async () => {
      for (let i = 0; i < GLOBAL_LIMIT; i++) {
        await get(
          "/t/signed-in",
          `203.0.113.${60 + i}`,
          bearer("alice"),
        ).expect(200);
      }
      await get("/t/signed-in", "203.0.113.99", bearer("alice")).expect(429);
    });

    it("does not give anonymous callers of a public route a budget per user", async () => {
      for (let i = 0; i < GLOBAL_LIMIT; i++) {
        await get("/t/open", "203.0.113.52").expect(200);
      }
      await get("/t/open", "203.0.113.52").expect(429);
      // A signed-in user on the same address is not blocked by them.
      await get("/t/open", "203.0.113.52", bearer("alice")).expect(200);
    });

    // An unverified token must never pick its bucket: rotating forged tokens
    // would otherwise dodge the limit.
    it.each([
      ["garbage bearer strings", (i: number) => `Bearer garbage-${i}`],
      [
        "tokens signed with another secret",
        (i: number) =>
          `Bearer ${new JwtService({ secret: "attacker" }).sign({ sub: `fake-${i}` })}`,
      ],
      [
        "expired tokens",
        (i: number) =>
          `Bearer ${jwt.sign({ sub: `old-${i}`, exp: Math.floor(Date.now() / 1000) - 60 })}`,
      ],
      [
        "unsigned (alg none) tokens",
        (i: number) =>
          `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: `none-${i}` })).toString("base64url")}.`,
      ],
    ])("counts rotating %s on the client IP", async (_label, authFor) => {
      for (let i = 0; i < GLOBAL_LIMIT; i++) {
        await get("/t/open", "203.0.113.53", authFor(i)).expect(200);
      }
      await get("/t/open", "203.0.113.53", authFor(99)).expect(429);
    });

    it("keeps a class-level @ThrottleByIp() route per IP, even signed in", async () => {
      for (let i = 0; i < GLOBAL_LIMIT; i++) {
        await get("/class-ip", "203.0.113.54", bearer(`user-${i}`)).expect(200);
      }
      await get("/class-ip", "203.0.113.54", bearer("user-x")).expect(429);
    });
  });

  describe("per-user routes: limited per user only", () => {
    beforeEach(() => boot(1));

    const asUser = (path: string, userId: string, ip = "203.0.113.1") =>
      request(server())
        .post(path)
        .set(from(ip))
        .set("Authorization", `Bearer ${tokenFor(userId)}`);

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

    // Security review of #182: the per-user guard only runs after JWT
    // validation, so a request rejected with 401 never reaches it. Forged or
    // garbage tokens must therefore stay counted per IP by the global guard.
    it.each([
      ["a garbage bearer string", "Bearer x"],
      [
        "a token signed with another secret",
        `Bearer ${new JwtService({ secret: "attacker" }).sign({ sub: "alice" })}`,
      ],
      [
        "an expired token",
        `Bearer ${jwt.sign({ sub: "alice", exp: Math.floor(Date.now() / 1000) - 60 })}`,
      ],
      ["a non-bearer scheme", `Basic ${tokenFor("alice")}`],
    ])(
      "keeps counting per IP a request with %s",
      async (_label, authorization) => {
        const attempt = () =>
          request(server())
            .post("/t/per-user")
            .set(from("203.0.113.66"))
            .set("Authorization", authorization);
        for (let i = 0; i < ROUTE_LIMIT; i++) {
          await attempt().expect(401);
        }
        await attempt().expect(429);
      },
    );

    it("keeps counting per IP a request without any token", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await request(server())
          .post("/t/per-user")
          .set(from("203.0.113.67"))
          .expect(401);
      }
      await request(server())
        .post("/t/per-user")
        .set(from("203.0.113.67"))
        .expect(429);
    });

    // Security review of #182 (medium): a VALID token refused between
    // JwtAuthGuard and ThrottlerUserGuard never reaches the per-user guard.
    // The global guard must still apply the route limit, per user.
    it("limits a valid token refused by the roles guard (403)", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await asUser("/t/admin-only", "bob").expect(403);
      }
      await asUser("/t/admin-only", "bob").expect(429);
      // Keyed per user, not per IP: another user from the same address is
      // still let through.
      await asUser("/t/admin-only", ADMIN_USER).expect(201);
    });

    it("limits a valid token of a disabled account (401)", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await asUser("/t/per-user", DISABLED_USER).expect(401);
      }
      await asUser("/t/per-user", DISABLED_USER).expect(429);
      // Even when rotating IPs: the key is the token subject.
      await asUser("/t/per-user", DISABLED_USER, "203.0.113.200").expect(429);
      await asUser("/t/per-user", "alice").expect(201);
    });

    it("does not halve the route limit by counting twice in one bucket", async () => {
      for (let i = 0; i < ROUTE_LIMIT; i++) {
        await asUser("/t/admin-only", ADMIN_USER).expect(201);
      }
      await asUser("/t/admin-only", ADMIN_USER).expect(429);
    });
  });
});

describe("GlobalThrottlerGuard.getTracker", () => {
  const handler = () => undefined;
  class Ctrl {}
  const validHeaders = { authorization: `Bearer ${tokenFor("alice")}` };

  const trackerFor = (
    byIp: Map<unknown, boolean>,
    headers: Record<string, unknown>,
    withContext = true,
  ) => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockImplementation((_key, targets) =>
        (targets as unknown[])
          .map((t) => byIp.get(t))
          .find((v) => v !== undefined),
      );
    const guard = new GlobalThrottlerGuard(
      null as never,
      null as never,
      reflector,
      configWith({ JWT_SECRET }),
    );
    const context = {
      getHandler: () => handler,
      getClass: () => Ctrl,
    } as unknown as ExecutionContext;
    return (
      guard as unknown as {
        getTracker(
          r: Record<string, unknown>,
          c?: ExecutionContext,
        ): Promise<string>;
      }
    ).getTracker(
      { ip: "203.0.113.1", headers },
      withContext ? context : undefined,
    );
  };

  it("keys a verified token on its subject (not `user:`), on any route", async () => {
    await expect(trackerFor(new Map(), validHeaders)).resolves.toBe(
      "gsub:alice",
    );
  });

  it("accepts a lowercase scheme and surrounding spaces", async () => {
    await expect(
      trackerFor(new Map(), {
        authorization: `  bearer ${tokenFor("alice")} `,
      }),
    ).resolves.toBe("gsub:alice");
  });

  it.each([
    ["no authorization header", {}],
    ["a non-string authorization", { authorization: ["Bearer a", "b"] }],
    ["another scheme", { authorization: `Basic ${tokenFor("alice")}` }],
    ["a token without subject", { authorization: `Bearer ${jwt.sign({})}` }],
    [
      "a non-string subject",
      { authorization: `Bearer ${jwt.sign({ sub: 42 })}` },
    ],
    [
      "a token signed with another secret",
      {
        authorization: `Bearer ${new JwtService({ secret: "attacker" }).sign({ sub: "alice" })}`,
      },
    ],
  ])("falls back on the IP with %s", async (_label, headers) => {
    await expect(trackerFor(new Map(), headers)).resolves.toBe("203.0.113.1");
  });

  it.each([
    ["the handler", handler],
    ["the controller", Ctrl],
  ])(
    "keys a @ThrottleByIp() route (on %s) on the IP, even with a valid token",
    async (_label, target) => {
      await expect(
        trackerFor(new Map([[target, true]]), validHeaders),
      ).resolves.toBe("203.0.113.1");
    },
  );

  it("falls back on the IP when called without an execution context", async () => {
    await expect(trackerFor(new Map(), validHeaders, false)).resolves.toBe(
      "203.0.113.1",
    );
  });
});
