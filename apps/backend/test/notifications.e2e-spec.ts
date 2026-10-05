import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { JwtAuthGuard } from "./../src/auth/jwt-auth.guard";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("NotificationsController (e2e)", () => {
  let app: INestApplication;
  let notificationsService: NotificationsService;

  const mockAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { userId: "user-id" };
      return true;
    },
  };

  beforeAll(async () => {
    const mockNotificationsService = {
      getAllForUser: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(NotificationsService)
        .useValue(mockNotificationsService)
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(true),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        })
        .overrideGuard(JwtAuthGuard)
        .useValue(mockAuthGuard),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    notificationsService =
      moduleFixture.get<NotificationsService>(NotificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("/api/v1/notifications (GET) should return user notifications", () => {
    (notificationsService.getAllForUser as jest.Mock).mockResolvedValue([
      { id: "notif-1" },
    ]);

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/api/v1/notifications")
      .expect(200)
      .expect((res) => {
        expect(res.body[0].id).toBe("notif-1");
      });
  });

  it("/api/v1/notifications/:id/read (PATCH) should mark as read", () => {
    (notificationsService.markAsRead as jest.Mock).mockResolvedValue({
      id: "notif-1",
      read: true,
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .patch("/api/v1/notifications/notif-1/read")
      .expect(200)
      .expect((res) => {
        expect(res.body.read).toBe(true);
      });
  });

  it("/api/v1/notifications/read-all (POST) should mark all as read", () => {
    (notificationsService.markAllAsRead as jest.Mock).mockResolvedValue({
      count: 3,
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/notifications/read-all")
      .expect(201)
      .expect((res) => {
        expect(res.body.count).toBe(3);
      });
  });
});
