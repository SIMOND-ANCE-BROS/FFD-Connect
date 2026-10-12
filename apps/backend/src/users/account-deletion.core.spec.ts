import { Prisma, PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { resultAnonymizationSelect } from "../utils/prisma-selects";
import {
  anonymizeOrphanedResults,
  buildAccountDeletionOperations,
  DELETED_USER_ID,
  findResultsToAnonymize,
  MAX_ORPHANED_RESULTS,
  MAX_RESULTS_TO_ANONYMIZE,
} from "./account-deletion.core";

describe("account-deletion.core", () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("reads the user's results with the shared bounded select", async () => {
    prisma.result.findMany.mockResolvedValue([]);
    await findResultsToAnonymize(prisma, "u1");
    expect(prisma.result.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: resultAnonymizationSelect,
      take: MAX_RESULTS_TO_ANONYMIZE,
    });
  });

  describe("buildAccountDeletionOperations", () => {
    it("anonymises results first and deletes the user row last", () => {
      const marker = (op: string) => ({ op }) as never;
      prisma.result.updateMany.mockReturnValue(marker("result"));
      prisma.notification.deleteMany.mockReturnValue(marker("notification"));
      prisma.seatBooking.deleteMany.mockReturnValue(marker("seat"));
      prisma.registration.deleteMany.mockReturnValue(marker("registration"));
      prisma.registration.updateMany.mockReturnValue(marker("partner"));
      prisma.trackCorrection.updateMany.mockReturnValue(marker("correction"));
      prisma.bugReport.deleteMany.mockReturnValue(marker("bug"));
      prisma.adminAuditLog.updateMany.mockReturnValue(marker("audit"));
      prisma.user.delete.mockReturnValue(marker("user"));

      const ops = buildAccountDeletionOperations(prisma, "u1", [
        { id: "r1", details: { participant: "X", status: "FINAL" } },
      ]) as unknown as { op: string }[];

      expect(ops.map((o) => o.op)).toEqual([
        "result",
        "result",
        "notification",
        "seat",
        "registration",
        "partner",
        "correction",
        "bug",
        "audit",
        "user",
      ]);
      expect(prisma.result.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: "r1", userId: "u1" },
        data: { userId: DELETED_USER_ID, details: { status: "FINAL" } },
      });
      expect(prisma.adminAuditLog.updateMany).toHaveBeenCalledWith({
        where: { targetType: "USER", targetId: "u1" },
        data: { before: Prisma.DbNull, after: Prisma.DbNull },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
    });
  });

  describe("anonymizeOrphanedResults", () => {
    it("does nothing when no result is orphaned", async () => {
      prisma.$queryRaw.mockResolvedValue([] as never);

      await expect(anonymizeOrphanedResults(prisma)).resolves.toBe(0);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      // The read excludes tombstoned rows and is bounded.
      const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(strings.join("?")).toContain('NOT EXISTS (SELECT 1 FROM "User"');
      // Synthetic seed ids (seed-live-couple-*) are never swept.
      expect(strings.join("?")).toContain(
        `r."userId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
      );
      expect(values).toEqual([DELETED_USER_ID, MAX_ORPHANED_RESULTS]);
    });

    it("anonymises each orphan, guarded on its former user id", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: "r1", userId: "gone-1", details: { participant: "X", marks: 3 } },
        { id: "r2", userId: "gone-2", details: null },
      ] as never);
      prisma.$transaction.mockResolvedValue([
        { count: 1 },
        { count: 0 },
      ] as never);

      await expect(anonymizeOrphanedResults(prisma)).resolves.toBe(1);

      expect(prisma.result.updateMany).toHaveBeenCalledWith({
        where: { id: "r1", userId: "gone-1" },
        data: { userId: DELETED_USER_ID, details: { marks: 3 } },
      });
      expect(prisma.result.updateMany).toHaveBeenCalledWith({
        where: { id: "r2", userId: "gone-2" },
        data: { userId: DELETED_USER_ID, details: {} },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
