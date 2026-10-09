import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ClubRegistrationMode, RegistrationStatus } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { ClubsHelloAssoService } from "../../clubs/clubs-helloasso.service";
import { RegistrationNotificationService } from "./registration-notification.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createMockPrismaService } from "../__mocks__/types";
import { CompetitionCacheService } from "./competition-cache.service";
import {
  CompetitionRegistrationService,
  isRegistrationClosed,
  registrationClosedMessage,
  TEN_DANCE_BOTH_DISCIPLINES_MESSAGE,
} from "./competition-registration.service";

const mockPrismaService = createMockPrismaService();
const mockCacheService = {
  invalidateCompetition: jest.fn().mockResolvedValue(null),
  invalidateAll: jest.fn().mockResolvedValue(null),
  invalidateResults: jest.fn().mockResolvedValue(null),
};
const mockClubsService = {
  getRegistrationModeForUser: jest
    .fn()
    .mockResolvedValue(ClubRegistrationMode.CLUB_AND_MEMBERS_PENDING),
};
const mockNotificationService = {
  notifyOnRegister: jest.fn().mockResolvedValue(undefined),
  notifyOnUnregister: jest.fn().mockResolvedValue(undefined),
  notifyOnConfirm: jest.fn().mockResolvedValue(undefined),
};

describe("CompetitionRegistrationService", () => {
  let service: CompetitionRegistrationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionRegistrationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        { provide: CompetitionCacheService, useValue: mockCacheService },
        { provide: ClubsHelloAssoService, useValue: mockClubsService },
        {
          provide: RegistrationNotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<CompetitionRegistrationService>(
      CompetitionRegistrationService,
    );
    jest.clearAllMocks();
    mockClubsService.getRegistrationModeForUser.mockResolvedValue(
      ClubRegistrationMode.CLUB_AND_MEMBERS_PENDING,
    );
  });

  describe("register", () => {
    it("should register user successfully (pending when club requires validation)", async () => {
      const mockEvent = {
        id: "e1",
        competitionId: "c1",
        competition: { title: "Comp", organizer: "Club" },
        category: "Latin",
        ageGroup: "Adult",
      };
      mockPrismaService.event.findUnique.mockResolvedValue(mockEvent);
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.registration.create.mockResolvedValue({
        id: "r1",
      });

      const result = await service.register("e1", "u1", "Partner");

      expect(result.id).toBe("r1");
      expect(mockPrismaService.registration.create).toHaveBeenCalledWith({
        data: {
          eventId: "e1",
          userId: "u1",
          partnerName: "Partner",
          partnerUserId: null,
          status: RegistrationStatus.PENDING,
          coupleAgeGroup: null,
          coupleDisciplineLatin: false,
          coupleDisciplineStandard: false,
        },
      });
      expect(mockCacheService.invalidateCompetition).toHaveBeenCalled();
      expect(mockNotificationService.notifyOnRegister).toHaveBeenCalled();
    });

    it("should throw NotFoundException if event not found", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(null);
      await expect(
        service.register("e1", "u1", undefined, { byOrganizer: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException if already registered", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        competition: { title: "C", organizer: "X" },
        category: "L",
        ageGroup: "A",
      });
      mockPrismaService.registration.findFirst.mockResolvedValue({
        id: "existing",
      });
      await expect(
        service.register("e1", "u1", undefined, { byOrganizer: false }),
      ).rejects.toThrow(ConflictException);
    });

    it("should NOT use event.ageGroup as fallback when couple age computation fails", async () => {
      const mockEvent = {
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "NATIONALE",
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: "CLASSIFICATRICE",
        level: "Avancé",
      };
      mockPrismaService.event.findUnique.mockResolvedValue(mockEvent);
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.registration.create.mockResolvedValue({ id: "r1" });
      mockPrismaService.user.update.mockResolvedValue({});
      // registrant has birthDate, partner has no birthDate → computeCoupleAgeGroup returns null
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: null,
          firstName: "Jean",
          lastName: "Dupont",
        });

      const result = await service.register("e1", "u1", "Jean Dupont", {
        byOrganizer: true,
        partnerUserId: "partner1",
      });

      expect(result.id).toBe("r1");
      // Critical: coupleAgeGroup should be null, NOT "Adulte" (the event's ageGroup)
      expect(mockPrismaService.registration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coupleAgeGroup: null,
          }),
        }),
      );
    });

    it("should throw BadRequestException when age group mismatch even without eventKind/competitionType", async () => {
      const mockEvent = {
        id: "e1",
        competitionId: "c1",
        eventType: "SOLO",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: null,
        },
        category: "Latin",
        ageGroup: "Solo Adulte",
        eventKind: null,
        level: null,
      };
      mockPrismaService.event.findUnique.mockResolvedValue(mockEvent);
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      // Born 2014 → age 11 at ref year 2025 → Solo Juvénile, not Solo Adulte
      mockPrismaService.user.findUnique.mockResolvedValue({
        birthDate: new Date(2014, 5, 1),
      });

      await expect(
        service.register("e1", "u1", undefined, { byOrganizer: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("unregister", () => {
    it("should unregister user successfully", async () => {
      const mockReg = {
        id: "r1",
        event: {
          competitionId: "c1",
          competition: { title: "C" },
          category: "L",
          ageGroup: "A",
        },
      };
      mockPrismaService.registration.findFirst.mockResolvedValue(mockReg);
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CANCELLED,
      });

      const result = await service.unregister("e1", "u1", {});

      expect(result.status).toBe(RegistrationStatus.CANCELLED);
      expect(mockPrismaService.registration.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { status: RegistrationStatus.CANCELLED },
      });
      expect(mockCacheService.invalidateCompetition).toHaveBeenCalled();
    });

    it("should throw NotFoundException if registration not found", async () => {
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      await expect(service.unregister("e1", "u1", {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("register — eligibility and MAJEURE specialty rule (Article 9)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockPrismaService.registration.create.mockResolvedValue({ id: "r1" });
    });

    it("should throw BadRequestException for CLASSIFICATRICE when age group mismatch", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        eventType: "SOLO",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "NATIONALE",
        },
        category: "Latin",
        ageGroup: "Solo Adulte",
        eventKind: "CLASSIFICATRICE",
        level: "Intermédiaire",
      });
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      // Born 2014 → age 11 → Solo Juvénile, not Solo Adulte
      mockPrismaService.user.findUnique.mockResolvedValue({
        birthDate: new Date(2014, 5, 1),
      });

      await expect(
        service.register("e1", "u1", undefined, { byOrganizer: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for CLASSIFICATRICE with insufficient level", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "NATIONALE",
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: "CLASSIFICATRICE",
        level: "Avancé",
      });
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2000, 0, 1),
          firstName: "A",
          lastName: "B",
        });

      await expect(
        service.register("e1", "u1", "A B", {
          byOrganizer: true,
          partnerUserId: "p1",
          registrantLevel: "Débutant",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should succeed for CLASSIFICATRICE with sufficient level", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "NATIONALE",
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: "CLASSIFICATRICE",
        level: "Avancé",
      });
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2000, 0, 1),
          firstName: "A",
          lastName: "B",
        });

      const result = await service.register("e1", "u1", "A B", {
        byOrganizer: true,
        partnerUserId: "p1",
        registrantLevel: "Avancé",
      });

      expect(result.id).toBe("r1");
    });

    describe("level and discipline read from the profile", () => {
      const eventOf = (overrides: Record<string, unknown>) => ({
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "NATIONALE",
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: "CLASSIFICATRICE",
        level: "Avancé",
        ...overrides,
      });
      const partner = {
        birthDate: new Date(2000, 0, 1),
        firstName: "A",
        lastName: "B",
      };
      const mockRegistrant = (profile: Record<string, unknown>) =>
        mockPrismaService.user.findUnique
          .mockResolvedValueOnce({
            birthDate: new Date(2000, 0, 1),
            ...profile,
          })
          .mockResolvedValueOnce(partner);

      beforeEach(() => {
        mockPrismaService.registration.findFirst.mockResolvedValue(null);
      });

      it("uses the profile level OF THE EVENT DISCIPLINE when none is given", async () => {
        mockPrismaService.event.findUnique.mockResolvedValue(eventOf({}));
        mockRegistrant({
          category: "Ten Dance",
          competitionLevelLatin: "International",
          competitionLevelStandard: "Débutant",
        });

        const result = await service.register("e1", "u1", "A B", {
          byOrganizer: true,
          partnerUserId: "p1",
        });
        expect(result.id).toBe("r1");
      });

      it("rejects when the level in the event discipline is too low", async () => {
        mockPrismaService.event.findUnique.mockResolvedValue(
          eventOf({ category: "Standard" }),
        );
        mockRegistrant({
          category: "Ten Dance",
          competitionLevelLatin: "International",
          competitionLevelStandard: "Débutant",
        });

        await expect(
          service.register("e1", "u1", "A B", {
            byOrganizer: true,
            partnerUserId: "p1",
          }),
        ).rejects.toThrow("votre niveau (Débutant) est insuffisant");
      });

      it("Ten Dance: accepts a dancer of both disciplines whatever the level", async () => {
        mockPrismaService.event.findUnique.mockResolvedValue(
          eventOf({
            category: "Ten Dance",
            eventKind: "MAJEURE",
            level: "International",
          }),
        );
        mockRegistrant({
          category: "Latin",
          competitionLevelLatin: "Débutant",
          competitionLevelStandard: "Débutant",
        });

        const result = await service.register("e1", "u1", "A B", {
          byOrganizer: true,
          partnerUserId: "p1",
        });
        expect(result.id).toBe("r1");
      });

      it("Ten Dance: rejects a dancer of a single discipline", async () => {
        mockPrismaService.event.findUnique.mockResolvedValue(
          eventOf({ category: "Ten Dance", eventKind: "MAJEURE", level: null }),
        );
        mockPrismaService.user.findUnique.mockResolvedValueOnce({
          birthDate: new Date(2000, 0, 1),
          category: "Latin",
          competitionLevelLatin: "International",
        });

        await expect(
          service.register("e1", "u1", "A B", {
            byOrganizer: true,
            partnerUserId: "p1",
          }),
        ).rejects.toThrow(TEN_DANCE_BOTH_DISCIPLINES_MESSAGE);
        expect(mockPrismaService.registration.create).not.toHaveBeenCalled();
      });
    });

    const espoirEvent = {
      id: "e1",
      competitionId: "c1",
      eventType: "COUPLE",
      competition: {
        title: "Championnat",
        date: new Date(2026, 5, 1),
        competitionType: "MAJEURE",
      },
      category: "Standard",
      ageGroup: "Espoir",
      eventKind: "MAJEURE",
      level: null,
    };

    it("rejects an Espoir registration when the older partner is 21 or more", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(espoirEvent);
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2005, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2007, 0, 1),
          firstName: "A",
          lastName: "B",
        });

      await expect(
        service.register("e1", "u1", "A B", {
          byOrganizer: true,
          partnerUserId: "p1",
        }),
      ).rejects.toThrow(/moins de 21 ans/);
    });

    it("rejects an Espoir registration when a partner is under 16", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(espoirEvent);
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2009, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2012, 0, 1),
          firstName: "A",
          lastName: "B",
        });

      await expect(
        service.register("e1", "u1", "A B", {
          byOrganizer: true,
          partnerUserId: "p1",
        }),
      ).rejects.toThrow(/moins de 21 ans/);
    });

    it("accepts an Espoir registration for an under-21 Adulte couple", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue(espoirEvent);
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2006, 3, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2007, 0, 1),
          firstName: "A",
          lastName: "B",
        });

      const result = await service.register("e1", "u1", "A B", {
        byOrganizer: true,
        partnerUserId: "p1",
      });

      expect(result.id).toBe("r1");
    });

    it("should throw BadRequestException for second MAJEURE registration in same specialty", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "MAJEURE",
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: "MAJEURE",
        level: null,
      });
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2000, 0, 1),
          firstName: "A",
          lastName: "B",
        });
      // First findFirst = no duplicate; second findFirst = existing registration in same specialty
      mockPrismaService.registration.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing-r" });

      const attempt = service.register("e1", "u1", "A B", {
        byOrganizer: true,
        partnerUserId: "p1",
        coupleAgeGroup: "Adulte",
      });
      await expect(attempt).rejects.toThrow(BadRequestException);
      // French discipline label in the message, not the stored value.
      await expect(attempt).rejects.toThrow(
        "une seule épreuve par spécialité (Latines). Vous êtes déjà inscrit à une épreuve Latines.",
      );
    });

    it("should succeed when no existing MAJEURE registration in same specialty", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: "MAJEURE",
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: "MAJEURE",
        level: null,
      });
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) })
        .mockResolvedValueOnce({
          birthDate: new Date(2000, 0, 1),
          firstName: "A",
          lastName: "B",
        });
      // Both findFirst calls return null
      mockPrismaService.registration.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.register("e1", "u1", "A B", {
        byOrganizer: true,
        partnerUserId: "p1",
        coupleAgeGroup: "Adulte",
      });

      expect(result.id).toBe("r1");
    });
  });

  // -------------------------------------------------------------------------
  // register — COUPLE/SOLO validation branches
  // -------------------------------------------------------------------------

  describe("register — COUPLE/SOLO event type checks", () => {
    const baseEvent = {
      id: "e1",
      competitionId: "c1",
      competition: {
        title: "Comp",
        date: new Date(2025, 5, 1),
        competitionType: null,
      },
      category: "Latin",
      ageGroup: "Adulte",
      eventKind: null,
      level: null,
    };

    it("throws BadRequestException for COUPLE event without partnerName or partnerUserId", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...baseEvent,
        eventType: "COUPLE",
      });

      await expect(service.register("e1", "u1", undefined, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException for SOLO event with partnerName provided", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...baseEvent,
        eventType: "SOLO",
      });

      await expect(
        service.register("e1", "u1", "Partner Name", {}),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ForbiddenException when club mode is CLUB_ONLY", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...baseEvent,
        eventType: "SOLO",
      });
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ birthDate: null });
      mockClubsService.getRegistrationModeForUser.mockResolvedValue(
        ClubRegistrationMode.CLUB_ONLY,
      );

      await expect(
        service.register("e1", "u1", undefined, { byOrganizer: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("auto-confirms registration when club mode is MEMBERS_AUTO_CONFIRM", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        ...baseEvent,
        eventType: "SOLO",
      });
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: null }) // registrant
        .mockResolvedValueOnce({
          // member lookup for notification
          firstName: "Marie",
          lastName: "Curie",
          clubId: "club-1",
          clubName: null,
        });
      mockClubsService.getRegistrationModeForUser.mockResolvedValue(
        ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
      );
      mockPrismaService.registration.create.mockResolvedValue({ id: "r-auto" });
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.register("e1", "u1", undefined, {
        byOrganizer: false,
      });

      expect(result.id).toBe("r-auto");
      expect(mockPrismaService.registration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RegistrationStatus.CONFIRMED,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // register — partner display name derived from partner user
  // -------------------------------------------------------------------------

  describe("register — partner from user record", () => {
    it("uses partner name from user record when no partnerName given but partnerUserId is set", async () => {
      mockPrismaService.event.findUnique.mockResolvedValue({
        id: "e1",
        competitionId: "c1",
        eventType: "COUPLE",
        competition: {
          title: "Comp",
          date: new Date(2025, 5, 1),
          competitionType: null,
        },
        category: "Latin",
        ageGroup: "Adulte",
        eventKind: null,
        level: null,
      });
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ birthDate: new Date(2000, 0, 1) }) // registrant
        .mockResolvedValueOnce({
          birthDate: null,
          firstName: "Paul",
          lastName: "Martin",
        }); // partner
      mockPrismaService.registration.create.mockResolvedValue({
        id: "r-couple",
      });

      const result = await service.register("e1", "u1", undefined, {
        byOrganizer: true,
        partnerUserId: "p1",
      });

      expect(result.id).toBe("r-couple");
      expect(mockPrismaService.registration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ partnerName: "Paul Martin" }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // confirmRegistration
  // -------------------------------------------------------------------------

  describe("confirmRegistration", () => {
    const baseRegistration = {
      id: "r1",
      userId: "u1",
      eventId: "e1",
      status: RegistrationStatus.PENDING,
      user: { id: "u1", clubId: "club-1", clubName: null },
      event: {
        competitionId: "c1",
        category: "Latin",
        ageGroup: "Adulte",
        competition: { title: "Comp 2025" },
      },
    };

    it("throws NotFoundException when registration not found", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmRegistration("reg-missing", "org-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException when registration is not PENDING", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue({
        ...baseRegistration,
        status: RegistrationStatus.CONFIRMED,
      });

      await expect(service.confirmRegistration("r1", "org-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("throws ForbiddenException when organizer has wrong role", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue(
        baseRegistration,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: UserRole.ADMIN,
        clubId: "club-1",
        clubName: null,
      });

      await expect(service.confirmRegistration("r1", "org-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ForbiddenException when organizer is from a different club", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue(
        baseRegistration,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: "club-2",
        clubName: null,
      });

      await expect(service.confirmRegistration("r1", "org-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("accepts a licensee whose CLUB role is an extra role", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue(
        baseRegistration,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        clubId: "club-1",
        clubName: null,
        club: { disabledAt: null },
      });
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CONFIRMED,
      });

      const result = await service.confirmRegistration("r1", "org-1");

      expect(result.status).toBe(RegistrationStatus.CONFIRMED);
    });

    it("refuses an extra CLUB role while the club is disabled", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue(
        baseRegistration,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        clubId: "club-1",
        clubName: null,
        club: { disabledAt: new Date() },
      });

      await expect(service.confirmRegistration("r1", "org-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("confirms a pending registration successfully", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue(
        baseRegistration,
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: "club-1",
        clubName: null,
      });
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CONFIRMED,
      });

      const result = await service.confirmRegistration("r1", "org-1");

      expect(result.status).toBe(RegistrationStatus.CONFIRMED);
      expect(mockNotificationService.notifyOnConfirm).toHaveBeenCalled();
      expect(mockCacheService.invalidateCompetition).toHaveBeenCalledWith(
        "c1",
        "u1",
      );
    });

    it("matches by clubName when neither organizer nor member have clubId", async () => {
      mockPrismaService.registration.findUnique.mockResolvedValue({
        ...baseRegistration,
        user: { id: "u1", clubId: null, clubName: "Club Varois" },
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: null,
        clubName: "club varois",
      });
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CONFIRMED,
      });

      const result = await service.confirmRegistration("r1", "org-1");

      expect(result.status).toBe(RegistrationStatus.CONFIRMED);
    });
  });

  // -------------------------------------------------------------------------
  // unregister — byOrganizer notification paths
  // -------------------------------------------------------------------------

  describe("unregister — notification branches", () => {
    const baseReg = {
      id: "r1",
      status: RegistrationStatus.PENDING,
      event: {
        competitionId: "c1",
        competition: { title: "Comp" },
        category: "Latin",
        ageGroup: "Adulte",
      },
    };

    it("sends 'refused by club' notification when byOrganizer unregisters a PENDING registration", async () => {
      mockPrismaService.registration.findFirst.mockResolvedValue(baseReg);
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CANCELLED,
      });

      await service.unregister("e1", "u1", {
        byOrganizer: true,
        organizerUserId: "org-1",
      });

      expect(mockNotificationService.notifyOnUnregister).toHaveBeenCalled();
    });

    it("sends 'unregistered by club' notification for CONFIRMED registration removed by organizer", async () => {
      mockPrismaService.registration.findFirst.mockResolvedValue({
        ...baseReg,
        status: RegistrationStatus.CONFIRMED,
      });
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CANCELLED,
      });

      await service.unregister("e1", "u1", {
        byOrganizer: true,
        organizerUserId: "org-1",
      });

      expect(mockNotificationService.notifyOnUnregister).toHaveBeenCalled();
    });

    it("notifies club organizers when user self-unregisters and has clubId", async () => {
      mockPrismaService.registration.findFirst.mockResolvedValue(baseReg);
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CANCELLED,
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        firstName: "Jean",
        lastName: "Dupont",
        clubId: "club-1",
        clubName: null,
      });
      mockPrismaService.user.findMany.mockResolvedValue([{ id: "org-1" }]);

      await service.unregister("e1", "u1", {});

      expect(mockNotificationService.notifyOnUnregister).toHaveBeenCalled();
    });
  });

  describe("registerMember", () => {
    it("throws NotFoundException when organizer has wrong role", async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.LICENSEE,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce({ clubId: "club-1", clubName: null });

      await expect(
        service.registerMember("organizer-1", "event-1", "member-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when member not found", async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.CLUB,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.registerMember("organizer-1", "event-1", "member-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when member belongs to different club", async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.CLUB,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce({ clubId: "club-2", clubName: null });

      await expect(
        service.registerMember("organizer-1", "event-1", "member-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when event not found", async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.CLUB,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce({ clubId: "club-1", clubName: null });
      mockPrismaService.event.findUnique.mockResolvedValue(null);

      await expect(
        service.registerMember("organizer-1", "event-1", "member-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("register — registration deadline (#821)", () => {
    // 2026-10-15 23:59 Europe/Paris (CEST, UTC+2)
    const DEADLINE = new Date("2026-10-15T21:59:00.000Z");
    const CLOSED_MESSAGE =
      "Les inscriptions à cette compétition sont closes depuis le 15 octobre 2026 à 23:59.";

    const eventWithDeadline = (registrationDeadline: Date | null) => ({
      id: "e1",
      competitionId: "c1",
      eventType: "SOLO",
      competition: {
        id: "c1",
        title: "Comp",
        date: new Date("2026-11-01T09:00:00.000Z"),
        competitionType: null,
        registrationDeadline,
      },
      category: "Latin",
      ageGroup: "Adulte",
      eventKind: null,
      level: null,
    });

    const setNow = (iso: string) => {
      jest.useFakeTimers({ now: new Date(iso), doNotFake: ["nextTick"] });
    };

    beforeEach(() => {
      mockPrismaService.registration.findFirst.mockResolvedValue(null);
      mockPrismaService.registration.create.mockResolvedValue({ id: "r1" });
      mockPrismaService.user.findUnique.mockResolvedValue(null);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("allows registration before the deadline", async () => {
      setNow("2026-10-15T21:58:59.999Z");
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );

      await expect(service.register("e1", "u1")).resolves.toEqual({
        id: "r1",
      });
      expect(mockPrismaService.registration.create).toHaveBeenCalled();
    });

    it("allows registration exactly at the deadline (inclusive)", async () => {
      setNow(DEADLINE.toISOString());
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );

      await expect(service.register("e1", "u1")).resolves.toEqual({
        id: "r1",
      });
    });

    it("rejects with 403 and a French message 1 ms after the deadline", async () => {
      setNow("2026-10-15T21:59:00.001Z");
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );

      const error: unknown = await service
        .register("e1", "u1")
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).message).toBe(CLOSED_MESSAGE);
      expect(mockPrismaService.registration.create).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyOnRegister).not.toHaveBeenCalled();
    });

    it("selects registrationDeadline on the competition", async () => {
      setNow("2026-10-01T00:00:00.000Z");
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );

      await service.register("e1", "u1");

      expect(mockPrismaService.event.findUnique).toHaveBeenCalledWith({
        where: { id: "e1" },
        include: {
          competition: {
            select: expect.objectContaining({ registrationDeadline: true }),
          },
        },
      });
    });

    it("allows registration when no deadline is set", async () => {
      setNow("2030-01-01T00:00:00.000Z");
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(null),
      );

      await expect(service.register("e1", "u1")).resolves.toEqual({
        id: "r1",
      });
    });

    it("still answers 409 for an already-accepted registration after the deadline", async () => {
      setNow("2026-10-20T00:00:00.000Z");
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );
      mockPrismaService.registration.findFirst.mockResolvedValue({
        id: "existing",
      });

      await expect(service.register("e1", "u1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("applies the deadline to club registrations (registerMember)", async () => {
      setNow("2026-10-16T08:00:00.000Z");
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.CLUB,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce({ clubId: "club-1", clubName: null });
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );

      await expect(
        service.registerMember("organizer-1", "e1", "member-1"),
      ).rejects.toThrow(new ForbiddenException(CLOSED_MESSAGE));
      expect(mockPrismaService.registration.create).not.toHaveBeenCalled();
    });

    it("lets a club register a member before the deadline (confirmed)", async () => {
      setNow("2026-10-15T12:00:00.000Z");
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.CLUB,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce({ clubId: "club-1", clubName: null });
      mockPrismaService.event.findUnique.mockResolvedValue(
        eventWithDeadline(DEADLINE),
      );

      await service.registerMember("organizer-1", "e1", "member-1");

      expect(mockPrismaService.registration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "member-1",
          status: RegistrationStatus.CONFIRMED,
        }),
      });
    });

    it("keeps unregister allowed after the deadline", async () => {
      setNow("2026-10-20T00:00:00.000Z");
      mockPrismaService.registration.findFirst.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CONFIRMED,
        event: {
          competitionId: "c1",
          competition: { title: "Comp", registrationDeadline: DEADLINE },
        },
      });
      mockPrismaService.registration.update.mockResolvedValue({
        id: "r1",
        status: RegistrationStatus.CANCELLED,
      });

      await expect(service.unregister("e1", "u1")).resolves.toEqual({
        id: "r1",
        status: RegistrationStatus.CANCELLED,
      });
    });
  });

  describe("isRegistrationClosed / registrationClosedMessage", () => {
    const deadline = new Date("2026-01-31T22:59:00.000Z");

    it("is exclusive of the deadline instant", () => {
      expect(isRegistrationClosed(deadline, new Date(deadline.getTime()))).toBe(
        false,
      );
      expect(
        isRegistrationClosed(deadline, new Date(deadline.getTime() + 1)),
      ).toBe(true);
      expect(
        isRegistrationClosed(deadline, new Date(deadline.getTime() - 1)),
      ).toBe(false);
    });

    it("never closes without a deadline", () => {
      expect(isRegistrationClosed(null)).toBe(false);
      expect(isRegistrationClosed(undefined)).toBe(false);
    });

    it("defaults to the current time", () => {
      expect(isRegistrationClosed(new Date(Date.now() - 60_000))).toBe(true);
      expect(isRegistrationClosed(new Date(Date.now() + 60_000))).toBe(false);
    });

    it("formats the date in Europe/Paris, winter time included", () => {
      // 22:59 UTC in January = 23:59 CET (UTC+1), still the 31st in Paris
      expect(registrationClosedMessage(deadline)).toBe(
        "Les inscriptions à cette compétition sont closes depuis le 31 janvier 2026 à 23:59.",
      );
      // 23:30 UTC on Jan 31 = 00:30 Feb 1 in Paris
      expect(
        registrationClosedMessage(new Date("2026-01-31T23:30:00.000Z")),
      ).toBe(
        "Les inscriptions à cette compétition sont closes depuis le 1 février 2026 à 00:30.",
      );
    });
  });

  describe("unregisterMember", () => {
    it("throws NotFoundException when member not from organizer club", async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          role: UserRole.CLUB,
          clubId: "club-1",
          clubName: null,
        })
        .mockResolvedValueOnce({ clubId: "club-2", clubName: null });

      await expect(
        service.unregisterMember("organizer-1", "event-1", "member-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
