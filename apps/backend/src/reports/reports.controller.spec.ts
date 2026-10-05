import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

// The controller calls validateFile() for non-null uploads.  We spy on it so
// we can test both the happy path and the validation-failure path without
// coupling to the real MIME / size logic.
jest.mock("../utils/file-validation.util", () => ({
  ...jest.requireActual("../utils/file-validation.util"),
  validateFile: jest.fn(),
  createFileFilter: jest.fn().mockReturnValue(jest.fn()),
}));

import { validateFile } from "../utils/file-validation.util";

const buildDto = (
  overrides: Partial<CreateReportDto> = {},
): CreateReportDto => ({
  type: "BUG",
  title: "Login crash",
  description: "App crashes on login with some accounts",
  ...overrides,
});

const buildFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    fieldname: "image",
    originalname: "screenshot.png",
    encoding: "7bit",
    mimetype: "image/png",
    size: 512 * 1024, // 512 KB – well within the 5 MB limit
    buffer: Buffer.from("fake-image-data"),
    ...overrides,
  }) as Express.Multer.File;

describe("ReportsController", () => {
  let controller: ReportsController;

  const mockReportsService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockReportsService }],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  // ─── create – happy paths ────────────────────────────────────────────────────

  describe("create", () => {
    it("returns the created report when called with body and an image file", async () => {
      const dto = buildDto();
      const file = buildFile();
      const createdReport = { id: "report-1", ...dto };
      mockReportsService.create.mockResolvedValue(createdReport);

      const result = await controller.create(dto, file);

      expect(result).toEqual(createdReport);
    });

    it("forwards the body and file to reportsService.create unchanged", async () => {
      const dto = buildDto({ type: "FEATURE", title: "Dark mode" });
      const file = buildFile({ originalname: "mockup.png" });
      mockReportsService.create.mockResolvedValue({ id: "report-2" });

      await controller.create(dto, file);

      expect(mockReportsService.create).toHaveBeenCalledTimes(1);
      expect(mockReportsService.create).toHaveBeenCalledWith(dto, file);
    });

    it("calls validateFile with the uploaded file before delegating to the service", async () => {
      const dto = buildDto();
      const file = buildFile();
      mockReportsService.create.mockResolvedValue({ id: "report-3" });

      await controller.create(dto, file);

      expect(validateFile).toHaveBeenCalledTimes(1);
      expect(validateFile).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ allowedMimeTypes: expect.any(Array) }),
      );
    });

    it("does not call validateFile when no file is provided", async () => {
      const dto = buildDto();
      mockReportsService.create.mockResolvedValue({ id: "report-4" });

      await controller.create(dto, undefined);

      expect(validateFile).not.toHaveBeenCalled();
    });

    it("calls reportsService.create with undefined file when no file is provided", async () => {
      const dto = buildDto({ description: "Reproducible on iOS 17" });
      mockReportsService.create.mockResolvedValue({ id: "report-5" });

      await controller.create(dto, undefined);

      expect(mockReportsService.create).toHaveBeenCalledWith(dto, undefined);
    });

    it("returns the service response that includes all persisted fields", async () => {
      const dto = buildDto({
        userId: "user-99",
        module: "Auth",
        stackTrace: "Error: null ref\n  at login.ts:12",
        severity: "HIGH",
        appVersion: "2.3.1",
        deviceInfo: "iPhone 15 / iOS 17.4",
      });
      const persisted = {
        id: "report-6",
        message:
          "[BUG][Auth] Login crash\n\nApp crashes on login with some accounts",
        stackTrace: dto.stackTrace,
        deviceInfo: dto.deviceInfo,
        createdAt: new Date("2026-03-17"),
      };
      mockReportsService.create.mockResolvedValue(persisted);

      const result = await controller.create(dto, undefined);

      expect(result).toEqual(persisted);
    });
  });

  // ─── create – error paths ────────────────────────────────────────────────────

  describe("create – error handling", () => {
    it("propagates BadRequestException thrown by validateFile for an invalid MIME type", async () => {
      const dto = buildDto();
      const file = buildFile({ mimetype: "application/pdf" });
      (validateFile as jest.Mock).mockImplementation(() => {
        throw new BadRequestException(
          "Type de fichier non autorisé. Types autorisés: image/jpeg, image/png",
        );
      });

      await expect(controller.create(dto, file)).rejects.toThrow(
        BadRequestException,
      );
      // Service must NOT be called when file validation fails
      expect(mockReportsService.create).not.toHaveBeenCalled();
    });

    it("propagates BadRequestException thrown by validateFile for an oversized file", async () => {
      const dto = buildDto();
      const file = buildFile({ size: 6 * 1024 * 1024 }); // 6 MB > 5 MB limit
      (validateFile as jest.Mock).mockImplementation(() => {
        throw new BadRequestException(
          "Le fichier est trop volumineux. Taille maximale: 5.00MB",
        );
      });

      await expect(controller.create(dto, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("propagates errors thrown by the service", async () => {
      const dto = buildDto();
      mockReportsService.create.mockRejectedValue(
        new InternalServerErrorException("Failed to create report"),
      );

      await expect(controller.create(dto, undefined)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("propagates generic errors from the service without wrapping them", async () => {
      const dto = buildDto();
      mockReportsService.create.mockRejectedValue(new Error("DB write failed"));

      await expect(controller.create(dto, undefined)).rejects.toThrow(
        "DB write failed",
      );
    });
  });
});
