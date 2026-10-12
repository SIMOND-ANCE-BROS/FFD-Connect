import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { AccountDeletionService } from "./account-deletion.service";

describe("AccountDeletionService", () => {
  let service: AccountDeletionService;
  let prisma: MockProxy<PrismaClient>;
  let files: { deleteFiles: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockResolvedValue([] as never);
    prisma.licenseRenewalDocument.findMany.mockResolvedValue([]);
    files = { deleteFiles: jest.fn().mockResolvedValue(new Set()) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: RenewalDocumentFileCleaner, useValue: files },
      ],
    }).compile();
    service = moduleRef.get(AccountDeletionService);
  });

  it("runs the caller's operations after the user deletion, in the same transaction", async () => {
    const marker = (op: string) => ({ op }) as never;
    prisma.adminAuditLog.updateMany.mockReturnValue(marker("auditAnon"));
    prisma.user.delete.mockReturnValue(marker("user"));

    await service.deleteAccount("u1", [marker("adminAudit")]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = (
      prisma.$transaction.mock.calls[0][0] as unknown as Array<
        { op?: string } | undefined
      >
    )
      .map((o) => o?.op)
      .filter(Boolean);
    expect(ops).toEqual(["auditAnon", "user", "adminAudit"]);
  });

  it("checks no password: authorising the deletion is the caller's job", async () => {
    await service.deleteAccount("u1");
    // The only user read is the name lookup of the partner-name scrub (#395).
    expect(prisma.user.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ password: true }),
      }),
    );
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("scrubs the partner-name copies in the same transaction, before the user row goes (#395)", async () => {
    const marker = (op: string) => ({ op }) as never;
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      firstName: "Alex",
      lastName: "MARTIN",
    });
    prisma.registration.findMany
      .mockResolvedValueOnce([{ eventId: "e1", bibNumber: 12 }] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "reg-partner", partnerName: "Alex MARTIN" },
      ] as never);
    prisma.result.findMany.mockResolvedValue([
      { id: "r1", details: { participant: "Sam PETIT / Alex MARTIN" } },
    ] as never);
    prisma.registration.updateMany.mockReturnValue(marker("partnerReg"));
    prisma.result.update.mockReturnValue(marker("coupleResult"));
    prisma.user.delete.mockReturnValue(marker("user"));

    await service.deleteAccount("u1");

    const ops = (
      prisma.$transaction.mock.calls[0][0] as unknown as Array<
        { op?: string } | undefined
      >
    )
      .map((o) => o?.op)
      .filter(Boolean);
    // partnerReg twice: the partnerUserId-linked rows, then the legacy ones.
    expect(ops).toEqual(["partnerReg", "partnerReg", "coupleResult", "user"]);
    expect(
      prisma.registration.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
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
});
