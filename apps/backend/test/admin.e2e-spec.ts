import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AdminClubsQueryService } from "../src/admin/admin-clubs.query-service";
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
  ["post", "/api/v1/admin/clubs"],
  ["get", "/api/v1/admin/clubs/options"],
  ["get", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000"],
  ["patch", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000/status"],
  ["delete", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000"],
  ["get", "/api/v1/admin/audit-log"],
  ["get", "/api/v1/admin/users"],
  ["get", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
  ["patch", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000/status"],
  ["delete", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/v1/admin/users"],
  [
    "post",
    "/api/v1/admin/users/00000000-0000-4000-8000-000000000000/resend-invitation",
  ],
];

describe("Admin routes (e2e) — role matrix", () => {
  let app: INestApplication;
  let currentRole: UserRole | null = UserRole.ADMIN;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeAll(async () => {
    prisma = createMockPrismaService();
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

  it("admin creates a club (201) and a duplicate name is a 409", async () => {
    currentRole = UserRole.ADMIN;
    const detail = {
      id: "c-new",
      name: "Club Neuf",
      registrationMode: "MEMBERS_AUTO_CONFIRM",
      disabledAt: null,
      createdAt: new Date(),
      competitionCount: 0,
      partnershipCount: 0,
      soloTeamCount: 0,
      members: [],
    };
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.club.findFirst.mockResolvedValueOnce(null);
    prisma.club.create.mockResolvedValue({ id: "c-new" } as never);
    prisma.adminAuditLog.create.mockResolvedValue({} as never);
    const detailSpy = jest
      .spyOn(AdminClubsQueryService.prototype, "detail")
      .mockResolvedValue(detail as never);
    const res = await request(server())
      .post("/api/v1/admin/clubs")
      .send({ name: "Club Neuf" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("c-new");

    prisma.club.findFirst.mockResolvedValueOnce({
      id: "c-new",
      name: "Club Neuf",
    } as never);
    await request(server())
      .post("/api/v1/admin/clubs")
      .send({ name: "club neuf" })
      .expect(409);
    detailSpy.mockRestore();
  });

  it("rejects an invalid club body with 400", async () => {
    currentRole = UserRole.ADMIN;
    await request(server())
      .post("/api/v1/admin/clubs")
      .send({ name: "   " })
      .expect(400);
  });

  it("the former club-accounts route is gone", async () => {
    currentRole = UserRole.ADMIN;
    await request(server())
      .post("/api/v1/admin/club-accounts")
      .send({})
      .expect(404);
  });
});
