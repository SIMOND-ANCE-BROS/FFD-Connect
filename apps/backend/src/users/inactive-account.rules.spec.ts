import { Prisma } from "@prisma/client";
import {
  deletionCutoff,
  deletionDueWhere,
  INACTIVITY_RETENTION_YEARS,
  INACTIVITY_WARNING_NOTICE_DAYS,
  lastActivityBefore,
  LastLoginAtRef,
  noticeCutoff,
  scheduledDeletionDate,
  warningCutoff,
  warningDueWhere,
} from "./inactive-account.rules";

const NOW = new Date("2029-06-15T10:00:00.000Z");
const REF = { name: "lastLoginAt" } as unknown as LastLoginAtRef;

describe("inactive-account rules (#991)", () => {
  it("publishes 3 years of retention and 30 days of notice", () => {
    expect(INACTIVITY_RETENTION_YEARS).toBe(3);
    expect(INACTIVITY_WARNING_NOTICE_DAYS).toBe(30);
  });

  it("computes the cutoffs from now", () => {
    expect(deletionCutoff(NOW)).toEqual(new Date("2026-06-15T10:00:00.000Z"));
    expect(warningCutoff(NOW)).toEqual(new Date("2026-07-15T10:00:00.000Z"));
    expect(noticeCutoff(NOW)).toEqual(new Date("2029-05-16T10:00:00.000Z"));
  });

  it("handles a 29 February now", () => {
    expect(deletionCutoff(new Date("2028-02-29T00:00:00.000Z"))).toEqual(
      new Date("2025-03-01T00:00:00.000Z"),
    );
  });

  it("falls back to createdAt for an account that never logged in", () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    expect(lastActivityBefore(cutoff)).toEqual({
      OR: [
        { lastLoginAt: { lt: cutoff } },
        { lastLoginAt: null, createdAt: { lt: cutoff } },
      ],
    });
  });

  describe("warningDueWhere", () => {
    const where = warningDueWhere(NOW, REF);
    const and = where.AND as Prisma.UserWhereInput[];

    it("never selects the store-review account", () => {
      expect(and).toContainEqual({ isStoreReview: false });
    });

    it("selects accounts inactive for 3 years minus 30 days", () => {
      expect(and).toContainEqual(lastActivityBefore(warningCutoff(NOW)));
    });

    it("selects never-warned accounts and those warned before their last login", () => {
      expect(and).toContainEqual({
        OR: [
          { inactivityWarningSentAt: null },
          { inactivityWarningSentAt: { lt: REF } },
        ],
      });
    });
  });

  describe("deletionDueWhere", () => {
    const where = deletionDueWhere(NOW, REF);
    const and = where.AND as Prisma.UserWhereInput[];

    it("never selects the store-review account", () => {
      expect(and).toContainEqual({ isStoreReview: false });
    });

    it("selects accounts inactive for 3 years", () => {
      expect(and).toContainEqual(lastActivityBefore(deletionCutoff(NOW)));
    });

    it("requires a warning sent at least 30 days ago (never unwarned)", () => {
      expect(and).toContainEqual({
        inactivityWarningSentAt: { lte: noticeCutoff(NOW) },
      });
    });

    it("ignores a warning older than the last login", () => {
      expect(and).toContainEqual({
        OR: [{ lastLoginAt: null }, { inactivityWarningSentAt: { gt: REF } }],
      });
    });
  });

  describe("scheduledDeletionDate", () => {
    it("is 3 years after the last login when that leaves 30 days of notice", () => {
      const lastLoginAt = new Date("2026-07-10T00:00:00.000Z");
      expect(
        scheduledDeletionDate(
          { lastLoginAt, createdAt: new Date("2020-01-01") },
          new Date("2029-06-01T00:00:00.000Z"),
        ),
      ).toEqual(new Date("2029-07-10T00:00:00.000Z"));
    });

    it("falls back to createdAt when the account never logged in", () => {
      expect(
        scheduledDeletionDate(
          {
            lastLoginAt: null,
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
          },
          new Date("2029-06-01T00:00:00.000Z"),
        ),
      ).toEqual(new Date("2029-07-10T00:00:00.000Z"));
    });

    it("never announces less than 30 days of notice (late warning)", () => {
      expect(
        scheduledDeletionDate(
          {
            lastLoginAt: new Date("2020-01-01T00:00:00.000Z"),
            createdAt: new Date("2019-01-01T00:00:00.000Z"),
          },
          NOW,
        ),
      ).toEqual(new Date("2029-07-15T10:00:00.000Z"));
    });
  });
});
