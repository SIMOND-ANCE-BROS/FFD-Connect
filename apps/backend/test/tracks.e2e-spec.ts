import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { JwtAuthGuard } from "./../src/auth/jwt-auth.guard";
import { RedisService } from "./../src/redis/redis.service";
import { TracksService } from "./../src/tracks/tracks.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("TracksController (e2e)", () => {
  let app: INestApplication;
  let tracksService: TracksService;
  // Role injected by the mocked JwtAuthGuard; mutate per-test to exercise RolesGuard.
  let currentUserRole: UserRole = UserRole.ADMIN;

  beforeEach(async () => {
    currentUserRole = UserRole.ADMIN;

    const mockTracksService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TracksService)
        .useValue(mockTracksService)
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
          canActivate: (context: import("@nestjs/common").ExecutionContext) => {
            const req = context
              .switchToHttp()
              .getRequest<{ user?: { userId: string; role: UserRole } }>();
            req.user = { userId: "test-user-id", role: currentUserRole };
            return true;
          },
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    tracksService = moduleFixture.get<TracksService>(TracksService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/v1/tracks (GET) should return tracks list", () => {
    (tracksService.findAll as jest.Mock).mockResolvedValue([
      { id: "track-1", title: "Track 1" },
    ]);

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/api/v1/tracks")
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].title).toBe("Track 1");
      });
  });

  it("/api/v1/tracks/:id (PATCH) should 403 for non-ADMIN users", () => {
    currentUserRole = UserRole.CLUB;

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .patch("/api/v1/tracks/track-1")
      .send({ title: "New Title" })
      .expect(403);
  });

  it("/api/v1/tracks/download/:token (GET) should 404 for missing file", () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/api/v1/tracks/download/missing-file.mp3")
      .expect(404);
  });
});
