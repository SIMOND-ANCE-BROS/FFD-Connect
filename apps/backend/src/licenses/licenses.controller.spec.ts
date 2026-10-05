import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { LicenseRenewalDocumentType } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LicenseRenewalService } from "./license-renewal.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

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
    renewLicense: jest.fn(),
    validateStaffLicense: jest.fn(),
  };

  const mockLicenseRenewalService = {
    startRenewalRequest: jest.fn(),
    getMyRenewalRequest: jest.fn(),
    uploadRenewalDocument: jest.fn(),
    submitRenewalRequest: jest.fn(),
    approveRenewalRequest: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LicensesService, useValue: mockLicensesService },
        { provide: LicenseRenewalService, useValue: mockLicenseRenewalService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
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
      expect(mockLicensesService.getLicense).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ id: "L1" });
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
  // POST /licenses/renew
  // ---------------------------------------------------------------------------
  describe("renewLicense", () => {
    it("delegates to licensesService.renewLicense with userId and file buffer", async () => {
      mockLicensesService.renewLicense.mockResolvedValue({ id: "L2" });
      const buffer = Buffer.from("cert-bytes");
      const file = multerFile({ buffer });
      const result = await controller.renewLicense(req("user-1"), file);
      expect(mockLicensesService.renewLicense).toHaveBeenCalledWith(
        "user-1",
        buffer,
      );
      expect(result).toEqual({ id: "L2" });
    });

    it("throws BadRequestException if no file provided", async () => {
      await expect(
        controller.renewLicense(req("user-1"), undefined),
      ).rejects.toThrow(BadRequestException);
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
      );
      expect(result).toEqual({ id: "req-1" });
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

  // ---------------------------------------------------------------------------
  // POST /licenses/renewal/:id/approve
  // ---------------------------------------------------------------------------
  describe("approveRenewal", () => {
    it("delegates to licenseRenewalService.approveRenewalRequest", async () => {
      mockLicenseRenewalService.approveRenewalRequest.mockResolvedValue({
        id: "req-1",
        status: "APPROVED",
      });
      const result = await controller.approveRenewal("req-uuid-1");
      expect(
        mockLicenseRenewalService.approveRenewalRequest,
      ).toHaveBeenCalledWith("req-uuid-1");
      expect(result).toEqual({ id: "req-1", status: "APPROVED" });
    });
  });
});
