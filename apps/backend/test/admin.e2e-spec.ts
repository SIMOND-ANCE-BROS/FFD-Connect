import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { createMockPrismaService } from "./mocks/prisma.mock";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/** Every admin route; extended by later tasks. */
const ADMIN_ROUTES: Array<
  [method: "get" | "patch" | "post" | "delete", path: string]
> = [
  ["get", "/api/v1/admin/reference-data"],
  ["get", "/api/v1/admin/clubs"],
  ["get", "/api/v1/admin/audit-log"],
  ["get", "/api/v1/admin/users"],
  ["get", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
  ["patch", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000/status"],
  ["delete", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/v1/admin/club-accounts"],
  [
    "post",
    "/api/v1/admin/users/00000000-0000-4000-8000-000000000000/resend-invitation",
  ],
];

describe("Admin routes (e2e) — role matrix", () => {
  let app: INestApplication;
  let currentRole: UserRole | null = UserRole.ADMIN;

  beforeAll(async () => {
    const prisma = createMockPrismaService();
    const moduleRef = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(false),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            if (currentRole === null) return false;
            const req = ctx
              .switchToHttp()
              .getRequest<{ user?: { userId: string; role: UserRole } }>();
            req.user = { userId: "caller-id", role: currentRole };
            return true;
          },
        }),
    ).compile();
    app = moduleRef.createNestApplication();
    await configureTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  describe.each([UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF])(
    "as %s",
    (role) => {
      it.each(ADMIN_ROUTES)("%s %s → 403", async (method, path) => {
        currentRole = role;
        await request(server())[method](path).send({}).expect(403);
      });
    },
  );

  it.each(ADMIN_ROUTES)(
    "unauthenticated %s %s → 401/403",
    async (method, path) => {
      currentRole = null;
      const res = await request(server())[method](path).send({});
      expect([401, 403]).toContain(res.status);
    },
  );

  it("admin can read reference data", async () => {
    currentRole = UserRole.ADMIN;
    const res = await request(server())
      .get("/api/v1/admin/reference-data")
      .expect(200);
    expect(res.body.roles).toEqual(["LICENSEE", "CLUB", "STAFF", "ADMIN"]);
  });
});
