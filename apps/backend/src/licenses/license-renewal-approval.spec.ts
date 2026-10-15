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
  LICENSE_CATEGORY_UNKNOWN,
  LICENSE_CLUB_UNKNOWN,
} from "./beta-license-placeholder";
import {
  approvePendingRenewal,
  LicenseNumberTakenException,
  LicenseNumberUnknownException,
  MedicalCertificateMissingException,
  RENEWAL_MEDICAL_CERTIFICATE_MISSING,
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
    retiredLicenseNumber: { upsert: jest.fn() },
  };
  const client = tx as unknown as Prisma.TransactionClient;

  const target = (
    o: {
      status?: LicenseRenewalStatus;
      ocrNumber?: string | null;
      license?: { id?: string; number: string; validUntil: Date } | null;
      /** false: the medical certificate is gone (purged). */
      medical?: boolean;
      /** Holder's profile override (discipline, levels, club). */
      user?: Partial<{
        category: string | null;
        competitionLevelLatin: string | null;
        competitionLevelStandard: string | null;
        clubName: string | null;
        club: { id: string; name: string } | null;
      }>;
    } = {},
  ) => ({
    status: o.status ?? LicenseRenewalStatus.PENDING,
    userId: "user-1",
    documents: [
      ...(o.medical === false
        ? []
        : [
            {
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              ocrData: { isApte: true },
            },
          ]),
      ...(o.ocrNumber === null
        ? []
        : [
            {
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              ocrData: { licenseNumber: o.ocrNumber ?? "FFD-OCR" },
            },
          ]),
    ],
    user: {
      category: "Latin",
      competitionLevelLatin: null,
      competitionLevelStandard: null,
      clubName: "CVDS",
      club: null,
      ...o.user,
      license: o.license ? { id: "L1", ...o.license } : null,
    },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    tx.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.license.upsert.mockResolvedValue({ id: "L1" });
  });

  it("400 without a medical certificate on file: nothing claimed, no licence (#271)", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({ medical: false }),
    );
    const error: unknown = await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      licenseNumber: "FFD-1",
      now: new Date(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MedicalCertificateMissingException);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as MedicalCertificateMissingException).code).toBe(
      RENEWAL_MEDICAL_CERTIFICATE_MISSING,
    );
    expect(tx.licenseRenewalRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.license.upsert).not.toHaveBeenCalled();
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
          category: "Latin",
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
      reviewerId: "admin-1",
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(result.validUntil).toEqual(later);
    expect(result.licenseNumber).toBe("FFD-OLD");
    expect(result.previousLicenseNumber).toBeNull();
    expect(tx.retiredLicenseNumber.upsert).not.toHaveBeenCalled();
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
    // #466: the replaced number is retired, in the same transaction.
    expect(result.previousLicenseNumber).toBe("FFD-OLD");
    expect(tx.retiredLicenseNumber.upsert).toHaveBeenCalledWith({
      where: { number: "FFD-OLD" },
      create: { number: "FFD-OLD", licenseId: "L1" },
      update: { licenseId: "L1", retiredAt: expect.any(Date) as unknown },
      select: { number: true },
    });
  });

  it("retires nothing when the confirmed number is the current one", async () => {
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
      licenseNumber: " FFD-OLD ",
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(result.previousLicenseNumber).toBeNull();
    expect(tx.retiredLicenseNumber.upsert).not.toHaveBeenCalled();
  });

  it("retires nothing when a first licence is created with the confirmed number", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(target());

    const result = await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      licenseNumber: "FFD-NEW",
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(result.previousLicenseNumber).toBeNull();
    expect(tx.retiredLicenseNumber.upsert).not.toHaveBeenCalled();
  });

  it("does not retire the number when the renamed licence write fails", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({
        license: {
          number: "FFD-OLD",
          validUntil: new Date("2026-08-31T21:59:59.999Z"),
        },
      }),
    );
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
    ).rejects.toBeInstanceOf(LicenseNumberTakenException);
    expect(tx.retiredLicenseNumber.upsert).not.toHaveBeenCalled();
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

  it("an empty OCR number falls back to the existing licence number (#240)", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({
        ocrNumber: "",
        license: {
          number: "FFD-OLD",
          validUntil: new Date("2026-08-31T21:59:59.999Z"),
        },
      }),
    );

    const result = await approvePendingRenewal(client, "req-1", {
      reviewerId: "admin-1",
      licenseNumber: "",
      now: new Date("2027-03-15T10:00:00.000Z"),
    });

    expect(result.licenseNumber).toBe("FFD-OLD");
    expect(tx.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ number: "FFD-OLD" }) as unknown,
        update: { validUntil: SEASON_END_2027 },
      }),
    );
  });

  it('an empty OCR number and no licence: 400, never a licence numbered "" (#240)', async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({ ocrNumber: "" }),
    );

    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        now: new Date(),
      }),
    ).rejects.toThrow(LicenseNumberUnknownException);
    expect(tx.license.upsert).not.toHaveBeenCalled();
  });

  describe("category and club of a created licence (#282)", () => {
    type Profile = NonNullable<Parameters<typeof target>[0]>["user"];
    const createdWith = async (user: Profile) => {
      tx.licenseRenewalRequest.findUnique.mockResolvedValue(target({ user }));
      await approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        now: new Date("2027-03-15T10:00:00.000Z"),
      });
      const [[args]] = tx.license.upsert.mock.calls as [
        [{ create: { category: string; clubName: string } }],
      ];
      return {
        category: args.create.category,
        clubName: args.create.clubName,
      };
    };

    it("invents nothing for a holder without discipline nor club", async () => {
      const created = await createdWith({
        category: null,
        clubName: null,
        club: null,
      });

      expect(created).toEqual({
        category: LICENSE_CATEGORY_UNKNOWN,
        clubName: LICENSE_CLUB_UNKNOWN,
      });
      expect(created.category).not.toBe("Standard");
      expect(created.clubName).not.toBe("Club");
    });

    it("blank profile values count as unknown", async () => {
      expect(
        await createdWith({ category: "  ", clubName: "  ", club: null }),
      ).toEqual({
        category: LICENSE_CATEGORY_UNKNOWN,
        clubName: LICENSE_CLUB_UNKNOWN,
      });
    });

    it("a category that is not a discipline is not copied", async () => {
      expect((await createdWith({ category: "Elite" })).category).toBe(
        LICENSE_CATEGORY_UNKNOWN,
      );
    });

    it("derives the discipline from the competition levels", async () => {
      expect(
        (
          await createdWith({
            category: null,
            competitionLevelLatin: "Avancé",
            competitionLevelStandard: "Intermédiaire",
          })
        ).category,
      ).toBe("Ten Dance");
    });

    it("takes the linked club when the free-text club name is empty", async () => {
      expect(
        (
          await createdWith({
            clubName: null,
            club: { id: "club-1", name: "Danse Club Lyon" },
          })
        ).clubName,
      ).toBe("Danse Club Lyon");
    });

    it("the free-text club name wins, trimmed", async () => {
      expect(
        (
          await createdWith({
            clubName: " CVDS ",
            club: { id: "club-1", name: "Other" },
          })
        ).clubName,
      ).toBe("CVDS");
    });
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

  it("ignores an OCR reading not shaped like a licence number", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({
        ocrNumber: "<script>",
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
      }),
    );
  });

  it("an invalid OCR reading and no other number: LicenseNumberUnknownException", async () => {
    tx.licenseRenewalRequest.findUnique.mockResolvedValue(
      target({ ocrNumber: "x".repeat(40) }),
    );
    await expect(
      approvePendingRenewal(client, "req-1", {
        reviewerId: "admin-1",
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(LicenseNumberUnknownException);
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
    ).rejects.toBeInstanceOf(LicenseNumberTakenException);
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
