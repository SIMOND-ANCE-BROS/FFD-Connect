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
    prisma.adminAuditLog.deleteMany.mockReturnValue(marker("auditPurge"));
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
    expect(ops).toEqual(["auditPurge", "user", "adminAudit"]);
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
});
