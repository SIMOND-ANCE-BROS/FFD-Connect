import { Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import {
  registrationEventBibSelect,
  registrationEventHolderSelect,
  registrationPartnerNameSelect,
  resultParticipantSelect,
  userNameSelect,
} from "../utils/prisma-selects";
import {
  buildPartnerNameScrubOps,
  MAX_PARTNER_SCRUB_ROWS,
} from "./partner-name-scrub";

describe("buildPartnerNameScrubOps", () => {
  let prisma: MockProxy<PrismaClient>;
  let logger: { warn: jest.Mock };
  const marker = (op: string) => ({ op }) as never;

  // Typed unknown[]: the ops are PrismaPromises, never awaited by the tests.
  const run = (): Promise<unknown[]> =>
    buildPartnerNameScrubOps(
      prisma as unknown as PrismaService,
      "deleted",
      logger as unknown as Logger,
    );

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    logger = { warn: jest.fn() };
    prisma.user.findUnique.mockResolvedValue({
      id: "deleted",
      firstName: "Alex",
      lastName: "MARTIN",
    });
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.result.findMany.mockResolvedValue([]);
    prisma.registration.updateMany.mockReturnValue(marker("legacyReg"));
    prisma.result.update.mockReturnValue(marker("result"));
  });

  it("does nothing when the user no longer exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(run()).resolves.toEqual([]);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it("reads the user's couples with shared, bounded selects", async () => {
    await run();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "deleted" },
      select: userNameSelect,
    });
    expect(prisma.registration.findMany).toHaveBeenCalledWith({
      where: { userId: "deleted" },
      select: registrationEventBibSelect,
      take: MAX_PARTNER_SCRUB_ROWS,
    });
    expect(prisma.registration.findMany).toHaveBeenCalledWith({
      where: { partnerUserId: "deleted" },
      select: registrationEventHolderSelect,
      take: MAX_PARTNER_SCRUB_ROWS,
    });
  });

  it("returns no op and reads nothing more without any couple", async () => {
    await expect(run()).resolves.toEqual([]);
    expect(prisma.registration.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.result.findMany).not.toHaveBeenCalled();
  });

  it("ignores own registrations without a usable bib", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([
        { eventId: "e1", bibNumber: 0 },
        { eventId: "e2", bibNumber: null },
      ] as never)
      .mockResolvedValueOnce([]);
    await expect(run()).resolves.toEqual([]);
    expect(prisma.result.findMany).not.toHaveBeenCalled();
  });

  it("clears partnerName on the legacy partner registration of the same couple, confirmed by name", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([{ eventId: "e1", bibNumber: 12 }] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "reg-partner", partnerName: "MARTIN Alex" },
        { id: "reg-other", partnerName: "Lou BLANC" },
      ] as never);

    const ops = await run();

    expect(prisma.registration.findMany).toHaveBeenNthCalledWith(3, {
      where: {
        userId: { not: "deleted" },
        partnerUserId: null,
        partnerName: { not: null },
        OR: [{ eventId: "e1", bibNumber: 12 }],
      },
      select: registrationPartnerNameSelect,
      take: MAX_PARTNER_SCRUB_ROWS,
    });
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["reg-partner"] }, partnerUserId: null },
      data: { partnerName: null },
    });
    expect(ops).toEqual([marker("legacyReg")]);
  });

  it("writes no registration op when no legacy row names the user", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([{ eventId: "e1", bibNumber: 12 }] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "reg-other", partnerName: "Lou BLANC" },
      ] as never);
    await run();
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  });

  it("finds couple results by event + bib and by the partner's registration", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([{ eventId: "e1", bibNumber: 12 }] as never)
      .mockResolvedValueOnce([{ eventId: "e2", userId: "partner" }] as never)
      .mockResolvedValueOnce([]);

    await run();

    expect(prisma.result.findMany).toHaveBeenCalledWith({
      where: {
        userId: { not: "deleted" },
        OR: [
          { eventId: "e1", details: { path: ["bib"], equals: "12" } },
          { eventId: "e1", details: { path: ["bib"], equals: 12 } },
          { eventId: "e2", userId: "partner" },
        ],
      },
      select: resultParticipantSelect,
      take: MAX_PARTNER_SCRUB_ROWS,
    });
  });

  it("replaces only the user's half of the couple label, keeping the other details", async () => {
    prisma.registration.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ eventId: "e2", userId: "partner" }] as never);
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        details: { participant: "Sam PETIT / Alex MARTIN", bib: "7" },
      },
      { id: "r2", details: { participant: "Sam PETIT / Lou BLANC" } },
      { id: "r3", details: null },
    ] as never);

    const ops = await run();

    expect(prisma.result.update).toHaveBeenCalledTimes(1);
    expect(prisma.result.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: {
        details: { participant: "Sam PETIT / Partenaire supprimé", bib: "7" },
      },
    });
    expect(ops).toEqual([marker("result")]);
  });

  it("warns (without identifiers) when a read hits the cap", async () => {
    const full = Array.from({ length: MAX_PARTNER_SCRUB_ROWS }, () => ({
      eventId: "e1",
      bibNumber: null,
    }));
    prisma.registration.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([]);

    await run();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain("deleted");
  });

  it("does not warn under the cap", async () => {
    await run();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
