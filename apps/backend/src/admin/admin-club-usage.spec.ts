import { UserRole } from "@prisma/client";
import { withRole } from "../auth/roles";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { clubUsage, isClubEmpty } from "./admin-club-usage";

describe("clubUsage", () => {
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
  });

  it("counts members, club accounts, competitions by name, partnerships and solo teams", async () => {
    prisma.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    prisma.competition.count.mockResolvedValue(2);
    prisma.partnership.count.mockResolvedValue(4);
    prisma.soloTeam.count.mockResolvedValue(5);

    await expect(
      clubUsage(prisma, { id: "c1", name: "Club A" }),
    ).resolves.toEqual({
      memberCount: 3,
      clubAccountCount: 1,
      competitionCount: 2,
      partnershipCount: 4,
      soloTeamCount: 5,
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
      where: { clubId: "c1", NOT: withRole(UserRole.CLUB) },
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
      where: { clubId: "c1", ...withRole(UserRole.CLUB) },
    });
    expect(prisma.competition.count).toHaveBeenCalledWith({
      where: { organizer: { equals: "Club A", mode: "insensitive" } },
    });
    expect(prisma.partnership.count).toHaveBeenCalledWith({
      where: { clubId: "c1" },
    });
    expect(prisma.soloTeam.count).toHaveBeenCalledWith({
      where: { clubId: "c1" },
    });
  });

  it("a club is empty only when every count is zero", () => {
    const zero = {
      memberCount: 0,
      clubAccountCount: 0,
      competitionCount: 0,
      partnershipCount: 0,
      soloTeamCount: 0,
    };
    expect(isClubEmpty(zero)).toBe(true);
    expect(isClubEmpty({ ...zero, partnershipCount: 1 })).toBe(false);
  });
});
