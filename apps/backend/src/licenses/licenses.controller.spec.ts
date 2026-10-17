import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { LicenseRenewalDocumentType } from "@prisma/client";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { LicenseRenewalService } from "./license-renewal.service";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";

/** Minimal RequestWithUser stub for the local interface used in LicensesController */
const req = (userId: string, email = "user@test.com") =>
  ({ user: { userId, email } }) as any;

/** Minimal Multer file with an in-memory buffer (memoryStorage scenario) */
const multerFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    buffer: Buffer.from("fake-bytes"),
    mimetype: "image/png",
    size: 1024,
    originalname: "cert.png",
    fieldname: "certificate",
    ...overrides,
  }) as Express.Multer.File;

describe("LicensesController", () => {
  let controller: LicensesController;
  let module: TestingModule;

  const mockLicensesService = {
    getLicense: jest.fn(),
    validateStaffLicense: jest.fn(),
  };

  const mockLicenseRenewalService = {
    startRenewalRequest: jest.fn(),
    getMyRenewalRequest: jest.fn(),
    uploadRenewalDocument: jest.fn(),
    submitRenewalRequest: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LicensesService, useValue: mockLicensesService },
        {
          provide: HealthDataAccessLogService,
          useValue: { record: jest.fn() },
        },
        { provide: LicenseRenewalService, useValue: mockLicenseRenewalService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LicensesController>(LicensesController);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  // ---------------------------------------------------------------------------
  // GET /licenses/my
  // ---------------------------------------------------------------------------
  describe("getMyLicense", () => {
    it("delegates to licensesService.getLicense with userId", async () => {
      mockLicensesService.getLicense.mockResolvedValue({ id: "L1" });
      const result = await controller.getMyLicense(req("user-1"));
      expect(mockLicensesService.getLicense).toHaveBeenCalledWith("user-1", {
        supportAccess: false,
      });
      expect(result).toEqual({ id: "L1" });
    });

    it("flags a support access so the static QR is withheld (#759)", async () => {
      mockLicensesService.getLicense.mockResolvedValue({ id: "L1" });
      await controller.getMyLicense({
        user: { userId: "user-1", email: "u@test.com", impersonatedBy: "a-1" },
      } as unknown as Parameters<LicensesController["getMyLicense"]>[0]);
      expect(mockLicensesService.getLicense).toHaveBeenCalledWith("user-1", {
        supportAccess: true,
      });
    });

    it.each([
      "startRenewal",
      "uploadRenewalDocument",
      "submitRenewal",
    ] as const)("refuses %s during a support access (#760)", (method) => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        LicensesController.prototype[method],
      ) as unknown[];
      expect(guards).toContain(NoImpersonationGuard);
    });

    it("lets a support access read the renewal request (#760)", () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          LicensesController.prototype.getMyRenewal,
        ) as unknown[] | undefined) ?? [];
      expect(guards).not.toContain(NoImpersonationGuard);
    });

    it("propagates NotFoundException from service", async () => {
      mockLicensesService.getLicense.mockRejectedValue(
        new NotFoundException("License non trouvée"),
      );
      await expect(controller.getMyLicense(req("user-1"))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/start
  // ---------------------------------------------------------------------------
  describe("startRenewal", () => {
    it("delegates to licenseRenewalService.startRenewalRequest", async () => {
      const mockReq = { id: "req-1", status: "DRAFT", documents: [] };
      mockLicenseRenewalService.startRenewalRequest.mockResolvedValue(mockReq);
      const result = await controller.startRenewal(req("user-1"));
      expect(
        mockLicenseRenewalService.startRenewalRequest,
      ).toHaveBeenCalledWith("user-1");
      expect(result).toBe(mockReq);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /licenses/renewal/my
  // ---------------------------------------------------------------------------
  describe("getMyRenewal", () => {
    it("delegates to licenseRenewalService.getMyRenewalRequest", async () => {
      mockLicenseRenewalService.getMyRenewalRequest.mockResolvedValue(null);
      const result = await controller.getMyRenewal(req("user-1"));
      expect(
        mockLicenseRenewalService.getMyRenewalRequest,
      ).toHaveBeenCalledWith("user-1");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/:id/documents
  // ---------------------------------------------------------------------------
  describe("uploadRenewalDocument", () => {
    it("delegates to licenseRenewalService.uploadRenewalDocument with MEDICAL_CERTIFICATE", async () => {
      mockLicenseRenewalService.uploadRenewalDocument.mockResolvedValue({
        id: "req-1",
      });
      const buffer = Buffer.from("medical-bytes");
      const file = multerFile({ buffer, originalname: "medical.png" });
      const result = await controller.uploadRenewalDocument(
        req("user-1"),
        "req-uuid-1",
        "MEDICAL_CERTIFICATE",
        file,
      );
      expect(
        mockLicenseRenewalService.uploadRenewalDocument,
      ).toHaveBeenCalledWith(
        "user-1",
        "req-uuid-1",
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        buffer,
        expect.stringMatching(/^certificate-\d+-\d+\.png$/),
        {
          actorUserId: "user-1",
          actorRole: "OWNER",
          route: "POST /licenses/renewal/:id/documents",
        },
      );
      expect(result).toEqual({ id: "req-1" });
    });

    it("names the impersonator as the actor of a replacement (#63)", async () => {
      mockLicenseRenewalService.uploadRenewalDocument.mockResolvedValue({
        id: "req-1",
      });
      const file = multerFile({
        buffer: Buffer.from("medical-bytes"),
        originalname: "medical.png",
      });
      await controller.uploadRenewalDocument(
        {
          user: {
            userId: "user-1",
            email: "u@x.fr",
            impersonatedBy: "staff-1",
          },
        } as never,
        "req-uuid-1",
        "MEDICAL_CERTIFICATE",
        file,
      );
      expect(
        mockLicenseRenewalService.uploadRenewalDocument,
      ).toHaveBeenCalledWith(
        "user-1",
        "req-uuid-1",
        LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        expect.any(Buffer),
        expect.any(String),
        {
          actorUserId: "staff-1",
          actorRole: "IMPERSONATOR",
          route: "POST /licenses/renewal/:id/documents",
        },
      );
    });

    it("delegates to licenseRenewalService.uploadRenewalDocument with LICENSE_CERTIFICATE", async () => {
      mockLicenseRenewalService.uploadRenewalDocument.mockResolvedValue({
        id: "req-1",
      });
      const buffer = Buffer.from("license-bytes");
      const file = multerFile({ buffer, originalname: "license.png" });
      await controller.uploadRenewalDocument(
        req("user-1"),
        "req-uuid-1",
        "LICENSE_CERTIFICATE",
        file,
      );
      expect(
        mockLicenseRenewalService.uploadRenewalDocument,
      ).toHaveBeenCalledWith(
        "user-1",
        "req-uuid-1",
        LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        buffer,
        expect.stringMatching(/^certificate-\d+-\d+\.png$/),
        {
          actorUserId: "user-1",
          actorRole: "OWNER",
          route: "POST /licenses/renewal/:id/documents",
        },
      );
    });

    it("throws BadRequestException if type is invalid", async () => {
      const file = multerFile();
      await expect(
        controller.uploadRenewalDocument(
          req("user-1"),
          "req-uuid-1",
          "INVALID_TYPE",
          file,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if no file provided", async () => {
      await expect(
        controller.uploadRenewalDocument(
          req("user-1"),
          "req-uuid-1",
          "MEDICAL_CERTIFICATE",
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/:id/submit
  // ---------------------------------------------------------------------------
  describe("submitRenewal", () => {
    it("delegates to licenseRenewalService.submitRenewalRequest", async () => {
      mockLicenseRenewalService.submitRenewalRequest.mockResolvedValue({
        id: "req-1",
        status: "APPROVED",
      });
      const result = await controller.submitRenewal(
        req("user-1"),
        "req-uuid-1",
      );
      expect(
        mockLicenseRenewalService.submitRenewalRequest,
      ).toHaveBeenCalledWith("user-1", "req-uuid-1");
      expect(result).toEqual({ id: "req-1", status: "APPROVED" });
    });
  });
});
