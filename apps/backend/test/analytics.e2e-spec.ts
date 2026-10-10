import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { createMockPrismaService } from "./mocks/prisma.mock";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

const event = () => ({
  installId: "4b0f8a2e-1c3d-4e5f-9a6b-7c8d9e0f1a2b",
  name: "login",
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  platform: "ios",
  appVersion: "1.4.2",
  space: "GUEST",
});

describe("Analytics intake (e2e)", () => {
  let app: INestApplication;
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

  it("accepts a batch without any token (204)", async () => {
    prisma.usageEvent.createMany.mockResolvedValue({ count: 1 });
    await request(server())
      .post("/api/v1/analytics/events")
      .send({ events: [event()] })
      .expect(204);
    expect(prisma.usageEvent.createMany).toHaveBeenCalled();
  });

  it("rejects an invalid batch with 400 and stores nothing", async () => {
    prisma.usageEvent.createMany.mockClear();
    await request(server())
      .post("/api/v1/analytics/events")
      .send({ events: [{ ...event(), name: "purchase" }] })
      .expect(400);
    expect(prisma.usageEvent.createMany).not.toHaveBeenCalled();
  });
});
