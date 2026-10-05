import { Test, TestingModule } from "@nestjs/testing";
import { ClubsController } from "./clubs.controller";
import { ClubsHelloAssoService } from "./clubs-helloasso.service";
import { PartnershipQueryService } from "./partnership-query.service";
import { PartnershipService } from "./partnership.service";
import { SoloTeamService } from "./solo-team.service";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";

describe("ClubsController", () => {
  let controller: ClubsController;

  const mockClubsHelloAssoService = {
    getRegistrationModeForUser: jest.fn(),
    getMyClubHelloAssoStatus: jest.fn(),
    connectHelloAsso: jest.fn(),
    setRegistrationMode: jest.fn(),
  };

  const mockPartnershipQueryService = {
    getPartnerships: jest.fn(),
    getClubsForPartnership: jest.fn(),
    getMembersForPartnership: jest.fn(),
  };

  const mockPartnershipService = {
    createPartnership: jest.fn(),
    endPartnership: jest.fn(),
    validatePartnership: jest.fn(),
  };

  const mockSoloTeamService = {
    getSoloTeams: jest.fn(),
    createSoloTeam: jest.fn(),
    getSoloTeam: jest.fn(),
    addSoloTeamMember: jest.fn(),
    removeSoloTeamMember: jest.fn(),
  };

  const req = { user: { userId: "user-1" } } as unknown as RequestWithUser;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClubsController],
      providers: [
        { provide: ClubsHelloAssoService, useValue: mockClubsHelloAssoService },
        {
          provide: PartnershipQueryService,
          useValue: mockPartnershipQueryService,
        },
        { provide: PartnershipService, useValue: mockPartnershipService },
        { provide: SoloTeamService, useValue: mockSoloTeamService },
      ],
    }).compile();

    controller = module.get<ClubsController>(ClubsController);
  });

  // ─── Registration mode ───────────────────────────────────────────────────────

  describe("getMyClubRegistrationMode", () => {
    it("returns the wrapped mode", async () => {
      mockClubsHelloAssoService.getRegistrationModeForUser.mockResolvedValue(
        "CLUB_ONLY",
      );

      const result = await controller.getMyClubRegistrationMode(req);

      expect(result).toEqual({ registrationMode: "CLUB_ONLY" });
      expect(
        mockClubsHelloAssoService.getRegistrationModeForUser,
      ).toHaveBeenCalledWith("user-1");
    });

    it("wraps null when user has no club", async () => {
      mockClubsHelloAssoService.getRegistrationModeForUser.mockResolvedValue(
        null,
      );

      const result = await controller.getMyClubRegistrationMode(req);

      expect(result).toEqual({ registrationMode: null });
    });
  });

  describe("setRegistrationMode", () => {
    it("delegates to service with userId and mode", async () => {
      mockClubsHelloAssoService.setRegistrationMode.mockResolvedValue({
        registrationMode: "CLUB_ONLY",
      });

      const result = await controller.setRegistrationMode(req, {
        registrationMode: "CLUB_ONLY",
      });

      expect(
        mockClubsHelloAssoService.setRegistrationMode,
      ).toHaveBeenCalledWith("user-1", "CLUB_ONLY");
      expect(result).toEqual({ registrationMode: "CLUB_ONLY" });
    });
  });

  // ─── HelloAsso ───────────────────────────────────────────────────────────────

  describe("getHelloAssoStatus", () => {
    it("delegates to service", async () => {
      mockClubsHelloAssoService.getMyClubHelloAssoStatus.mockResolvedValue({
        connected: true,
      });

      const result = await controller.getHelloAssoStatus(req);

      expect(
        mockClubsHelloAssoService.getMyClubHelloAssoStatus,
      ).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ connected: true });
    });
  });

  describe("connectHelloAsso", () => {
    it("delegates to service", async () => {
      const body = {
        clientId: "c",
        clientSecret: "s",
        organizationSlug: "org",
      };
      mockClubsHelloAssoService.connectHelloAsso.mockResolvedValue({
        connected: true,
      });

      const result = await controller.connectHelloAsso(req, body);

      expect(mockClubsHelloAssoService.connectHelloAsso).toHaveBeenCalledWith(
        "user-1",
        body,
      );
      expect(result).toEqual({ connected: true });
    });
  });

  // ─── Partnerships ─────────────────────────────────────────────────────────────

  describe("getPartnerships", () => {
    it("passes activeOnly=true by default (no param)", async () => {
      mockPartnershipQueryService.getPartnerships.mockResolvedValue([]);

      await controller.getPartnerships(req);

      expect(mockPartnershipQueryService.getPartnerships).toHaveBeenCalledWith(
        "user-1",
        true,
      );
    });

    it("passes activeOnly=false when query param is 'false'", async () => {
      mockPartnershipQueryService.getPartnerships.mockResolvedValue([]);

      await controller.getPartnerships(req, "false");

      expect(mockPartnershipQueryService.getPartnerships).toHaveBeenCalledWith(
        "user-1",
        false,
      );
    });

    it("passes activeOnly=true for any other string", async () => {
      mockPartnershipQueryService.getPartnerships.mockResolvedValue([]);

      await controller.getPartnerships(req, "true");

      expect(mockPartnershipQueryService.getPartnerships).toHaveBeenCalledWith(
        "user-1",
        true,
      );
    });
  });

  describe("createPartnership", () => {
    it("delegates to service", async () => {
      const body = { memberId: "m1", partnerId: "m2" };
      mockPartnershipService.createPartnership.mockResolvedValue({ id: "p1" });

      const result = await controller.createPartnership(req, body as any);

      expect(mockPartnershipService.createPartnership).toHaveBeenCalledWith(
        "user-1",
        body,
      );
      expect(result).toEqual({ id: "p1" });
    });
  });

  describe("endPartnership", () => {
    it("delegates to service with id and body", async () => {
      const body = { endDate: "2026-01-01" };
      mockPartnershipService.endPartnership.mockResolvedValue({ id: "p1" });

      const result = await controller.endPartnership(req, "p1", body);

      expect(mockPartnershipService.endPartnership).toHaveBeenCalledWith(
        "user-1",
        "p1",
        body,
      );
      expect(result).toEqual({ id: "p1" });
    });
  });

  describe("validatePartnership", () => {
    it("delegates accepted=true to service", async () => {
      mockPartnershipService.validatePartnership.mockResolvedValue({
        id: "p1",
      });

      await controller.validatePartnership(req, "p1", { accepted: true });

      expect(mockPartnershipService.validatePartnership).toHaveBeenCalledWith(
        "user-1",
        "p1",
        true,
      );
    });

    it("delegates accepted=false to service", async () => {
      mockPartnershipService.validatePartnership.mockResolvedValue({
        id: "p1",
      });

      await controller.validatePartnership(req, "p1", { accepted: false });

      expect(mockPartnershipService.validatePartnership).toHaveBeenCalledWith(
        "user-1",
        "p1",
        false,
      );
    });
  });

  describe("getClubsForPartnership", () => {
    it("delegates to service", async () => {
      mockPartnershipQueryService.getClubsForPartnership.mockResolvedValue([
        { id: "c1" },
      ]);

      const result = await controller.getClubsForPartnership(req);

      expect(
        mockPartnershipQueryService.getClubsForPartnership,
      ).toHaveBeenCalledWith("user-1");
      expect(result).toEqual([{ id: "c1" }]);
    });
  });

  describe("getMembersForPartnership", () => {
    it("delegates without secondaryClubId", async () => {
      mockPartnershipQueryService.getMembersForPartnership.mockResolvedValue(
        [],
      );

      await controller.getMembersForPartnership(req);

      expect(
        mockPartnershipQueryService.getMembersForPartnership,
      ).toHaveBeenCalledWith("user-1", undefined);
    });

    it("delegates with secondaryClubId", async () => {
      mockPartnershipQueryService.getMembersForPartnership.mockResolvedValue(
        [],
      );

      await controller.getMembersForPartnership(req, "club-2");

      expect(
        mockPartnershipQueryService.getMembersForPartnership,
      ).toHaveBeenCalledWith("user-1", "club-2");
    });
  });

  // ─── Solo Teams ──────────────────────────────────────────────────────────────

  describe("getSoloTeams", () => {
    it("delegates to service", async () => {
      mockSoloTeamService.getSoloTeams.mockResolvedValue([{ id: "st1" }]);

      const result = await controller.getSoloTeams(req);

      expect(mockSoloTeamService.getSoloTeams).toHaveBeenCalledWith("user-1");
      expect(result).toEqual([{ id: "st1" }]);
    });
  });

  describe("createSoloTeam", () => {
    it("delegates to service", async () => {
      const body = { name: "Team Alpha" };
      mockSoloTeamService.createSoloTeam.mockResolvedValue({ id: "st1" });

      const result = await controller.createSoloTeam(req, body as any);

      expect(mockSoloTeamService.createSoloTeam).toHaveBeenCalledWith(
        "user-1",
        body,
      );
      expect(result).toEqual({ id: "st1" });
    });
  });

  describe("getSoloTeam", () => {
    it("delegates to service with id", async () => {
      mockSoloTeamService.getSoloTeam.mockResolvedValue({ id: "st1" });

      const result = await controller.getSoloTeam(req, "st1");

      expect(mockSoloTeamService.getSoloTeam).toHaveBeenCalledWith(
        "user-1",
        "st1",
      );
      expect(result).toEqual({ id: "st1" });
    });
  });

  describe("addSoloTeamMember", () => {
    it("delegates to service", async () => {
      mockSoloTeamService.addSoloTeamMember.mockResolvedValue({ id: "st1" });

      const result = await controller.addSoloTeamMember(req, "st1", {
        userId: "u2",
      });

      expect(mockSoloTeamService.addSoloTeamMember).toHaveBeenCalledWith(
        "user-1",
        "st1",
        "u2",
      );
      expect(result).toEqual({ id: "st1" });
    });
  });

  describe("removeSoloTeamMember", () => {
    it("delegates to service", async () => {
      mockSoloTeamService.removeSoloTeamMember.mockResolvedValue({ id: "st1" });

      const result = await controller.removeSoloTeamMember(req, "st1", "u2");

      expect(mockSoloTeamService.removeSoloTeamMember).toHaveBeenCalledWith(
        "user-1",
        "st1",
        "u2",
      );
      expect(result).toEqual({ id: "st1" });
    });
  });
});
