import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

/**
 * POST /licenses/renewal/:id/approve is gone (#266): renewal decisions are
 * taken from POST /admin/license-renewals/:id/approve only, with an audit row
 * and the administrator's confirmed licence number. The licensee's own flow
 * auto-approves inside LicenseRenewalService.submitRenewalRequest (until #271).
 */
describe("LicensesController — legacy renewal approval route removed", () => {
  let app: INestApplication;
  let currentUser: { userId: string; role: UserRole };

  const REQUEST_ID = "4f9b2c1e-8a3d-4e2f-9b6a-1c2d3e4f5a6b";

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LicensesService, useValue: {} },
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
});
