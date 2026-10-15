import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LicenseRenewalService } from "./license-renewal.service";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

/**
 * POST /licenses/renewal/:id/approve is gone (#266): renewal decisions are
 * taken from POST /admin/license-renewals/:id/approve only, with an audit row
 * and the administrator's confirmed licence number.
 *
 * POST /licenses/renew is gone as well (#271): it granted a licence on the OCR
 * of an uploaded certificate alone. A licensee now only submits a request,
 * which waits for an administrator's decision.
 */
describe("LicensesController — legacy routes granting a licence removed", () => {
  let app: INestApplication;
  let currentUser: { userId: string; role: UserRole };

  const REQUEST_ID = "4f9b2c1e-8a3d-4e2f-9b6a-1c2d3e4f5a6b";

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LicensesService, useValue: {} },
        {
          provide: HealthDataAccessLogService,
          useValue: { record: jest.fn() },
        },
        { provide: LicenseRenewalService, useValue: {} },
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
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([UserRole.ADMIN, UserRole.LICENSEE])(
    "answers 404 to a %s account",
    async (role) => {
      currentUser = { userId: "user-1", role };
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/licenses/renewal/${REQUEST_ID}/approve`)
        .expect(404);
    },
  );

  it.each([UserRole.ADMIN, UserRole.LICENSEE])(
    "answers 404 to POST /licenses/renew for a %s account",
    async (role) => {
      currentUser = { userId: "user-1", role };
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/licenses/renew")
        .attach("certificate", Buffer.from("%PDF-1.4"), "cert.pdf")
        .expect(404);
    },
  );
});
