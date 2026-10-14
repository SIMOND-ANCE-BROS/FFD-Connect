import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { HealthDataAccessLogController } from "./health-data-access-log.controller";
import { HealthDataAccessLogQueryService } from "./health-data-access-log.query-service";

describe("HealthDataAccessLogController — GET /admin/health-data-access-log", () => {
  let app: INestApplication;
  let currentUser: { userId: string; role: UserRole; roles: UserRole[] };
  const query = { list: jest.fn() };
  const page = {
    data: [],
    meta: { total: 0, skip: 0, take: 20, hasMore: false },
  };

  beforeEach(async () => {
    query.list.mockReset().mockResolvedValue(page);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthDataAccessLogController],
      providers: [
        { provide: HealthDataAccessLogQueryService, useValue: query },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ user?: typeof currentUser }>().user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([UserRole.LICENSEE, UserRole.STAFF, UserRole.CLUB])(
    "403 for a %s",
    async (role) => {
      currentUser = { userId: "u1", role, roles: [role] };
      await request(app.getHttpServer())
        .get("/admin/health-data-access-log")
        .expect(403);
      expect(query.list).not.toHaveBeenCalled();
    },
  );

  it("serves the page to an administrator, with validated filters", async () => {
    currentUser = {
      userId: "admin-1",
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN],
    };
    const subject = "4f9b2c1e-8a3d-4e2f-9b6a-1c2d3e4f5a6b";

    const res = await request(app.getHttpServer())
      .get(
        `/admin/health-data-access-log?subjectUserId=${subject}&action=READ&take=5`,
      )
      .expect(200);

    expect(res.body).toEqual(page);
    expect(query.list).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: subject,
        action: "READ",
        take: 5,
      }),
    );
  });

  it("400 on an unknown action or a non-uuid subject", async () => {
    currentUser = {
      userId: "admin-1",
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN],
    };
    await request(app.getHttpServer())
      .get("/admin/health-data-access-log?action=WRITE")
      .expect(400);
    await request(app.getHttpServer())
      .get("/admin/health-data-access-log?subjectUserId=nope")
      .expect(400);
    expect(query.list).not.toHaveBeenCalled();
  });
});
