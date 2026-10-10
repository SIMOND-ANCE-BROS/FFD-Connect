import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import {
  approvePendingRenewal,
  renewalAlreadyDecided,
} from "./license-renewal-approval";

/** Last instant of 31/08/2027 in Paris. */
const SEASON_END_2027 = new Date("2027-08-31T21:59:59.999Z");
const SEASON_END_2028 = new Date("2028-08-31T21:59:59.999Z");

describe("approvePendingRenewal", () => {
  const tx = {
    licenseRenewalRequest: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    license: { upsert: jest.fn() },
  };
  const client = tx as unknown as Prisma.TransactionClient;

  const target = (
    o: {
      status?: LicenseRenewalStatus;
      ocrNumber?: string | null;
      license?: { number: string; validUntil: Date } | null;
    } = {},
  ) => ({
    status: o.status ?? LicenseRenewalStatus.PENDING,
    userId: "user-1",
    documents:
      o.ocrNumber === null
        ? [
            {
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              ocrData: { isApte: true },
            },
          ]
        : [
            {
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              ocrData: { licenseNumber: o.ocrNumber ?? "FFD-OCR" },
            },
          ],
    user: {
      category: "Elite",
      clubName: "CVDS",
      license: o.license ?? null,
    },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    tx.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.license.upsert.mockResolvedValue({ id: "L1" });
  });

  it("404 for an unknown request", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(null);
    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        now: new Date(),
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it.each([LicenseRenewalStatus.APPROVED, LicenseRenewalStatus.REJECTED])(
    "409 for a request already %s, nothing written",
    async (status) => {
      tx.licenseRenewalRequest.findUnique.mockResolvedValue(target({ status }));
      await expect(
        approvePendingRenewal(client, "req-1", {
          reviewerId: "admin-1",
          now: new Date(),
        }),
      ).rejects.toThrow(ConflictException);
      expect(tx.licenseRenewalRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.license.upsert).not.toHaveBeenCalled();
    },
  );

  it("claims the request conditionally BEFORE touching the licence (#261)", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(target());
    const now = new Date("2027-03-15T10:00:00.000Z");

    await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      now,
    });

    expect(tx.licenseRenewalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", status: LicenseRenewalStatus.PENDING },
      data: {
        status: LicenseRenewalStatus.APPROVED,
        reviewedById: "admin-1",
        reviewedAt: now,
      },
    });
    expect(
      tx.licenseRenewalRequest.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.license.upsert.mock.invocationCallOrder[0]);
  });

  it("409 when a concurrent decision won the claim: the licence is not renewed twice (#261)", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(target());
    tx.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        now: new Date(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.license.upsert).not.toHaveBeenCalled();
  });

  it("grants the season of the DECISION date (#259)", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(target());

    // July 1 at 00:30 in Paris: the summer campaign grants the next season.
    const result = await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      now: new Date("2027-06-30T22:30:00.000Z"),
    });

    expect(result.validUntil).toEqual(SEASON_END_2028);
    expect(tx.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        create: expect.objectContaining({
          number: "FFD-OCR",
          validUntil: SEASON_END_2028,
          category: "Elite",
          clubName: "CVDS",
        }) as unknown,
        update: { validUntil: SEASON_END_2028 },
      }),
    );
  });

  it("never shortens a licence that already runs later (#250)", async () => {
    const later = new Date("2030-08-31T21:59:59.999Z");
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({ license: { number: "FFD-OLD", validUntil: later } }),
    );

    const result = await approvePendingRenewal(client, "req-1", {
      reviewerId: null,
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(result.validUntil).toEqual(later);
    expect(result.licenseNumber).toBe("FFD-OLD");
  });

  it("the administrator's number wins and replaces an existing licence number (#262)", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({
        license: {
          number: "FFD-OLD",
          validUntil: new Date("2026-08-31T21:59:59.999Z"),
        },
      }),
    );

    const result = await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      licenseNumber: "  FFD-CONFIRMED ",
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(result.licenseNumber).toBe("FFD-CONFIRMED");
    expect(tx.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { validUntil: SEASON_END_2027, number: "FFD-CONFIRMED" },
        create: expect.objectContaining({ number: "FFD-CONFIRMED" }) as unknown,
      }),
    );
  });

  it("falls back to the existing licence number when OCR read none", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({
        ocrNumber: null,
        license: {
          number: "FFD-OLD",
          validUntil: new Date("2026-08-31T21:59:59.999Z"),
        },
      }),
    );

    await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(tx.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ number: "FFD-OLD" }) as unknown,
        update: { validUntil: SEASON_END_2027 },
      }),
    );
  });

  it("never invents a licence number: 400 when none is known (#262)", async () => {
    const random = jest.spyOn(Math, "random");
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({ ocrNumber: "   " }),
    );

    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        licenseNumber: " ",
        now: new Date(),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(random).not.toHaveBeenCalled();
    expect(tx.licenseRenewalRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.license.upsert).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("409 when the confirmed number belongs to another licence", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(target());
    tx.license.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "7",
      }),
    );

    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        licenseNumber: "FFD-TAKEN",
        now: new Date(),
      }),
    ).rejects.toThrow("déjà attribué");
  });

  it("propagates any other licence write error", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(target());
    tx.license.upsert.mockRejectedValue(new Error("db down"));

    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        now: new Date(),
      }),
    ).rejects.toThrow("db down");
  });

  it("renewalAlreadyDecided is a 409", () => {
    expect(renewalAlreadyDecided().getStatus()).toBe(409);
  });
});
