import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

/**
 * HTTP-level authorization of POST /licenses/renewal/:id/approve.
 *
 * Approving a renewal request renews someone's license, so the route is
 * reserved to ADMIN. JwtAuthGuard is stubbed to inject the caller; RolesGuard
 * is the real one, so these tests exercise the actual guard chain.
 */
describe("LicensesController — renewal approval authorization", () => {
  let app: INestApplication;
  let currentUser: { userId: string; role: UserRole; roles?: UserRole[] };

  const REQUEST_ID = "4f9b2c1e-8a3d-4e2f-9b6a-1c2d3e4f5a6b";

  const mockLicenseRenewalService = {
    approveRenewalRequest: jest.fn(),
  };

  beforeEach(async () => {
    currentUser = { userId: "user-1", role: UserRole.LICENSEE };

    const moduleRef = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LicensesService, useValue: {} },
        { provide: LicenseRenewalService, useValue: mockLicenseRenewalService },
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
    jest.clearAllMocks();
    mockLicenseRenewalService.approveRenewalRequest.mockResolvedValue({
      id: REQUEST_ID,
      status: "APPROVED",
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const approve = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).post(
      `/licenses/renewal/${REQUEST_ID}/approve`,
    );

  it.each([UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF])(
    "rejects a %s account with 403 and does not approve",
    async (role) => {
      currentUser = { userId: "user-1", role };

      await approve().expect(403);

      expect(
        mockLicenseRenewalService.approveRenewalRequest,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects a multi-profile account without the ADMIN profile", async () => {
    currentUser = {
      userId: "user-1",
      role: UserRole.CLUB,
      roles: [UserRole.LICENSEE, UserRole.CLUB],
    };

    await approve().expect(403);

    expect(
      mockLicenseRenewalService.approveRenewalRequest,
    ).not.toHaveBeenCalled();
  });

  it("lets an ADMIN approve the request", async () => {
    currentUser = { userId: "admin-1", role: UserRole.ADMIN };

    const res = await approve().expect(201);

    expect(res.body).toEqual({ id: REQUEST_ID, status: "APPROVED" });
    expect(
      mockLicenseRenewalService.approveRenewalRequest,
    ).toHaveBeenCalledWith(REQUEST_ID);
  });

  it("lets a multi-profile account holding ADMIN approve the request", async () => {
    currentUser = {
      userId: "admin-2",
      role: UserRole.LICENSEE,
      roles: [UserRole.LICENSEE, UserRole.ADMIN],
    };

    await approve().expect(201);

    expect(
      mockLicenseRenewalService.approveRenewalRequest,
    ).toHaveBeenCalledWith(REQUEST_ID);
  });
});
