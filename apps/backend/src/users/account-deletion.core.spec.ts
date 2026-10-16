import { erasedLicenceFingerprint } from "../utils/results-pseudonym";
import { Prisma, PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { resultAnonymizationSelect } from "../utils/prisma-selects";
import {
  affectedResultCompetitionIds,
  anonymizeOrphanedResults,
  buildAccountDeletionOperations,
  findLicenceFingerprints,
  MAX_LICENCE_NUMBERS_TO_FINGERPRINT,
  DELETED_USER_ID,
  findResultsToAnonymize,
  MAX_ORPHANED_RESULTS,
  MAX_RESULTS_TO_ANONYMIZE,
  prepareAccountDeletion,
} from "./account-deletion.core";

// A fake key (not a secret): only its length matters.
const KEY = "k".repeat(40);

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

      const ops = buildAccountDeletionOperations(prisma, "u1", {
        results: [
          {
            id: "r1",
            details: { participant: "X", status: "FINAL" },
            event: { competitionId: "c1" },
          },
        ],
        partnerNameScrub: {
          ops: [marker("partnerNameScrub")],
          competitionIds: ["c9"],
        },
        notificationNameScrub: [marker("notificationNameScrub")],
      }) as unknown as { op: string }[];

      expect(ops.map((o) => o.op)).toEqual([
        "result",
        "result",
        "notification",
        // #423 scrub of other users' notifications, before the
        // registrations that link them go.
        "notificationNameScrub",
        "seat",
        "registration",
        "partner",
        // #395 scrub, before the user row (and its registrations) go.
        "partnerNameScrub",
        // #652: imported results' second-member link, after the scrub.
        "result",
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

  describe("licence fingerprints (#652)", () => {
    const basePlan = {
      results: [],
      partnerNameScrub: { ops: [], competitionIds: [] },
      notificationNameScrub: [],
    };

    it("keeps the fingerprints, deduplicated by the database, before the user row goes", () => {
      const marker = (op: string) => ({ op }) as never;
      prisma.erasedResultIdentity.createMany.mockReturnValue(marker("erased"));
      prisma.user.delete.mockReturnValue(marker("user"));

      const ops = buildAccountDeletionOperations(prisma, "u1", {
        ...basePlan,
        licenceFingerprints: ["f1", "f2"],
      }) as unknown as ({ op?: string } | undefined)[];

      expect(prisma.erasedResultIdentity.createMany).toHaveBeenCalledWith({
        data: [{ fingerprint: "f1" }, { fingerprint: "f2" }],
        skipDuplicates: true,
      });
      expect(ops.map((o) => o?.op).indexOf("erased")).toBeLessThan(
        ops.map((o) => o?.op).indexOf("user"),
      );
      expect(prisma.result.updateMany).toHaveBeenCalledWith({
        where: { partnerUserId: "u1" },
        data: { partnerUserId: null },
      });
    });

    it("writes no fingerprint op without fingerprints (no key, scripts)", () => {
      void buildAccountDeletionOperations(prisma, "u1", basePlan);
      void buildAccountDeletionOperations(prisma, "u1", {
        ...basePlan,
        licenceFingerprints: [],
      });
      expect(prisma.erasedResultIdentity.createMany).not.toHaveBeenCalled();
    });

    it("fingerprints the current and the retired numbers of the user's licence, never in clear", async () => {
      prisma.license.findUnique.mockResolvedValue({
        id: "lic-1",
        number: " 123456 ",
      });
      prisma.retiredLicenseNumber.findMany.mockResolvedValue([
        { number: "654321" },
        { number: "123456" },
        { number: "bad*number" },
      ] as never);

      const fingerprints = await findLicenceFingerprints(prisma, "u1", KEY);

      expect(prisma.license.findUnique).toHaveBeenCalledWith({
        where: { userId: "u1" },
        select: { id: true, number: true },
      });
      expect(prisma.retiredLicenseNumber.findMany).toHaveBeenCalledWith({
        where: { licenseId: "lic-1" },
        select: { number: true },
        take: MAX_LICENCE_NUMBERS_TO_FINGERPRINT,
      });
      expect(fingerprints).toEqual([
        erasedLicenceFingerprint(KEY, "123456"),
        erasedLicenceFingerprint(KEY, "654321"),
      ]);
      expect(fingerprints.join()).not.toContain("123456");
    });

    it("has no fingerprint for a user without a licence", async () => {
      prisma.license.findUnique.mockResolvedValue(null);
      await expect(findLicenceFingerprints(prisma, "u1", KEY)).resolves.toEqual(
        [],
      );
      expect(prisma.retiredLicenseNumber.findMany).not.toHaveBeenCalled();
    });

    it("prepareAccountDeletion reads the licences only with a key", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.registration.findMany.mockResolvedValue([]);
      prisma.partnership.findMany.mockResolvedValue([]);
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.result.findMany.mockResolvedValue([]);
      prisma.license.findUnique.mockResolvedValue({
        id: "lic-1",
        number: "123456",
      });
      prisma.retiredLicenseNumber.findMany.mockResolvedValue([]);
      const logger = { warn: jest.fn() };

      const withoutKey = await prepareAccountDeletion(prisma, "u1", logger);
      expect(withoutKey.licenceFingerprints).toEqual([]);
      expect(prisma.license.findUnique).not.toHaveBeenCalled();

      const withKey = await prepareAccountDeletion(prisma, "u1", logger, KEY);
      expect(withKey.licenceFingerprints).toEqual([
        erasedLicenceFingerprint(KEY, "123456"),
      ]);
    });
  });

  describe("prepareAccountDeletion", () => {
    it("reads the partner-name scrub before the user's results, and lists the stale result caches", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.registration.findMany.mockResolvedValue([]);
      prisma.partnership.findMany.mockResolvedValue([]);
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.result.findMany.mockResolvedValue([
        { id: "r1", details: {}, event: { competitionId: "c1" } },
        { id: "r2", details: {}, event: { competitionId: "c1" } },
      ] as never);
      const logger = { warn: jest.fn() };

      const plan = await prepareAccountDeletion(prisma, "u1", logger);

      // Unknown user: the scrub has nothing to do.
      expect(plan.partnerNameScrub).toEqual({ ops: [], competitionIds: [] });
      // #423: the notification links are read before the transaction too.
      expect(plan.notificationNameScrub).toEqual([]);
      expect(
        prisma.notification.findMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.result.findMany.mock.invocationCallOrder[0]);
      expect(plan.results).toHaveLength(2);
      expect(prisma.user.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.result.findMany.mock.invocationCallOrder[0],
      );
      expect(
        affectedResultCompetitionIds({
          ...plan,
          partnerNameScrub: { ops: [], competitionIds: ["c9", "c1"] },
        }),
      ).toEqual(["c1", "c9"]);
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
