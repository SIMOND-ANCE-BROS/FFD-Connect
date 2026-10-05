import { BadRequestException } from "@nestjs/common";
import { Request } from "express";
import {
  createFileFilter,
  FILE_TYPES,
  UploadedFile,
  validateFile,
} from "./file-validation.util";

describe("file-validation.util", () => {
  describe("validateFile", () => {
    it("should return early when file is undefined", () => {
      expect(() => validateFile(undefined)).not.toThrow();
    });

    it("should return early when file is null", () => {
      expect(() => validateFile(null as never)).not.toThrow();
    });

    it("should throw when file exceeds maxSize", () => {
      const file = {
        size: 11 * 1024 * 1024,
        mimetype: "image/jpeg",
        originalname: "test.jpg",
      };
      expect(() =>
        validateFile(file as UploadedFile, { maxSize: 10 * 1024 * 1024 }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateFile(file as UploadedFile, { maxSize: 10 * 1024 * 1024 }),
      ).toThrow(/trop volumineux/);
    });

    it("should throw when file is below minSize", () => {
      const file = {
        size: 100,
        mimetype: "image/jpeg",
        originalname: "test.jpg",
      };
      expect(() =>
        validateFile(file as UploadedFile, { minSize: 1024 }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateFile(file as UploadedFile, { minSize: 1024 }),
      ).toThrow(/trop petit/);
    });

    it("should throw when mimetype is not in allowedMimeTypes", () => {
      const file = {
        size: 1024,
        mimetype: "application/pdf",
        originalname: "doc.pdf",
      };
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedMimeTypes: ["image/jpeg", "image/png"],
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedMimeTypes: ["image/jpeg", "image/png"],
        }),
      ).toThrow(/Type de fichier non autorisé/);
    });

    it("should pass when mimetype is in allowedMimeTypes", () => {
      const file = {
        size: 1024,
        mimetype: "image/jpeg",
        originalname: "photo.jpg",
      };
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedMimeTypes: ["image/jpeg", "image/png"],
        }),
      ).not.toThrow();
    });

    it("should skip MIME check when allowedMimeTypes is empty", () => {
      const file = {
        size: 1024,
        mimetype: "application/octet-stream",
        originalname: "file.bin",
      };
      expect(() => validateFile(file as UploadedFile)).not.toThrow();
    });

    it("should throw when extension is not in allowedExtensions", () => {
      const file = {
        size: 1024,
        mimetype: "image/jpeg",
        originalname: "photo.exe",
      };
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedExtensions: [".jpg", ".png"],
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedExtensions: [".jpg", ".png"],
        }),
      ).toThrow(/Extension non autorisée/);
    });

    it("should pass when extension is in allowedExtensions", () => {
      const file = {
        size: 1024,
        mimetype: "image/jpeg",
        originalname: "photo.JPG",
      };
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedExtensions: [".jpg", ".jpeg"],
        }),
      ).not.toThrow();
    });

    it("should skip extension check when allowedExtensions is empty", () => {
      const file = {
        size: 1024,
        mimetype: "image/jpeg",
        originalname: "photo.xyz",
      };
      expect(() => validateFile(file as UploadedFile)).not.toThrow();
    });

    it("should validate file with all constraints passing", () => {
      const file = {
        size: 2 * 1024 * 1024,
        mimetype: "image/jpeg",
        originalname: "photo.jpg",
      };
      expect(() =>
        validateFile(file as UploadedFile, {
          allowedMimeTypes: ["image/jpeg"],
          allowedExtensions: [".jpg"],
          maxSize: 5 * 1024 * 1024,
          minSize: 1024,
        }),
      ).not.toThrow();
    });
  });

  describe("createFileFilter", () => {
    it("should call callback with (null, true) when validation passes", () => {
      const file = {
        size: 1024,
        mimetype: "image/jpeg",
        originalname: "photo.jpg",
      };
      const callback = jest.fn();
      const filter = createFileFilter({
        allowedMimeTypes: ["image/jpeg"],
      });
      filter({} as Request, file as UploadedFile, callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it("should call callback with (error, false) when validation fails", () => {
      const file = {
        size: 20 * 1024 * 1024,
        mimetype: "image/jpeg",
        originalname: "huge.jpg",
      };
      const callback = jest.fn();
      const filter = createFileFilter({ maxSize: 1024 });
      filter({} as Request, file as UploadedFile, callback);
      expect(callback).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );
    });
  });

  describe("FILE_TYPES", () => {
    it("should define IMAGES with correct structure", () => {
      expect(FILE_TYPES.IMAGES).toHaveProperty("allowedMimeTypes");
      expect(FILE_TYPES.IMAGES).toHaveProperty("allowedExtensions");
      expect(FILE_TYPES.IMAGES).toHaveProperty("maxSize");
      expect(FILE_TYPES.IMAGES.allowedMimeTypes).toContain("image/jpeg");
      expect(FILE_TYPES.IMAGES.maxSize).toBe(5 * 1024 * 1024);
    });

    it("should define PDF with correct structure", () => {
      expect(FILE_TYPES.PDF.allowedMimeTypes).toContain("application/pdf");
      expect(FILE_TYPES.PDF.allowedExtensions).toContain(".pdf");
    });

    it("should define CERTIFICATES with correct structure", () => {
      expect(FILE_TYPES.CERTIFICATES.allowedMimeTypes).toContain(
        "application/pdf",
      );
      expect(FILE_TYPES.CERTIFICATES.allowedExtensions).toContain(".pdf");
    });

    it("should define AUDIO with correct structure", () => {
      expect(FILE_TYPES.AUDIO.allowedMimeTypes).toContain("audio/mpeg");
      expect(FILE_TYPES.AUDIO.maxSize).toBe(50 * 1024 * 1024);
    });
  });
});
