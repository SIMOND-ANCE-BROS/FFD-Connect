import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { JwtAuthGuard } from "./../src/auth/jwt-auth.guard";
import { LicensesService } from "./../src/licenses/licenses.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("LicensesController (e2e)", () => {
  let app: INestApplication;
  let licensesService: LicensesService;

  const mockAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { userId: "user-id" };
      return true;
    },
  };

  beforeEach(async () => {
    const mockLicensesService = {
      getLicense: jest.fn(),
      renewLicense: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(LicensesService)
        .useValue(mockLicensesService)
        .overrideGuard(JwtAuthGuard)
        .useValue(mockAuthGuard),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    licensesService = moduleFixture.get<LicensesService>(LicensesService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/v1/licenses/my (GET) should return user license", () => {
    (licensesService.getLicense as jest.Mock).mockResolvedValue({
      id: "license-1",
      number: "123",
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/api/v1/licenses/my")
      .expect(200)
      .expect((res) => {
        expect(res.body.number).toBe("123");
      });
  });

  it("/api/v1/licenses/renew (POST) should renew license with file", () => {
    (licensesService.renewLicense as jest.Mock).mockResolvedValue({
      id: "license-1",
      status: "PENDING",
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/licenses/renew")
      .attach("certificate", Buffer.from("test"), "certificate.png")
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe("PENDING");
      });
  });
});
