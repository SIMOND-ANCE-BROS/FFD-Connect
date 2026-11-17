import { PrismaService } from "../prisma/prisma.service";
import {
  idOnlySelect,
  inactiveAccountWarningSelect,
} from "../utils/prisma-selects";
import {
  deletionDueWhere,
  LastLoginAtRef,
  warningClaimableWhere,
  warningDueWhere,
} from "./inactive-account.rules";
import { InactiveAccountsQueryService } from "./inactive-accounts.query-service";

const NOW = new Date("2029-06-15T10:00:00.000Z");
const REF = { name: "lastLoginAt" } as unknown as LastLoginAtRef;

describe("InactiveAccountsQueryService (#991)", () => {
  const prisma = {
    user: {
      fields: { lastLoginAt: REF },
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };
  const service = new InactiveAccountsQueryService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("reads warning targets bounded, ordered by id, with the shared select", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "u1" }]);

    await expect(service.findWarningDue(NOW, undefined, 50)).resolves.toEqual([
      { id: "u1" },
    ]);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        AND: [warningDueWhere(NOW, REF), warningClaimableWhere(NOW)],
      },
      select: inactiveAccountWarningSelect,
      orderBy: { id: "asc" },
      take: 50,
    });
  });

  it("continues after the last id read (keyset pagination)", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.findWarningDue(NOW, "u9", 10);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { AND: [warningDueWhere(NOW, REF), warningClaimableWhere(NOW)] },
            { id: { gt: "u9" } },
          ],
        },
        take: 10,
      }),
    );
  });

  it("returns the ids due for deletion, bounded", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    await expect(service.findDeletionDueIds(NOW, "u0", 25)).resolves.toEqual([
      "a",
      "b",
    ]);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { AND: [deletionDueWhere(NOW, REF), { id: { gt: "u0" } }] },
      select: idOnlySelect,
      orderBy: { id: "asc" },
      take: 25,
    });
  });

  it("re-checks one account with the deletion filter", async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: "a" });
    await expect(service.isDeletionDue("a", NOW)).resolves.toBe(true);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "a" }, deletionDueWhere(NOW, REF)] },
      select: idOnlySelect,
    });

    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.isDeletionDue("a", NOW)).resolves.toBe(false);
  });

  it("counts both stages for the dry run", async () => {
    prisma.user.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);

    await expect(service.countDue(NOW)).resolves.toEqual({
      warning: 4,
      deletion: 1,
    });

    expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
      where: warningDueWhere(NOW, REF),
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
      where: deletionDueWhere(NOW, REF),
    });
  });
});
