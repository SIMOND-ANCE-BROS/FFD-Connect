import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { CompetitionCacheService } from "../competitions/services/competition-cache.service";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { resultAnonymizationSelect } from "../utils/prisma-selects";
import {
  AccountDeletionService,
  anonymizeResultDetails,
  MAX_RESULTS_TO_ANONYMIZE,
} from "./account-deletion.service";

describe("AccountDeletionService", () => {
  let service: AccountDeletionService;
  let prisma: MockProxy<PrismaClient>;
  let files: { deleteFiles: jest.Mock };
  let cache: { invalidateResults: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockResolvedValue([] as never);
    prisma.licenseRenewalDocument.findMany.mockResolvedValue([]);
    prisma.result.findMany.mockResolvedValue([]);
    files = { deleteFiles: jest.fn().mockResolvedValue(new Set()) };
    cache = { invalidateResults: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: RenewalDocumentFileCleaner, useValue: files },
        { provide: CompetitionCacheService, useValue: cache },
      ],
    }).compile();
    service = moduleRef.get(AccountDeletionService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const opsOf = () =>
    (
      prisma.$transaction.mock.calls[0][0] as unknown as Array<
        { op?: string } | undefined
      >
    )
      .map((o) => o?.op)
      .filter(Boolean);

  it("runs the caller's operations after the user deletion, in the same transaction", async () => {
    const marker = (op: string) => ({ op }) as never;
    prisma.adminAuditLog.updateMany.mockReturnValue(marker("auditAnon"));
    prisma.user.delete.mockReturnValue(marker("user"));

    await service.deleteAccount("u1", [marker("adminAudit")]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(opsOf()).toEqual(["auditAnon", "user", "adminAudit"]);
  });

  it("checks no password: authorising the deletion is the caller's job", async () => {
    await service.deleteAccount("u1");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("purges the renewal files after the transaction", async () => {
    prisma.licenseRenewalDocument.findMany.mockResolvedValue([
      { filePath: "doc.pdf" },
    ] as never);
    await service.deleteAccount("u1");
    expect(files.deleteFiles).toHaveBeenCalledWith(
      ["doc.pdf"],
      "account-deletion",
    );
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      files.deleteFiles.mock.invocationCallOrder[0],
    );
  });

  describe("competition results (#382)", () => {
    const rows = [
      {
        id: "r1",
        details: {
          participant: "Couple label",
          bib: "12",
          club: "Some club",
          totalParticipants: 8,
        },
        event: { competitionId: "c1" },
      },
      { id: "r2", details: null, event: { competitionId: "c1" } },
      { id: "r3", details: { marks: [1, 2] }, event: { competitionId: "c2" } },
    ];

    it("reads the user's results before the transaction, with the shared bounded select", async () => {
      await service.deleteAccount("u1");
      expect(prisma.result.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        select: resultAnonymizationSelect,
        take: MAX_RESULTS_TO_ANONYMIZE,
      });
      expect(prisma.result.findMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
      expect(prisma.result.delete).not.toHaveBeenCalled();
      expect(prisma.result.deleteMany).not.toHaveBeenCalled();
    });

    it("keeps each ranking row but drops the user link and the identifying details", async () => {
      prisma.result.findMany.mockResolvedValue(rows);

      await service.deleteAccount("u1");

      expect(prisma.result.update).toHaveBeenCalledTimes(3);
      expect(prisma.result.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { userId: null, details: { totalParticipants: 8 } },
      });
      expect(prisma.result.update).toHaveBeenCalledWith({
        where: { id: "r2" },
        data: { userId: null, details: {} },
      });
      expect(prisma.result.update).toHaveBeenCalledWith({
        where: { id: "r3" },
        data: { userId: null, details: { marks: [1, 2] } },
      });
    });

    it("sweeps any row left with the user id (beyond the cap or created meanwhile)", async () => {
      await service.deleteAccount("u1");
      expect(prisma.result.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        data: { userId: null, details: {} },
      });
    });

    it("anonymises the results in the same transaction, before the user row goes", async () => {
      prisma.result.findMany.mockResolvedValue([rows[0]] as never);
      const marker = (op: string) => ({ op }) as never;
      prisma.result.update.mockReturnValue(marker("resultRow"));
      prisma.result.updateMany.mockReturnValue(marker("resultSweep"));
      prisma.user.delete.mockReturnValue(marker("user"));

      await service.deleteAccount("u1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(opsOf()).toEqual(["resultRow", "resultSweep", "user"]);
    });

    it("invalidates the results cache once per competition, after the transaction", async () => {
      prisma.result.findMany.mockResolvedValue(rows);

      await service.deleteAccount("u1");

      expect(cache.invalidateResults).toHaveBeenCalledTimes(2);
      expect(cache.invalidateResults).toHaveBeenCalledWith("c1");
      expect(cache.invalidateResults).toHaveBeenCalledWith("c2");
      expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        cache.invalidateResults.mock.invocationCallOrder[0],
      );
    });

    it("does not fail the deletion when the cache invalidation fails", async () => {
      prisma.result.findMany.mockResolvedValue(rows);
      cache.invalidateResults.mockRejectedValue(new Error("redis down"));
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      await expect(service.deleteAccount("u1")).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("2 results cache invalidation(s) failed"),
      );
    });

    it("touches no cache when the user has no result", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn");
      await service.deleteAccount("u1");
      expect(cache.invalidateResults).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe("anonymizeResultDetails", () => {
  it("keeps only the non-identifying keys", () => {
    expect(
      anonymizeResultDetails({
        participant: "Couple label",
        name: "Someone",
        bib: 7,
        club: "Some club",
        unknownKey: "anything",
        totalParticipants: 12,
        status: "FINAL",
        marks: { a: 1 },
      }),
    ).toEqual({ totalParticipants: 12, status: "FINAL", marks: { a: 1 } });
  });

  it("drops null values of kept keys", () => {
    expect(anonymizeResultDetails({ totalParticipants: null })).toEqual({});
  });

  it.each([null, "text", 3, [1, 2]])(
    "returns an empty object for non-object details (%p)",
    (details) => {
      expect(anonymizeResultDetails(details)).toEqual({});
    },
  );
});
