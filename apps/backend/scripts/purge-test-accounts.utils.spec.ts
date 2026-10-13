import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { licenseRenewalDocumentFileSelect } from "../src/utils/prisma-selects";
import {
  DELETED_USER_ID,
  buildAccountDeletionOperations,
} from "../src/users/account-deletion.core";
import {
  LEGACY_STORE_REVIEW_CLUB_NAME,
  LEGACY_STORE_REVIEW_EMAIL,
  PurgeUserPrisma,
  STORE_REVIEW_CLUB_NAME,
  STORE_REVIEW_EMAIL,
  MAX_RENEWAL_DOCUMENTS_PER_USER,
  buildPurgeUserOperations,
  formatPurgeSummary,
  formatUserPurged,
  isTestLicenseNumber,
  purgeTestUser,
  isTestUser,
  pickStoreReviewAccount,
  selectTestClubs,
  selectTestUsers,
} from "./purge-test-accounts.utils";

const user = (id: string, email: string, isStoreReview = false) => ({
  id,
  email,
  isStoreReview,
});

describe("pickStoreReviewAccount (#473)", () => {
  it("prefers the flagged holder of the new address, even if younger", () => {
    const rows = [
      user("legacy", LEGACY_STORE_REVIEW_EMAIL, true),
      user("demo", ` ${STORE_REVIEW_EMAIL.toUpperCase()}`, true),
    ];
    expect(pickStoreReviewAccount(rows)?.id).toBe("demo");
  });

  it("falls back to the oldest flagged account before the rename", () => {
    const rows = [
      user("legacy", LEGACY_STORE_REVIEW_EMAIL, true),
      user("other", "x@test.com", true),
    ];
    expect(pickStoreReviewAccount(rows)?.id).toBe("legacy");
  });

  it("prefers any flagged account over an unflagged holder of the address", () => {
    const rows = [
      user("demo", STORE_REVIEW_EMAIL),
      user("edited", "renamed@x.fr", true),
    ];
    expect(pickStoreReviewAccount(rows)?.id).toBe("edited");
  });

  it("returns the unflagged holder of the address, else null", () => {
    expect(pickStoreReviewAccount([user("demo", STORE_REVIEW_EMAIL)])?.id).toBe(
      "demo",
    );
    expect(pickStoreReviewAccount([])).toBeNull();
  });
});

describe("isTestUser", () => {
  it.each([
    ["u1", "beta@test.com"],
    ["u2", "club@test.com"],
    ["u3", "Partner-Demo@TEST.com"],
    ["u4", " staff@test.com "],
    ["seed-scan-user-1", "scan1@whatever.fr"],
  ])("matches seeded account %s <%s>", (id, email) => {
    expect(isTestUser(user(id, email), null)).toBe(true);
  });

  it.each([
    ["u1", "jane.doe@gmail.com"],
    ["u2", "someone@test.com.fr"],
    ["u3", "someone@mytest.com"],
    ["u4", "test.e2e@ffd.com"],
    ["seedling", "x@example.org"],
  ])("never matches a regular account %s <%s>", (id, email) => {
    expect(isTestUser(user(id, email), null)).toBe(false);
  });

  it("always keeps the holder of the new address, flagged or not", () => {
    expect(isTestUser(user("u1", STORE_REVIEW_EMAIL, true), "other")).toBe(
      false,
    );
    expect(
      isTestUser(user("seed-x", ` ${STORE_REVIEW_EMAIL.toUpperCase()}`), null),
    ).toBe(false);
  });

  it("keeps the chosen store-review account, whatever its address", () => {
    // Not renamed yet: the seed renames it in place, its id must survive.
    expect(isTestUser(user("u1", LEGACY_STORE_REVIEW_EMAIL, true), "u1")).toBe(
      false,
    );
  });

  it("purges a legacy licensee@test.com once the new account exists (#473)", () => {
    // Recreated (flagged) by an image older than #348, demo@ is kept instead.
    expect(
      isTestUser(
        user("u2", ` ${LEGACY_STORE_REVIEW_EMAIL.toUpperCase()}`, true),
        "demo",
      ),
    ).toBe(true);
    // Unflagged: an ordinary test account, never the store-review one.
    expect(isTestUser(user("u3", LEGACY_STORE_REVIEW_EMAIL), null)).toBe(true);
  });

  it("no longer protects a flagged @test.com duplicate by its flag", () => {
    expect(isTestUser(user("seed-x", "x@test.com", true), "demo")).toBe(true);
  });

  it("never purges a flagged account outside the test domain", () => {
    expect(isTestUser(user("u9", "real@example.org", true), "demo")).toBe(
      false,
    );
  });
});

describe("selectTestUsers", () => {
  it("keeps the order and filters out real and store-review accounts", () => {
    const rows = [
      user("a", "admin@test.com"),
      user("b", "real@example.org"),
      user("c", STORE_REVIEW_EMAIL, true),
      user("seed-scan-user-2", "scan2@test.com"),
    ];
    expect(selectTestUsers(rows, "c").map((u) => u.id)).toEqual([
      "a",
      "seed-scan-user-2",
    ]);
  });

  it("purges the recreated legacy account, keeps the renamed one (#473)", () => {
    const demo = user("demo", STORE_REVIEW_EMAIL, true);
    const legacy = user("legacy", LEGACY_STORE_REVIEW_EMAIL, true);
    const kept = pickStoreReviewAccount([demo, legacy])?.id ?? null;
    expect(selectTestUsers([legacy], kept).map((u) => u.id)).toEqual([
      "legacy",
    ]);
  });

  it("keeps the legacy account the seed will rename when demo@ is absent", () => {
    const legacy = user("legacy", LEGACY_STORE_REVIEW_EMAIL, true);
    const kept = pickStoreReviewAccount([legacy])?.id ?? null;
    expect(selectTestUsers([legacy], kept)).toEqual([]);
  });
});

describe("selectTestClubs", () => {
  const club = (
    id: string,
    name: string,
    memberIds: string[],
    isStoreReview = false,
  ) => ({ id, name, memberIds, isStoreReview });

  it("selects a seeded club whose members are all purged", () => {
    const clubs = [club("c1", "Club Démo Bêta", ["p1", "p2"])];
    expect(selectTestClubs(clubs, new Set(["p1", "p2"]))).toEqual(clubs);
  });

  it("matches seeded names ignoring case and spaces, also when empty", () => {
    const clubs = [club("c1", "  club démo bêta ", [])];
    expect(selectTestClubs(clubs, new Set())).toHaveLength(1);
  });

  it("keeps a seeded club a surviving account is attached to", () => {
    const clubs = [club("c1", "Club Démo Bêta", ["p1", "real"])];
    expect(selectTestClubs(clubs, new Set(["p1"]))).toEqual([]);
  });

  it("keeps the store-review club, flagged or not yet", () => {
    const clubs = [
      club("c1", STORE_REVIEW_CLUB_NAME, [], true),
      club("c2", STORE_REVIEW_CLUB_NAME, []),
      club("c3", "Club Démo Bêta", [], true),
    ];
    expect(selectTestClubs(clubs, new Set())).toEqual([]);
  });

  it("purges a legacy club once the new club exists (#473)", () => {
    const clubs = [
      club("n", STORE_REVIEW_CLUB_NAME, ["demo"], true),
      club(
        "l",
        ` ${LEGACY_STORE_REVIEW_CLUB_NAME.toUpperCase()}`,
        ["legacy"],
        true,
      ),
    ];
    expect(
      selectTestClubs(clubs, new Set(["legacy"])).map((c) => c.id),
    ).toEqual(["l"]);
    // A surviving member keeps it.
    expect(selectTestClubs(clubs, new Set())).toEqual([]);
  });

  it("keeps the legacy club the seed will rename when the new one is absent", () => {
    const clubs = [club("l", LEGACY_STORE_REVIEW_CLUB_NAME, [], true)];
    expect(selectTestClubs(clubs, new Set())).toEqual([]);
  });

  it("never selects a club that is not a seeded one", () => {
    const clubs = [club("c1", "Paris Danse Club", [])];
    expect(selectTestClubs(clubs, new Set())).toEqual([]);
  });
});

describe("isTestLicenseNumber", () => {
  it.each(["SCAN-TEST-001", "SCAN-TEST-002", "BETA-EXPIRY-TEST"])(
    "matches seeded license %s",
    (n) => expect(isTestLicenseNumber(n)).toBe(true),
  );

  it.each([
    "TEST-LICENSEE-001",
    "20000101-ber-lu01",
    "SCAN-TEST-",
    "X-SCAN-TEST-1",
  ])("keeps license %s", (n) => expect(isTestLicenseNumber(n)).toBe(false));
});

describe("buildPurgeUserOperations (#412)", () => {
  /**
   * Prisma stand-in recording each operation as "<delegate>.<method>" + args,
   * so the purge transaction can be compared with the account deletion core.
   */
  const recordingPrisma = () =>
    new Proxy(
      {},
      {
        get: (_target, delegate: string) =>
          new Proxy(
            {},
            {
              get: (_t, method: string) => (args: unknown) => ({
                op: `${delegate}.${method}`,
                args,
              }),
            },
          ),
      },
    ) as unknown as PurgeUserPrisma;

  const plan = {
    results: [
      {
        id: "r1",
        details: { participant: "X", status: "OK" },
        event: { competitionId: "c1" },
      },
    ],
    // #395 scrub ops are built before the transaction; the purge must run them.
    partnerNameScrub: {
      ops: [{ op: "partnerNameScrub" } as never],
      competitionIds: [],
    },
    // #423 notification scrub ops, built before the transaction too.
    notificationNameScrub: [{ op: "notificationNameScrub" } as never],
  };

  it("deletes the seeded licenses, then runs the exact account deletion core", () => {
    const ops = buildPurgeUserOperations(recordingPrisma(), "u1", ["l1"], plan);

    expect(ops[0]).toEqual({
      op: "license.deleteMany",
      args: { where: { id: { in: ["l1"] } } },
    });
    // Single list of relations: whatever the core does, the purge does too.
    expect(ops.slice(1)).toEqual(
      buildAccountDeletionOperations(recordingPrisma(), "u1", plan),
    );
  });

  it("anonymises the results with the tombstone and the admin audit rows", () => {
    const ops = buildPurgeUserOperations(
      recordingPrisma(),
      "u1",
      [],
      plan,
    ) as unknown as { op: string; args: unknown }[];

    expect(ops).toContainEqual({
      op: "result.updateMany",
      args: {
        where: { id: "r1", userId: "u1" },
        data: { userId: DELETED_USER_ID, details: { status: "OK" } },
      },
    });
    expect(ops).toContainEqual({
      op: "result.updateMany",
      args: {
        where: { userId: "u1" },
        data: { userId: DELETED_USER_ID, details: {} },
      },
    });
    expect(ops.map((o) => o.op)).toContain("adminAuditLog.updateMany");
    expect(ops.map((o) => o.op)).toContain("partnerNameScrub");
    expect(ops.map((o) => o.op)).toContain("notificationNameScrub");
    expect(ops[ops.length - 1]).toEqual({
      op: "user.delete",
      args: { where: { id: "u1" } },
    });
  });
});

describe("purgeTestUser (#430)", () => {
  let prisma: MockProxy<PrismaClient>;
  let files: { deleteFiles: jest.Mock };
  let warn: jest.Mock;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.license.findMany.mockResolvedValue([
      { id: "l1", number: "SCAN-TEST-1" },
      { id: "l2", number: "123456" },
    ] as never);
    prisma.licenseRenewalDocument.findMany.mockResolvedValue([
      { filePath: "document-1.pdf" },
      { filePath: "document-2.jpg" },
    ] as never);
    // Unknown user for the partner-name scrub; no result of their own.
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.result.findMany.mockResolvedValue([]);
    // Organisers' notification scrub (#423): nothing links here.
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.partnership.findMany.mockResolvedValue([]);
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.$transaction.mockResolvedValue([{ count: 1 }] as never);
    files = {
      deleteFiles: jest.fn().mockResolvedValue(new Set(["document-1.pdf"])),
    };
    warn = jest.fn();
  });

  const run = () => purgeTestUser({ prisma, files, warn }, "u1");

  it("reads the renewal file references (bounded) before the transaction", async () => {
    await run();
    expect(prisma.licenseRenewalDocument.findMany).toHaveBeenCalledWith({
      where: { request: { userId: "u1" } },
      select: licenseRenewalDocumentFileSelect,
      take: MAX_RENEWAL_DOCUMENTS_PER_USER,
    });
    expect(
      prisma.licenseRenewalDocument.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
  });

  it("deletes the stored renewal files only after the commit", async () => {
    const report = await run();

    expect(files.deleteFiles).toHaveBeenCalledWith(
      ["document-1.pdf", "document-2.jpg"],
      "account-deletion",
    );
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      files.deleteFiles.mock.invocationCallOrder[0],
    );
    expect(report).toEqual({
      resultsAnonymised: 0,
      partnerNameCopiesScrubbed: 0,
      seededLicensesDeleted: 1,
      licensesUnlinked: 1,
      renewalFilesDeleted: 1,
      renewalFilesFailed: 1,
    });
  });

  it("touches no file when the transaction fails", async () => {
    prisma.$transaction.mockRejectedValue(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
    expect(files.deleteFiles).not.toHaveBeenCalled();
  });

  it("warns when the renewal document read hits its cap", async () => {
    prisma.licenseRenewalDocument.findMany.mockResolvedValue(
      Array.from({ length: MAX_RENEWAL_DOCUMENTS_PER_USER }, (_, i) => ({
        filePath: `d-${i}`,
      })),
    );
    files.deleteFiles.mockResolvedValue(new Set());
    await run();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("renewal document read hit"),
    );
  });
});

describe("purge log lines (#430)", () => {
  const report = {
    resultsAnonymised: 2,
    partnerNameCopiesScrubbed: 1,
    seededLicensesDeleted: 1,
    licensesUnlinked: 0,
    renewalFilesDeleted: 2,
    renewalFilesFailed: 0,
  };

  it("names accounts by id only, never by e-mail", () => {
    const lines = [
      ...formatPurgeSummary({
        dryRun: true,
        userIds: ["u1", "seed-scan-user-1"],
        clubs: [{ id: "c1", name: "Club Démo Bêta" }],
        keptUserIds: ["store-review-id"],
      }),
      ...formatPurgeSummary({
        dryRun: false,
        userIds: [],
        clubs: [],
        keptUserIds: [],
      }),
      formatUserPurged("u1", report),
      formatUserPurged("u1", { ...report, renewalFilesFailed: 1 }),
    ];
    for (const line of lines) expect(line).not.toContain("@");
    expect(lines).toContain("  - user u1");
    expect(lines[0]).toContain(
      "keeping 1 candidate account(s) (store-review-id)",
    );
    expect(lines.join("\n")).toContain("keeping 0 candidate account(s).");
  });

  it("reports the renewal file outcome", () => {
    expect(formatUserPurged("u1", report)).toContain(
      "2 renewal file(s) deleted",
    );
    expect(formatUserPurged("u1", report)).not.toContain("FAILED");
    expect(
      formatUserPurged("u1", { ...report, renewalFilesFailed: 1 }),
    ).toContain("1 renewal file deletion(s) FAILED");
  });
});
