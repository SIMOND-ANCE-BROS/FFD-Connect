import { Test } from "@nestjs/testing";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { adminAuditLogSelect } from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";

describe("AdminAuditService", () => {
  let service: AdminAuditService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminAuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminAuditService);
  });

  it("records an entry through the given transaction client", async () => {
    await service.record(prisma, {
      actorId: "admin-1",
      action: "USER_UPDATE",
      targetType: "USER",
      targetId: "u1",
      before: { lastName: "B" },
      after: { lastName: "C" },
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "USER_UPDATE",
        targetType: "USER",
        targetId: "u1",
        before: { lastName: "B" },
        after: { lastName: "C" },
      },
      select: { id: true },
    });
  });

  it("builds the same row as an operation for array transactions", () => {
    prisma.adminAuditLog.create.mockReturnValue("create-op" as never);

    const op = service.recordOp({
      actorId: "admin-1",
      action: "USER_DELETE",
      targetType: "USER",
      targetId: "u1",
      after: { role: "LICENSEE" },
    });

    expect(op).toBe("create-op");
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "USER_DELETE",
        targetType: "USER",
        targetId: "u1",
        before: undefined,
        after: { role: "LICENSEE" },
      },
      select: { id: true },
    });
  });

  it("lists newest first with filters and maps the author name", async () => {
    prisma.adminAuditLog.count.mockResolvedValue(1);
    prisma.adminAuditLog.findMany.mockResolvedValue([
      {
        id: "l1",
        action: "USER_UPDATE",
        targetType: "USER",
        targetId: "u1",
        before: { lastName: "B" },
        after: { lastName: "C" },
        createdAt: new Date("2026-10-07T10:00:00Z"),
        actor: { id: "admin-1", firstName: "Gabin", lastName: "S" },
      },
    ] as never);

    const page = await service.list({
      skip: 0,
      take: 20,
      targetType: "USER",
      targetId: "u1",
    });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { targetType: "USER", targetId: "u1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 20,
      select: adminAuditLogSelect,
    });
    expect(page.meta.total).toBe(1);
    expect(page.data[0].actorName).toBe("Gabin S");
  });

  it("reports a deleted author as null", async () => {
    prisma.adminAuditLog.count.mockResolvedValue(1);
    prisma.adminAuditLog.findMany.mockResolvedValue([
      {
        id: "l1",
        action: "USER_UPDATE",
        targetType: "USER",
        targetId: "u1",
        before: null,
        after: null,
        createdAt: new Date(),
        actor: null,
      },
    ] as never);
    const page = await service.list({});
    expect(page.data[0]).toMatchObject({ actorId: null, actorName: null });
  });
});
