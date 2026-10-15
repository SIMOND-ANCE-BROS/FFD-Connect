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
    club: { findMany: jest.fn() },
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

  describe("assertCanManageCompetition (#381)", () => {
    const club = {
      userId: "club-user",
      role: UserRole.CLUB,
      roles: [UserRole.CLUB],
    };

    it.each([UserRole.STAFF, UserRole.ADMIN])(
      "lets %s edit any competition",
      async (role) => {
        await expect(
          service.assertCanManageCompetition("comp-1", {
            userId: "u1",
            role,
            roles: [role],
          }),
        ).resolves.toBeUndefined();
        expect(prisma.competition.findUnique).not.toHaveBeenCalled();
      },
    );

    it("lets the organizing club edit its competition", async () => {
      prisma.user.findUnique.mockResolvedValue(clubUser());

      await expect(
        service.assertCanManageCompetition("comp-1", club),
      ).resolves.toBeUndefined();
    });

    it("refuses a club editing another club's competition", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({
          clubName: "Other Club",
          club: { disabledAt: null, name: "Other Club" },
        }),
      );

      await expect(
        service.assertCanManageCompetition("comp-1", club),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses a competition without organizer", async () => {
      prisma.competition.findUnique.mockResolvedValue({ organizer: null });
      prisma.user.findUnique.mockResolvedValue(clubUser());

      await expect(
        service.assertCanManageCompetition("comp-1", club),
      ).rejects.toThrow(ForbiddenException);
    });

    it("returns 404 for an unknown competition", async () => {
      prisma.competition.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(clubUser());

      await expect(
        service.assertCanManageCompetition("missing", club),
      ).rejects.toThrow(NotFoundException);
    });

    describe("linked competition (organizerClubId, #408)", () => {
      it("lets the linked club in even after a rename left the label stale", async () => {
        prisma.competition.findUnique.mockResolvedValue({
          organizer: "Ancien Nom",
          organizerClubId: "club-1",
        });
        prisma.user.findUnique.mockResolvedValue(clubUser());

        await expect(
          service.assertCanManageCompetition("comp-1", club),
        ).resolves.toBeUndefined();
      });

      it("refuses a homonym club (name differing only by case) — ids decide", async () => {
        prisma.competition.findUnique.mockResolvedValue({
          organizer: "Dance Club Paris",
          organizerClubId: "club-1",
        });
        prisma.user.findUnique.mockResolvedValue(
          clubUser({
            clubId: "club-2",
            clubName: "dance club paris",
            club: { disabledAt: null, name: "dance club paris" },
          }),
        );

        await expect(
          service.assertCanManageCompetition("comp-1", club),
        ).rejects.toThrow(ForbiddenException);
      });

      it("matches a legacy account without clubId on the label", async () => {
        prisma.competition.findUnique.mockResolvedValue({
          organizer: "Dance Club Paris",
          organizerClubId: "club-1",
        });
        prisma.user.findUnique.mockResolvedValue(
          clubUser({ clubId: null, club: null }),
        );

        await expect(
          service.assertCanManageCompetition("comp-1", club),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("organizerForNewCompetition (#381)", () => {
    const club = {
      userId: "club-user",
      role: UserRole.CLUB,
      roles: [UserRole.CLUB],
    };

    it.each([UserRole.STAFF, UserRole.ADMIN])(
      "leaves the organizer unset for %s",
      async (role) => {
        await expect(
          service.organizerForNewCompetition({
            userId: "u1",
            role,
            roles: [role],
          }),
        ).resolves.toBeUndefined();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      },
    );

    it("returns the club relation name of a CLUB account", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({ club: { disabledAt: null, name: " Dance Club Paris " } }),
      );

      await expect(service.organizerForNewCompetition(club)).resolves.toEqual({
        organizer: "Dance Club Paris",
        organizerClubId: "club-1",
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "club-user" },
        select: userRolesClubNameSelect,
      });
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("falls back to the stored club name", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({ club: { disabledAt: null, name: null } }),
      );

      await expect(service.organizerForNewCompetition(club)).resolves.toEqual({
        organizer: "Dance Club Paris",
        organizerClubId: "club-1",
      });
    });

    it("links a legacy account without clubId to the one club of its name (#408)", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({ clubId: null, club: null }),
      );
      prisma.club.findMany.mockResolvedValue([{ id: "club-legacy" }]);

      await expect(service.organizerForNewCompetition(club)).resolves.toEqual({
        organizer: "Dance Club Paris",
        organizerClubId: "club-legacy",
      });
    });

    it("leaves a legacy account unlinked when its name is ambiguous (#408)", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubUser({ clubId: null, club: null }),
      );
      prisma.club.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

      await expect(service.organizerForNewCompetition(club)).resolves.toEqual({
        organizer: "Dance Club Paris",
        organizerClubId: null,
      });
    });

    it.each([
      ["a missing account", null],
      [
        "a CLUB account without a club",
        { role: UserRole.CLUB, extraRoles: [], clubName: "  ", club: null },
      ],
      [
        "an account that is not a club",
        {
          role: UserRole.LICENSEE,
          extraRoles: [],
          clubName: "Dance Club Paris",
          club: null,
        },
      ],
    ])("refuses %s", async (_label, user) => {
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.organizerForNewCompetition(club)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
