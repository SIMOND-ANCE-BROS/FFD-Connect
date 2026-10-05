// apps/backend/src/clubs/partnership.service.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ClubRegistrationMode,
  PartnershipManagementMode,
  PartnershipStatus,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import { PartnershipService } from "./partnership.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

const mockNotifications = {
  createForUser: jest.fn().mockResolvedValue(undefined),
};

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: UserRole.CLUB,
  clubId: "club-1",
  clubName: null,
  firstName: "Alice",
  lastName: "Martin",
  birthDate: new Date("1990-01-01"),
  ageGroup: null,
  category: null,
  competitionLevel: null,
  passportLevelLatin: null,
  passportLevelStandard: null,
  email: "alice@example.com",
  ...overrides,
});

const makeClub = (overrides: Record<string, unknown> = {}) => ({
  id: "club-1",
  name: "Test Club",
  helloAssoClientId: null,
  helloAssoClientSecret: null,
  helloAssoOrgSlug: null,
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
  ...overrides,
});

const makePartnership = (overrides: Record<string, unknown> = {}) => ({
  id: "partnership-1",
  clubId: "club-1",
  secondaryClubId: null,
  user1Id: "user-a",
  user2Id: "user-b",
  startDate: new Date("2024-01-01"),
  endDate: null,
  status: PartnershipStatus.ACTIVE,
  managementMode: PartnershipManagementMode.PRIMARY_ONLY,
  club: { id: "club-1", name: "Test Club" },
  secondaryClub: null,
  user1: { id: "user-a", firstName: "Alice", lastName: "Martin" },
  user2: { id: "user-b", firstName: "Bob", lastName: "Dupont" },
  ...overrides,
});

describe("PartnershipService", () => {
  let service: PartnershipService;
  let prisma: MockPrisma;
  let clubsService: jest.Mocked<
    Pick<ClubsService, "getClubIdForOrganizer" | "findOrCreateByName">
  >;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = {
      getClubIdForOrganizer: jest.fn().mockResolvedValue("club-1"),
      findOrCreateByName: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PartnershipService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<PartnershipService>(PartnershipService);
    jest.clearAllMocks();
    mockNotifications.createForUser.mockResolvedValue(undefined);
    clubsService.getClubIdForOrganizer.mockResolvedValue("club-1");
  });

  // ----------------------------------------------------------------
  // createPartnership
  // ----------------------------------------------------------------
  describe("createPartnership", () => {
    const baseOrganizer = "organizer-1";

    it("throws BadRequestException when user1Id === user2Id", async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ clubId: "club-1" }) as never,
      );
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: "same-id",
          user2Id: "same-id",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when users do not belong to the club", async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ clubId: "other-club" }) as never)
        .mockResolvedValueOnce(makeUser({ clubId: "other-club" }) as never);
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: "user-a",
          user2Id: "user-b",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when active partnership already exists", async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({ id: "user-a", clubId: "club-1" }) as never,
        )
        .mockResolvedValueOnce(
          makeUser({ id: "user-b", clubId: "club-1" }) as never,
        );
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership() as never,
      );
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: "user-a",
          user2Id: "user-b",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates partnership with ACTIVE status for same-club couple", async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({ id: "user-a", clubId: "club-1" }) as never,
        )
        .mockResolvedValueOnce(
          makeUser({ id: "user-b", clubId: "club-1" }) as never,
        );
      prisma.partnership.findFirst.mockResolvedValue(null);
      prisma.partnership.create.mockResolvedValue(makePartnership() as never);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.createPartnership(baseOrganizer, {
        user1Id: "user-a",
        user2Id: "user-b",
      });

      expect(result.partnership).toBeDefined();
      expect(prisma.partnership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PartnershipStatus.ACTIVE }),
        }),
      );
    });

    it("creates partnership with PENDING_SECOND_CLUB status for inter-club couple", async () => {
      prisma.club.findUnique
        .mockResolvedValueOnce(makeClub() as never)
        .mockResolvedValueOnce({ id: "club-2", name: "Other Club" } as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({ id: "user-a", clubId: "club-1" }) as never,
        )
        .mockResolvedValueOnce(
          makeUser({ id: "user-b", clubId: "club-2" }) as never,
        );
      prisma.partnership.findFirst.mockResolvedValue(null);
      prisma.partnership.create.mockResolvedValue(
        makePartnership({
          secondaryClubId: "club-2",
          secondaryClub: { id: "club-2", name: "Other Club" },
          status: PartnershipStatus.PENDING_SECOND_CLUB,
        }) as never,
      );
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.createPartnership(baseOrganizer, {
        user1Id: "user-a",
        user2Id: "user-b",
        secondaryClubId: "club-2",
      });

      expect(result.partnership.status).toBe(
        PartnershipStatus.PENDING_SECOND_CLUB,
      );
    });

    it("throws BadRequestException when secondaryClubId equals the organizer's own clubId", async () => {
      prisma.club.findUnique.mockResolvedValue(makeClub() as never);
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({ id: "user-a", clubId: "club-1" }) as never,
        )
        .mockResolvedValueOnce(
          makeUser({ id: "user-b", clubId: "club-1" }) as never,
        );
      await expect(
        service.createPartnership(baseOrganizer, {
          user1Id: "user-a",
          user2Id: "user-b",
          secondaryClubId: "club-1",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ----------------------------------------------------------------
  // endPartnership
  // ----------------------------------------------------------------
  describe("endPartnership", () => {
    it("throws NotFoundException when partnership not found", async () => {
      prisma.partnership.findFirst.mockResolvedValue(null);
      await expect(
        service.endPartnership("organizer-1", "partnership-1", {
          endDate: "2024-06-01",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when club has no management rights", async () => {
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership({
          managementMode: PartnershipManagementMode.PRIMARY_ONLY,
          club: { id: "club-1", name: "Test Club" },
          secondaryClub: { id: "club-2", name: "Other Club" },
        }) as never,
      );
      clubsService.getClubIdForOrganizer.mockResolvedValue("club-2");
      await expect(
        service.endPartnership("organizer-2", "partnership-1", {
          endDate: "2024-06-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("ends partnership successfully when primary club has PRIMARY_ONLY rights", async () => {
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership({
          managementMode: PartnershipManagementMode.PRIMARY_ONLY,
          club: { id: "club-1", name: "Test Club" },
          secondaryClub: null,
        }) as never,
      );
      const ended = makePartnership({
        endDate: new Date("2024-06-01"),
        club: { id: "club-1", name: "Test Club" },
        secondaryClub: null,
      });
      prisma.partnership.update.mockResolvedValue(ended as never);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.endPartnership(
        "organizer-1",
        "partnership-1",
        { endDate: "2024-06-01" },
      );
      expect(result.endDate).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // endPartnership — additional branches
  // ----------------------------------------------------------------
  describe("endPartnership — additional", () => {
    it("ends partnership when secondary club has BOTH rights", async () => {
      prisma.partnership.findFirst.mockResolvedValue(
        makePartnership({
          managementMode: PartnershipManagementMode.BOTH,
          club: { id: "club-1", name: "Test Club" },
          secondaryClub: { id: "club-2", name: "Other Club" },
        }) as never,
      );
      clubsService.getClubIdForOrganizer.mockResolvedValue("club-2");
      const ended = makePartnership({
        endDate: new Date("2024-06-01"),
        club: { id: "club-1", name: "Test Club" },
        secondaryClub: { id: "club-2", name: "Other Club" },
      });
      prisma.partnership.update.mockResolvedValue(ended as never);
      prisma.user.findMany.mockResolvedValue([{ id: "org-1" }] as never);
      mockNotifications.createForUser.mockResolvedValue(undefined);

      const result = await service.endPartnership(
        "organizer-2",
        "partnership-1",
        { endDate: "2024-06-01" },
      );
      expect(result.endDate).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // validatePartnership
  // ----------------------------------------------------------------
  describe("validatePartnership", () => {
    it("throws NotFoundException when pending partnership not found", async () => {
      prisma.partnership.findFirst.mockResolvedValue(null);
      await expect(
        service.validatePartnership("organizer-1", "partnership-1", true),
      ).rejects.toThrow(NotFoundException);
    });

    it("sets status to ACTIVE when accepted=true", async () => {
      const pending = makePartnership({
        status: PartnershipStatus.PENDING_SECOND_CLUB,
        secondaryClubId: "club-1",
        secondaryClub: { id: "club-1", name: "Test Club" },
      });
      prisma.partnership.findFirst.mockResolvedValue(pending as never);
      prisma.partnership.update.mockResolvedValue(
        makePartnership({ status: PartnershipStatus.ACTIVE }) as never,
      );
      prisma.user.findMany.mockResolvedValue([]);
      const result = await service.validatePartnership(
        "organizer-1",
        "partnership-1",
        true,
      );
      expect(prisma.partnership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PartnershipStatus.ACTIVE },
        }),
      );
      expect(result.status).toBe(PartnershipStatus.ACTIVE);
    });

    it("sets status to REJECTED when accepted=false", async () => {
      const pending = makePartnership({
        status: PartnershipStatus.PENDING_SECOND_CLUB,
        secondaryClubId: "club-1",
        secondaryClub: { id: "club-1", name: "Test Club" },
      });
      prisma.partnership.findFirst.mockResolvedValue(pending as never);
      prisma.partnership.update.mockResolvedValue(
        makePartnership({ status: PartnershipStatus.REJECTED }) as never,
      );
      prisma.user.findMany.mockResolvedValue([]);
      const result = await service.validatePartnership(
        "organizer-1",
        "partnership-1",
        false,
      );
      expect(prisma.partnership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PartnershipStatus.REJECTED },
        }),
      );
      expect(result.status).toBe(PartnershipStatus.REJECTED);
    });
  });
});
