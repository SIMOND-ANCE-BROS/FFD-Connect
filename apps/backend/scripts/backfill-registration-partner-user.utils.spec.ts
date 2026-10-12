import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { registrationPartnerBackfillSelect } from "../src/utils/prisma-selects";
import {
  BACKFILL_MAX_MIRRORS,
  backfillRegistrationPartnerUsers,
} from "./backfill-registration-partner-user.utils";

const reg = (
  id: string,
  userId: string,
  name: [string, string],
  partnerName: string | null,
  bibNumber = 12,
  eventId = "e1",
) => ({
  id,
  eventId,
  userId,
  bibNumber,
  partnerName,
  user: { id: userId, firstName: name[0], lastName: name[1] },
});

describe("backfillRegistrationPartnerUsers", () => {
  let prisma: MockProxy<PrismaClient>;
  const sam = reg("ra", "sam", ["Sam", "PETIT"], "Alex MARTIN");
  const alex = reg("rb", "alex", ["Alex", "MARTIN"], "Sam PETIT");

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.registration.updateMany.mockResolvedValue({ count: 1 });
  });

  it("links both halves of a couple and pages with a keyset cursor", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([sam, alex] as never) // page 1
      .mockResolvedValueOnce([sam, alex] as never) // mirrors
      .mockResolvedValueOnce([]); // page 2

    const report = await backfillRegistrationPartnerUsers(prisma, false);

    expect(report).toEqual({
      scanned: 2,
      linked: 2,
      unmatched: 0,
      cappedPages: 0,
    });
    expect(prisma.registration.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        partnerUserId: null,
        partnerName: { not: null },
        bibNumber: { gt: 0 },
      },
      select: registrationPartnerBackfillSelect,
      orderBy: { id: "asc" },
      take: 200,
    });
    expect(prisma.registration.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        OR: [
          { eventId: "e1", bibNumber: 12 },
          { eventId: "e1", bibNumber: 12 },
        ],
      },
      select: registrationPartnerBackfillSelect,
      orderBy: { id: "asc" },
      take: BACKFILL_MAX_MIRRORS,
    });
    expect(prisma.registration.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: "rb" } }),
      }),
    );
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: "ra", partnerUserId: null },
      data: { partnerUserId: "alex" },
    });
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: "rb", partnerUserId: null },
      data: { partnerUserId: "sam" },
    });
  });

  it("writes nothing in dry-run but reports what it would link", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([sam] as never)
      .mockResolvedValueOnce([sam, alex] as never)
      .mockResolvedValueOnce([]);

    const report = await backfillRegistrationPartnerUsers(prisma, true);

    expect(report.linked).toBe(1);
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  });

  it("counts unmatched rows (other event, ambiguous) and links nothing", async () => {
    const lonely = reg("rc", "lou", ["Lou", "BLANC"], "Alex MARTIN", 12, "e2");
    const twin = reg("rd", "alex2", ["Alex", "MARTIN"], null);
    prisma.registration.findMany
      .mockResolvedValueOnce([sam, lonely] as never)
      .mockResolvedValueOnce([sam, alex, twin, lonely] as never)
      .mockResolvedValueOnce([]);

    const report = await backfillRegistrationPartnerUsers(prisma, false);

    expect(report).toMatchObject({ scanned: 2, linked: 0, unmatched: 2 });
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  });

  it("does not count a row linked concurrently in between", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([sam] as never)
      .mockResolvedValueOnce([sam, alex] as never)
      .mockResolvedValueOnce([]);
    prisma.registration.updateMany.mockResolvedValue({ count: 0 });

    const report = await backfillRegistrationPartnerUsers(prisma, false);

    expect(report.linked).toBe(0);
  });

  it("reports a page whose mirror read hit the cap", async () => {
    const mirrors = Array.from({ length: BACKFILL_MAX_MIRRORS }, () => alex);
    prisma.registration.findMany
      .mockResolvedValueOnce([sam] as never)
      .mockResolvedValueOnce(mirrors)
      .mockResolvedValueOnce([]);

    const report = await backfillRegistrationPartnerUsers(prisma, true);

    expect(report.cappedPages).toBe(1);
  });
});
