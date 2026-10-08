import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  competitionOrganizerSelect,
  userRolesClubNameSelect,
} from "../../utils/prisma-selects";
import { CompetitionAccessService } from "./competition-access.service";

describe("CompetitionAccessService", () => {
  const prisma = {
    competition: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const service = new CompetitionAccessService(
    prisma as unknown as PrismaService,
  );

  const clubUser = (overrides: Record<string, unknown> = {}) => ({
    role: UserRole.CLUB,
    extraRoles: [],
    clubId: "club-1",
    clubName: "Dance Club Paris",
    club: { disabledAt: null, name: "Dance Club Paris" },
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.competition.findUnique.mockResolvedValue({
      organizer: "  dance club PARIS ",
    });
  });

  describe("assertCanManageCheckIn", () => {
    it.each([UserRole.STAFF, UserRole.ADMIN])(
      "lets %s through on any competition without a lookup",
      async (role) => {
        await expect(
          service.assertCanManageCheckIn("comp-1", {
            userId: "u1",
            role,
            roles: [role],
          }),
        ).resolves.toBeUndefined();
        expect(prisma.competition.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      },
    );

    it("derives roles from the main role when roles are absent", async () => {
      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "u1",
          role: UserRole.STAFF,
        }),
      ).resolves.toBeUndefined();
      expect(prisma.competition.findUnique).not.toHaveBeenCalled();
    });

    it("lets a CLUB account manage a competition its club organizes", async () => {
      prisma.user.findUnique.mockResolvedValue(clubUser());

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "club-user",
          role: UserRole.CLUB,
          roles: [UserRole.CLUB],
        }),
      ).resolves.toBeUndefined();
      expect(prisma.competition.findUnique).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        select: competitionOrganizerSelect,
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "club-user" },
        select: userRolesClubNameSelect,
      });
    });

    it("matches on the linked club name when clubName is empty", async () => {
      prisma.user.findUnique.mockResolvedValue(clubUser({ clubName: null }));

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "club-user",
          role: UserRole.CLUB,
          roles: [UserRole.CLUB],
        }),
      ).resolves.toBeUndefined();
    });

    it("refuses a CLUB account of another club (403)", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({
          clubName: "Other Club",
          club: { disabledAt: null, name: "Other Club" },
        }),
      );

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "club-user",
          role: UserRole.CLUB,
          roles: [UserRole.CLUB],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses a CLUB account when the competition has no organizer", async () => {
      prisma.competition.findUnique.mockResolvedValue({ organizer: null });
      prisma.user.findUnique.mockResolvedValue(
        clubUser({ clubName: "", club: null }),
      );

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "club-user",
          role: UserRole.CLUB,
          roles: [UserRole.CLUB],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses a LICENSEE (403), even with a matching club name", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({ role: UserRole.LICENSEE }),
      );

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "licensee",
          role: UserRole.LICENSEE,
          roles: [UserRole.LICENSEE],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses an extra CLUB role whose club is disabled", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          club: { disabledAt: new Date(), name: "Dance Club Paris" },
        }),
      );

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "club-user",
          role: UserRole.LICENSEE,
          roles: [UserRole.LICENSEE],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses when the account no longer exists", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.assertCanManageCheckIn("comp-1", {
          userId: "gone",
          role: UserRole.CLUB,
          roles: [UserRole.CLUB],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("returns 404 when the competition does not exist", async () => {
      prisma.competition.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(clubUser());

      await expect(
        service.assertCanManageCheckIn("missing", {
          userId: "club-user",
          role: UserRole.CLUB,
          roles: [UserRole.CLUB],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
