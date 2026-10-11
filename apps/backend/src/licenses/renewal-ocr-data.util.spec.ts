import { LicenseRenewalDocumentType } from "@prisma/client";
import {
  pickRenewalOcrData,
  toRenewalDocumentResponse,
  toRenewalRequestResponse,
} from "./renewal-ocr-data.util";

const { MEDICAL_CERTIFICATE, LICENSE_CERTIFICATE } = LicenseRenewalDocumentType;

describe("pickRenewalOcrData (#224)", () => {
  it("keeps the medical fields and drops rawText", () => {
    expect(
      pickRenewalOcrData(MEDICAL_CERTIFICATE, {
        isApte: true,
        date: "2026-01-01",
        doctorName: "Martin",
        rawText: "texte du certificat",
        licenseNumber: "not for this type",
      }),
    ).toEqual({ isApte: true, date: "2026-01-01", doctorName: "Martin" });
  });

  it("keeps the licence fields only, isApte excluded", () => {
    expect(
      pickRenewalOcrData(LICENSE_CERTIFICATE, {
        licenseNumber: "123",
        expiryDate: "2026-12-31",
        name: "Jean Dupont",
        isApte: true,
        rawText: "x",
      }),
    ).toEqual({ licenseNumber: "123", expiryDate: "2026-12-31" });
  });

  it("drops wrongly typed values", () => {
    expect(
      pickRenewalOcrData(MEDICAL_CERTIFICATE, {
        isApte: "true",
        date: 20260101,
        doctorName: null,
      }),
    ).toEqual({});
  });

  it.each([null, undefined, "text", 3, ["rawText"]])(
    "returns null for non-object %p",
    (value) => {
      expect(pickRenewalOcrData(MEDICAL_CERTIFICATE, value)).toBeNull();
    },
  );
});

describe("renewal responses", () => {
  it("sanitizes a document and keeps its other columns", () => {
    expect(
      toRenewalDocumentResponse({
        id: "d1",
        type: MEDICAL_CERTIFICATE,
        ocrData: { isApte: false, rawText: "x" },
      }),
    ).toEqual({
      id: "d1",
      type: MEDICAL_CERTIFICATE,
      ocrData: { isApte: false },
    });
  });

  it("sanitizes every document of a request", () => {
    const result = toRenewalRequestResponse({
      id: "r1",
      documents: [
        { type: MEDICAL_CERTIFICATE, ocrData: { rawText: "a" } },
        { type: LICENSE_CERTIFICATE, ocrData: null },
      ],
    });
    expect(result).toEqual({
      id: "r1",
      documents: [
        { type: MEDICAL_CERTIFICATE, ocrData: {} },
        { type: LICENSE_CERTIFICATE, ocrData: null },
      ],
    });
  });
});
