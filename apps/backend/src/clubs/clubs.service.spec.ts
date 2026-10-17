// apps/backend/src/clubs/clubs.service.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import {
  CLUB_ACCOUNT_UNRESOLVED_MESSAGES,
  ClubsService,
} from "./clubs.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

const clubAccount = (overrides: Record<string, unknown> = {}) =>
  ({
    role: UserRole.CLUB,
    extraRoles: [],
    clubId: null,
    clubName: null,
    club: null,
    ...overrides,
  }) as never;

describe("ClubsService", () => {
  let service: ClubsService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    const module = await Test.createTestingModule({
      providers: [ClubsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ClubsService>(ClubsService);
    jest.clearAllMocks();
  });

  describe("getClubIdForOrganizer", () => {
    it("throws NotFoundException when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getClubIdForOrganizer("unknown")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when user role is not CLUB", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubAccount({ role: UserRole.LICENSEE }),
      );
      await expect(service.getClubIdForOrganizer("user-1")).rejects.toThrow(
        "Only club role can manage club data",
      );
    });

    it("uses the caller's message for a non-club account", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubAccount({ role: UserRole.LICENSEE }),
      );
      await expect(
        service.getClubIdForOrganizer("user-1", "Only organizers can X"),
      ).rejects.toThrow("Only organizers can X");
    });

    it("accepts a licensee whose CLUB role is an extra role", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubAccount({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          clubId: "c1",
          clubName: "Club A",
          club: { disabledAt: null },
        }),
      );
      await expect(service.getClubIdForOrganizer("u1")).resolves.toBe("c1");
    });

    it("refuses an extra CLUB role while the club is disabled", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubAccount({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          clubId: "c1",
          clubName: "Club A",
          club: { disabledAt: new Date() },
        }),
      );
      await expect(service.getClubIdForOrganizer("u1")).rejects.toThrow(
        "Only club role can manage club data",
      );
    });

    it("returns the linked clubId without any name lookup", async () => {
      prisma.user.findUnique.mockResolvedValue(
        clubAccount({ clubId: "club-1", clubName: "Stale Name" }),
      );
      await expect(service.getClubIdForOrganizer("user-1")).resolves.toBe(
        "club-1",
      );
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });
  });

  describe("clubIdOfClubAccount — legacy account without clubId (#743)", () => {
    it("refuses an account without club name", async () => {
      await expect(
        service.clubIdOfClubAccount({ clubId: null, clubName: "  " }),
      ).rejects.toThrow(
        new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.noName),
      );
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("resolves the one active club its name designates (case, spaces ignored)", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
      prisma.club.findFirst.mockResolvedValue({ id: "club-1" } as never);
      await expect(
        service.clubIdOfClubAccount({ clubId: null, clubName: " CLUB a " }),
      ).resolves.toBe("club-1");
      expect(prisma.club.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { equals: "CLUB a", mode: "insensitive" } },
        }),
      );
      expect(prisma.club.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "club-1", disabledAt: null } }),
      );
    });

    it("refuses homonyms (two clubs sharing the name up to case)", async () => {
      prisma.club.findMany.mockResolvedValue([
        { id: "club-1" },
        { id: "club-2" },
      ] as never);
      await expect(
        service.clubIdOfClubAccount({ clubId: null, clubName: "Club A" }),
      ).rejects.toThrow(
        new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.ambiguous),
      );
    });

    it("refuses a disabled club", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
      prisma.club.findFirst.mockResolvedValue(null);
      await expect(
        service.clubIdOfClubAccount({ clubId: null, clubName: "Club A" }),
      ).rejects.toThrow(
        new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.disabled),
      );
    });

    it("refuses an unknown name and never creates a club", async () => {
      prisma.club.findMany.mockResolvedValue([] as never);
      await expect(
        service.clubIdOfClubAccount({ clubId: null, clubName: "Ghost Club" }),
      ).rejects.toThrow(
        new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.none),
      );
      expect(prisma.club.create).not.toHaveBeenCalled();
      expect(prisma.club.upsert).not.toHaveBeenCalled();
    });

    it("every refusal is a French sentence pointing to the federation", () => {
      for (const message of Object.values(CLUB_ACCOUNT_UNRESOLVED_MESSAGES)) {
        expect(message).toMatch(/Contactez la fédération/);
      }
    });
  });
});
