import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  Prisma,
  PrismaClient,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { CompetitionCacheService } from "../competitions/services/competition-cache.service";
import { PrismaService } from "../prisma/prisma.service";
import { withActiveRole } from "../auth/roles";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { WdsfService } from "../wdsf/wdsf.service";
import {
  AccountDeletionService,
  MAX_RENEWAL_DOCUMENTS_TO_PURGE,
} from "./account-deletion.service";
import { LicenseQrService } from "../licenses/qr/license-qr.service";
import { AppleWalletPassGenerator } from "../licenses/wallet/apple-wallet-pass.generator";
import { UsersService } from "./users.service";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  getRounds: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal user fixture with all WDSF fields set to null. */
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Dupont",
    role: UserRole.LICENSEE,
    category: null,
    ageGroup: null,
    competitionLevel: null,
    clubId: null,
    clubName: "Test Club",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    passportLevelLatin: null,
    passportLevelStandard: null,
    wdsfMin: null,
    wdsfNationality: null,
    wdsfLicenseType: null,
    wdsfAgeGroup: null,
    wdsfExpiresOn: null,
    wdsfFederation: null,
    birthDate: new Date("1995-06-15"),
    nationalRanking: null,
    license: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UsersService", () => {
  let service: UsersService;
  let prisma: MockProxy<PrismaClient>;
  let renewalDocumentFiles: { deleteFiles: jest.Mock };
  let healthAccess: { record: jest.Mock; recordOp: jest.Mock };
  let wdsfService: { getAthleteByMin: jest.Mock };

  beforeEach(async () => {
    wdsfService = {
      getAthleteByMin: jest
        .fn()
        .mockResolvedValue({ firstName: "Alice", lastName: "Dupont" }),
    };
    prisma = mockDeep<PrismaClient>();
    renewalDocumentFiles = {
      deleteFiles: jest.fn().mockResolvedValue(new Set()),
    };
    healthAccess = {
      record: jest.fn().mockResolvedValue(undefined),
      recordOp: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: LicenseQrService,
          useValue: {
            buildQrCode: (license: { number: string }) =>
              `signed:${license.number}`,
          },
        },
        {
          provide: AppleWalletPassGenerator,
          useValue: { isAvailable: () => true },
        },
        {
          provide: RenewalDocumentFileCleaner,
          useValue: renewalDocumentFiles,
        },
        { provide: WdsfService, useValue: wdsfService },
        { provide: HealthDataAccessLogService, useValue: healthAccess },
        // No pseudonymisation key outside production: development key (#652).
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: CompetitionCacheService,
          useValue: {
            invalidateResults: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // findOne  (getProfile equivalent)
  // -------------------------------------------------------------------------

  describe("findOne", () => {
    it("throws NotFoundException when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne("unknown-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException with message 'User not found'", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne("unknown-id")).rejects.toThrow(
        "User not found",
      );
    });

    it("selects the user's own extraRoles", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.findOne("u1");

      expect(prisma.user.findUnique.mock.calls[0][0]?.select).toHaveProperty(
        "extraRoles",
        true,
      );
    });

    it("returns user data including the id and email", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.findOne("u1");

      expect(result.id).toBe("u1");
      expect(result.email).toBe("alice@example.com");
    });

    it("adds the signed QR content to the license (#168)", async () => {
      const license = {
        id: "l1",
        number: "FFD-1",
        validUntil: new Date("2026-08-31T00:00:00.000Z"),
      };
      prisma.user.findUnique.mockResolvedValue(makeUser({ license }));

      const result = await service.findOne("u1");

      expect(result.license).toEqual({
        ...license,
        qrCode: "signed:FFD-1",
        appleWalletAvailable: true,
      });
    });

    it("keeps license null when the user has none", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.findOne("u1");

      expect(result.license).toBeNull();
    });

    it("adds roles next to role without leaking the club status", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...makeUser(),
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        club: { disabledAt: null },
      });

      const result = (await service.findOne("u1")) as Record<string, unknown>;

      expect(result).toMatchObject({
        role: UserRole.LICENSEE,
        roles: [UserRole.LICENSEE, UserRole.CLUB],
      });
      expect(result.club).toBeUndefined();
    });

    it("never returns a password field", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = (await service.findOne("u1")) as Record<string, unknown>;

      expect(result.password).toBeUndefined();
    });

    it("sets wdsf to null when wdsfMin is blank", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ wdsfMin: null }));

      const result = await service.findOne("u1");

      expect(result.wdsf).toBeNull();
    });

    it("builds wdsf object when wdsfMin is populated", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          wdsfMin: "12345",
          wdsfNationality: "FRA",
          wdsfLicenseType: "PROFESSIONAL",
          wdsfAgeGroup: "ADULTE",
          wdsfExpiresOn: new Date("2025-12-31"),
        }),
      );

      const result = await service.findOne("u1");

      expect(result.wdsf).not.toBeNull();
      expect(result.wdsf?.min).toBe("12345");
      expect(result.wdsf?.nationality).toBe("FRA");
    });

    it("returns the stored national federation of the WDSF license", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          wdsfMin: "12345",
          wdsfNationality: "Germany",
          wdsfFederation: "DTV",
        }),
      );

      const result = await service.findOne("u1");

      expect(result.wdsf?.federation).toBe("DTV");
    });

    it("derives the FFD for a French WDSF license linked before the federation was stored", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ wdsfMin: "12345", wdsfNationality: "France" }),
      );

      const result = await service.findOne("u1");

      expect(result.wdsf?.federation).toBe(
        "FFD - Fédération Française de Danse",
      );
    });

    it("never reports WDSF as the federation when it is unknown", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ wdsfMin: "12345", wdsfNationality: "Germany" }),
      );

      const result = await service.findOne("u1");

      expect(result.wdsf?.federation).toBeNull();
    });

    it("passes the correct select shape to prisma", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.findOne("u1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u1" },
          select: expect.objectContaining({
            id: true,
            email: true,
            license: expect.any(Object),
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findClubMembers  (getMembers equivalent)
  // -------------------------------------------------------------------------

  describe("findClubMembers", () => {
    it("throws NotFoundException when the organizer does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findClubMembers("org-missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when the organizer's role is not CLUB", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.LICENSEE,
        clubId: null,
        clubName: "Club",
      });

      await expect(service.findClubMembers("org1")).rejects.toThrow(
        "Organizer not found or invalid role",
      );
    });

    it("accepts a licensee whose CLUB role is an extra role", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        clubId: "c1",
        clubName: "DanceClub",
        club: { disabledAt: null },
      });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([] as never);

      const result = await service.findClubMembers("org1");

      expect(result.data).toEqual([]);
    });

    it("refuses an extra CLUB role while the club is disabled", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        clubId: "c1",
        clubName: null,
        club: { disabledAt: new Date() },
      });

      await expect(service.findClubMembers("org1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when the organizer has no club assigned", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: null,
        clubName: null,
      });

      await expect(service.findClubMembers("org1")).rejects.toThrow(
        "Organizer has no club assigned",
      );
    });

    it("returns a paginated list of club members", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "c1",
        clubName: "DanceClub",
      });

      const members = [
        makeUser({ id: "m1", firstName: "Bob", registrations: [] }),
        makeUser({ id: "m2", firstName: "Carol", registrations: [] }),
      ];

      // findMany and count are called in parallel via Promise.all
      prisma.user.count.mockResolvedValue(2);
      prisma.user.findMany.mockResolvedValue(members);

      const result = await service.findClubMembers("org1");

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it("never selects the members' extraRoles (data minimisation)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "c1",
        clubName: "DanceClub",
      });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      await service.findClubMembers("org1");

      const select = prisma.user.findMany.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      expect(select).not.toHaveProperty("extraRoles");
      expect(select).toHaveProperty("role", true);
    });

    it("scopes a legacy account (no clubId) to the one active club its name designates (#749)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: null,
        clubName: " DanceClub ",
      });
      prisma.club.findMany.mockResolvedValue([{ id: "club-7" }] as never);
      prisma.club.findFirst.mockResolvedValue({ id: "club-7" });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([] as never);

      await service.findClubMembers("org1");

      expect(prisma.club.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "club-7", disabledAt: null },
        }),
      );
      const expectedWhere = {
        AND: [
          {
            OR: [
              { clubId: "club-7" },
              {
                clubId: null,
                clubName: { equals: "DanceClub", mode: "insensitive" },
              },
            ],
          },
          withActiveRole(UserRole.LICENSEE),
        ],
      };
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it("lists nobody for a legacy account whose name designates homonym clubs (#749)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: null,
        clubName: "DanceClub",
      });
      // « DanceClub » and « danceclub »: the name designates two clubs.
      prisma.club.findMany.mockResolvedValue([
        { id: "club-7" },
        { id: "club-8" },
      ] as never);

      const result = await service.findClubMembers("org1", {
        skip: 0,
        take: 10,
      });

      expect(result).toEqual({
        data: [],
        meta: { total: 0, skip: 0, take: 10, hasMore: false },
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it("lists nobody for a legacy account whose club is disabled (#749)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: null,
        clubName: "DanceClub",
      });
      prisma.club.findMany.mockResolvedValue([{ id: "club-7" }] as never);
      prisma.club.findFirst.mockResolvedValue(null);

      const result = await service.findClubMembers("org1");

      expect(result.data).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it("scopes the query to the organizer's club by clubId when available", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "club-42",
        clubName: "DanceClub",
      });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([] as never);

      await service.findClubMembers("org1");

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ clubId: "club-42" }, withActiveRole(UserRole.LICENSEE)],
          },
        }),
      );
      // A linked account is its club: no name lookup at all.
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("computes the most frequent partnerName from active registrations", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "c1",
        clubName: "DanceClub",
      });

      const memberWithRegistrations = makeUser({
        id: "m1",
        registrations: [
          {
            id: "r1",
            partnerName: "Bob",
            status: RegistrationStatus.CONFIRMED,
          },
          {
            id: "r2",
            partnerName: "Bob",
            status: RegistrationStatus.CONFIRMED,
          },
          {
            id: "r3",
            partnerName: "Charlie",
            status: RegistrationStatus.PENDING,
          },
        ],
      });

      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        memberWithRegistrations,
      ] as never);

      const result = await service.findClubMembers("org1");

      expect(result.data[0].partnerName).toBe("Bob");
    });

    it("leaves partnerName undefined when the member has no registrations", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "c1",
        clubName: "DanceClub",
      });

      const memberWithNoRegistrations = makeUser({
        id: "m1",
        registrations: [],
      });

      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        memberWithNoRegistrations,
      ] as never);

      const result = await service.findClubMembers("org1");

      expect(result.data[0].partnerName).toBeUndefined();
    });

    it("strips the registrations array from each returned member", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "c1",
        clubName: "DanceClub",
      });

      const member = makeUser({
        id: "m1",
        registrations: [{ id: "r1", partnerName: "Bob" }],
      });

      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([member] as never);

      const result = await service.findClubMembers("org1");

      expect(
        (result.data[0] as Record<string, unknown>).registrations,
      ).toBeUndefined();
    });

    it("forwards pagination skip/take to prisma.user.findMany", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: "c1",
        clubName: "DanceClub",
      });
      prisma.user.count.mockResolvedValue(30);
      prisma.user.findMany.mockResolvedValue([] as never);

      const pagination = { skip: 10, take: 5 };
      await service.findClubMembers("org1", pagination);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateWdsf
  // -------------------------------------------------------------------------

  describe("updateWdsf", () => {
    it("clears all WDSF fields when data is null", async () => {
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.updateWdsf("u1", null);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u1" },
          data: expect.objectContaining({ wdsfMin: null }),
        }),
      );
    });

    it("stores trimmed MIN and related fields when data is provided", async () => {
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUnique.mockResolvedValue(makeUser({ wdsfMin: "12345" }));

      await service.updateWdsf("u1", {
        min: "  12345  ",
        nationality: "FRA",
        licenseType: "PROFESSIONAL",
        ageGroup: "ADULTE",
        expiresOn: "2025-12-31",
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wdsfMin: "12345" }),
        }),
      );
    });

    it("throws when expiresOn is an invalid date string", async () => {
      await expect(
        service.updateWdsf("u1", {
          min: "12345",
          expiresOn: "not-a-date",
        }),
      ).rejects.toThrow("Invalid wdsf.expiresOn date");
    });

    it("re-fetches the MIN from WDSF and links it when the name matches in reverse order", async () => {
      wdsfService.getAthleteByMin.mockResolvedValue({
        firstName: "Dupont",
        lastName: "Alice",
      });
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.updateWdsf("u1", { min: " 12345 " });

      expect(wdsfService.getAthleteByMin).toHaveBeenCalledWith("12345");
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it("stores the national federation read from WDSF, not from the client", async () => {
      wdsfService.getAthleteByMin.mockResolvedValue({
        firstName: "Alice",
        lastName: "Dupont",
        structure: "FFD - Fédération Française de Danse",
      });
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.updateWdsf("u1", { min: "12345" });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            wdsfFederation: "FFD - Fédération Française de Danse",
          }),
        }),
      );
    });

    it("stores no federation when WDSF does not know it", async () => {
      wdsfService.getAthleteByMin.mockResolvedValue({
        firstName: "Alice",
        lastName: "Dupont",
        structure: "",
      });
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.updateWdsf("u1", { min: "12345" });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wdsfFederation: null }),
        }),
      );
    });

    it("rejects a MIN whose WDSF holder is not the account holder", async () => {
      wdsfService.getAthleteByMin.mockResolvedValue({
        firstName: "Bob",
        lastName: "Martin",
      });
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.updateWdsf("u1", { min: "12345" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("throws NotFound when the account does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateWdsf("u1", { min: "12345" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(wdsfService.getAthleteByMin).not.toHaveBeenCalled();
    });

    it("does not call WDSF when unlinking", async () => {
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.updateWdsf("u1", null);

      expect(wdsfService.getAthleteByMin).not.toHaveBeenCalled();
    });

    it("returns the updated user profile after persisting changes", async () => {
      const updated = makeUser({ wdsfMin: "12345" });
      prisma.user.update.mockResolvedValue(updated);
      prisma.user.findUnique.mockResolvedValue(updated);

      const result = await service.updateWdsf("u1", {
        min: "12345",
        nationality: null,
      });

      expect(result.id).toBe("u1");
    });
  });

  // -------------------------------------------------------------------------
  // updateAgeGroupFromBirthDate
  // -------------------------------------------------------------------------

  describe("updateAgeGroupFromBirthDate", () => {
    it("returns null when the user has no birthDate", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: null });

      const result = await service.updateAgeGroupFromBirthDate("u1");

      expect(result).toBeNull();
    });

    it("returns null when the user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.updateAgeGroupFromBirthDate("u1");

      expect(result).toBeNull();
    });

    it("updates the user's ageGroup field derived from birthDate", async () => {
      // Born 2009 → likely JUNIOR for the current year
      prisma.user.findUnique.mockResolvedValue({
        birthDate: new Date("2009-03-01"),
      });
      prisma.user.update.mockResolvedValue(makeUser());

      const result = await service.updateAgeGroupFromBirthDate("u1", 2026);

      // The method delegates computation to computeSoloAgeGroup; we only
      // assert it returns a non-null string and calls prisma.user.update.
      expect(typeof result).toBe("string");
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u1" },
          data: expect.objectContaining({ ageGroup: result }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // exportMyData (RGPD art. 20 — portabilité)
  // -------------------------------------------------------------------------

  describe("exportMyData", () => {
    /** Utilisateur tel que le renvoie le select de l'export (relations mappées). */
    const makeExportedUser = (overrides: Record<string, unknown> = {}) =>
      makeUser({
        trackCorrectionsProposed: [],
        licenseRenewalRequests: [],
        submittedTracks: [],
        ...overrides,
      });

    beforeEach(() => {
      prisma.result.findMany.mockResolvedValue([]);
      prisma.bugReport.findMany.mockResolvedValue([]);
      prisma.impersonationLog.findMany.mockResolvedValue([]);
      prisma.healthDataAccessLog.findMany.mockResolvedValue([]);
    });

    const exportSelect = () =>
      prisma.user.findUnique.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;

    it("retourne les données enveloppées avec format et date d'export", async () => {
      const exported = makeExportedUser({
        registrations: [],
        partnershipsAsUser1: [],
        partnershipsAsUser2: [],
        notifications: [],
        soloTeamMemberships: [],
        seatBookings: [],
      });
      prisma.user.findUnique.mockResolvedValue(exported);

      const result = await service.exportMyData("u1");

      expect(result.format).toBe("ffd-connect-export-v1");
      expect(typeof result.exportedAt).toBe("string");
      expect(result.data).toEqual({
        ...exported,
        results: [],
        bugReports: [],
        impersonationsReceived: [],
        healthDataAccesses: [],
      });
    });

    it("exporte les rôles supplémentaires de l'utilisateur", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      expect(prisma.user.findUnique.mock.calls[0][0]?.select).toHaveProperty(
        "extraRoles",
        true,
      );
    });

    it("ne sélectionne jamais le mot de passe ni les tokens", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const select = prisma.user.findUnique.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      expect(select.password).toBeUndefined();
      expect(select.passwordResetTokens).toBeUndefined();
      expect(select.walletPassDownloadTokens).toBeUndefined();
      // Les données personnelles clés sont bien exportées
      expect(select.email).toBe(true);
      expect(select.birthDate).toBe(true);
    });

    it("exporte les appareils push en métadonnées, jamais la valeur du token", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const select = prisma.user.findUnique.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      const deviceTokens = select.deviceTokens as {
        select: Record<string, unknown>;
        take: number;
      };
      // Un token FCM est un identifiant d'appareil, donc une donnée
      // personnelle (art. 15) : elle doit apparaître dans l'export.
      expect(deviceTokens.select).toEqual({
        platform: true,
        createdAt: true,
        lastSeenAt: true,
      });
      // Mais pas sa valeur : quiconque connaît un token peut le ré-attribuer à
      // son compte via POST /notifications/device-token (upsert ré-attributif).
      expect(deviceTokens.select.token).toBeUndefined();
      expect(deviceTokens.take).toBe(50);
    });

    it("exporte les préférences de notification réellement enregistrées", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const select = prisma.user.findUnique.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      const prefs = select.notificationPrefs as {
        select: Record<string, unknown>;
        take: number;
      };
      // Un réglage de notification est une donnée personnelle (art. 15). Seuls
      // les choix explicites existent en base : l'absence de ligne signifie
      // « défaut du catalogue », l'export n'a donc rien à inventer.
      expect(prefs.select).toEqual({
        type: true,
        enabled: true,
        updatedAt: true,
      });
      expect(prefs.take).toBe(50);
    });

    it("exporte les propositions de correction, sans l'identité du relecteur", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const select = prisma.user.findUnique.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      const corrections = select.trackCorrectionsProposed as {
        select: Record<string, unknown>;
        take: number;
      };
      expect(corrections.select).toEqual(
        expect.objectContaining({ message: true, status: true }),
      );
      expect(corrections.select.reviewedBy).toBeUndefined();
      expect(corrections.select.reviewedById).toBeUndefined();
      expect(corrections.take).toBe(500);
    });

    it("masque le nom des pistes blacklistées visées par ses propositions", async () => {
      const correction = (track: Record<string, unknown>) => ({
        reason: "TITLE",
        message: null,
        status: "PENDING",
        track,
      });
      prisma.user.findUnique.mockResolvedValue(
        makeExportedUser({
          trackCorrectionsProposed: [
            correction({
              title: "Retirée",
              artist: "Secret",
              blacklisted: true,
            }),
            correction({
              title: "Public",
              artist: "Artiste",
              blacklisted: false,
            }),
          ],
        }),
      );

      const result = await service.exportMyData("u1");

      const tracks = (
        result.data.trackCorrectionsProposed as Array<{ track: unknown }>
      ).map((c) => c.track);
      expect(tracks).toEqual([
        { title: "Musique retirée", artist: "" },
        { title: "Public", artist: "Artiste" },
      ]);
      expect(JSON.stringify(result)).not.toContain("Retirée");
      expect(JSON.stringify(result)).not.toContain("Secret");
    });

    it("sélectionne les demandes de renouvellement bornées, sans référence de fichier", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const renewals = exportSelect().licenseRenewalRequests as {
        select: {
          status: boolean;
          documents: { select: Record<string, unknown> };
        };
        take: number;
      };
      expect(renewals.take).toBe(100);
      expect(renewals.select.status).toBe(true);
      // Modération humaine (#266) : la décision et sa date sont exportées,
      // jamais l'identité de l'administrateur.
      expect(renewals.select).toEqual(
        expect.objectContaining({
          submittedAt: true,
          reviewedAt: true,
          rejectionReason: true,
          reviewComment: true,
        }),
      );
      expect(
        (renewals.select as Record<string, unknown>).reviewedById,
      ).toBeUndefined();
      expect(
        (renewals.select as Record<string, unknown>).reviewedBy,
      ).toBeUndefined();
      expect(renewals.select.documents.select).toEqual({
        // Read for the health-data access journal (#63), never exported.
        id: true,
        type: true,
        ocrData: true,
        createdAt: true,
      });
      // La référence de stockage (nom de blob / chemin) reste interne.
      expect(renewals.select.documents.select.filePath).toBeUndefined();
      expect(renewals.select.documents.select.purgeDueAt).toBeUndefined();
    });

    it("exporte les demandes de renouvellement avec les seules données OCR de la liste blanche", async () => {
      const submittedAt = new Date("2026-09-01T10:00:00Z");
      prisma.user.findUnique.mockResolvedValue(
        makeExportedUser({
          licenseRenewalRequests: [
            {
              status: "PENDING",
              createdAt: submittedAt,
              updatedAt: submittedAt,
              documents: [
                {
                  id: "med-1",
                  type: "MEDICAL_CERTIFICATE",
                  createdAt: submittedAt,
                  ocrData: {
                    isApte: true,
                    date: "2026-08-20",
                    doctorName: "Dr Martin",
                    rawText: "Certificat : asthme sévère, traitement en cours",
                  },
                },
                {
                  id: "lic-1",
                  type: "LICENSE_CERTIFICATE",
                  createdAt: submittedAt,
                  ocrData: {
                    licenseNumber: "12345",
                    expiryDate: "2027-08-31",
                    rawText: "texte brut",
                  },
                },
                {
                  type: "LICENSE_CERTIFICATE",
                  createdAt: submittedAt,
                  ocrData: null,
                },
              ],
            },
          ],
        }),
      );

      const result = await service.exportMyData("u1");

      expect(result.data.licenseRenewalRequests).toEqual([
        {
          status: "PENDING",
          createdAt: submittedAt,
          updatedAt: submittedAt,
          documents: [
            {
              type: "MEDICAL_CERTIFICATE",
              createdAt: submittedAt,
              ocrData: {
                isApte: true,
                date: "2026-08-20",
                doctorName: "Dr Martin",
              },
            },
            {
              type: "LICENSE_CERTIFICATE",
              createdAt: submittedAt,
              ocrData: { licenseNumber: "12345", expiryDate: "2027-08-31" },
            },
            {
              type: "LICENSE_CERTIFICATE",
              createdAt: submittedAt,
              ocrData: null,
            },
          ],
        },
      ]);
      const json = JSON.stringify(result);
      expect(json).not.toContain("rawText");
      expect(json).not.toContain("asthme");
      // The document ids are not exported, only journaled (#63)…
      expect(json).not.toContain("med-1");
      // …one EXPORT row per medical certificate, before the export leaves.
      expect(healthAccess.record).toHaveBeenCalledWith([
        {
          subjectUserId: "u1",
          actorUserId: "u1",
          actorRole: "OWNER",
          action: "EXPORT",
          resourceType: "MEDICAL_CERTIFICATE",
          resourceId: "med-1",
          route: "GET /users/me/export",
        },
      ]);
    });

    it("ne sort jamais la référence de fichier d'un document, même si la base la renvoie", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeExportedUser({
          licenseRenewalRequests: [
            {
              status: "DRAFT",
              createdAt: new Date(),
              updatedAt: new Date(),
              documents: [
                {
                  type: "MEDICAL_CERTIFICATE",
                  createdAt: new Date(),
                  ocrData: {},
                  filePath: "renewals/u1/secret-blob.pdf",
                },
              ],
            },
          ],
        }),
      );

      const result = await service.exportMyData("u1");

      expect(JSON.stringify(result)).not.toContain("secret-blob");
    });

    it("exporte les équipes solo, les réservations de places et le profil complet", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const select = exportSelect();
      expect(select.nationalRanking).toBe(true);
      expect(select.lastLoginAt).toBe(true);
      const teams = select.soloTeamMemberships as {
        select: Record<string, unknown>;
        take: number;
      };
      expect(teams.select).toEqual({
        createdAt: true,
        team: { select: { name: true, level: true } },
      });
      expect(teams.take).toBe(100);
      const seats = select.seatBookings as {
        select: Record<string, unknown>;
        take: number;
      };
      expect(seats.select).toEqual({
        seatLabel: true,
        status: true,
        cancelReason: true,
        createdAt: true,
        competition: { select: { title: true, date: true } },
      });
      // Référence de paiement externe et identifiant interne : jamais exportés.
      expect(seats.select.paymentId).toBeUndefined();
      expect(seats.select.itemId).toBeUndefined();
      expect(seats.take).toBe(500);
    });

    it("rejette en NotFound si l'utilisateur n'existe pas", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.exportMyData("ghost")).rejects.toThrow(
        NotFoundException,
      );
      // Aucune requête annexe pour un compte inexistant.
      expect(prisma.result.findMany).not.toHaveBeenCalled();
    });

    // --- #251 : données personnelles manquantes ---------------------------

    it("exporte la date de désactivation du compte", async () => {
      const disabledAt = new Date("2026-09-01T08:00:00Z");
      prisma.user.findUnique.mockResolvedValue(
        makeExportedUser({ disabledAt }),
      );

      const result = await service.exportMyData("u1");

      expect(exportSelect().disabledAt).toBe(true);
      expect(result.data.disabledAt).toBe(disabledAt);
    });

    it("exporte les résultats de compétition avec le contexte, sans le libellé du couple", async () => {
      const event = (title: string) => ({
        category: "Latin",
        ageGroup: "Adulte",
        level: null,
        eventType: "COUPLE",
        competition: { title, date: new Date("2026-05-01") },
      });
      prisma.result.findMany.mockResolvedValue([
        {
          round: "Finale",
          ranking: 2,
          createdAt: new Date("2026-05-01"),
          details: {
            participant: "Alice Dupont / Bob Martin",
            totalParticipants: 12,
          },
          event: event("Open de Lyon"),
        },
        {
          round: "1/2",
          ranking: 7,
          createdAt: new Date("2026-04-01"),
          details: null,
          event: event("Open de Nice"),
        },
        {
          round: "Finale",
          ranking: 1,
          createdAt: new Date("2026-03-01"),
          details: ["inattendu"],
          event: event("Open de Metz"),
        },
        {
          round: "Finale",
          ranking: 3,
          createdAt: new Date("2026-02-01"),
          details: { totalParticipants: "douze" },
          event: event("Open de Lille"),
        },
      ] as never);
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      const result = await service.exportMyData("u1");

      const query = prisma.result.findMany.mock.calls[0][0];
      expect(query?.where).toEqual({
        OR: [{ userId: "u1" }, { partnerUserId: "u1" }],
      });
      expect(query?.take).toBe(1000);
      expect(query?.select).toEqual(
        expect.objectContaining({ round: true, ranking: true }),
      );
      const results = result.data.results;
      expect(results.map((r) => r.totalParticipants)).toEqual([
        12,
        null,
        null,
        null,
      ]);
      expect(results[0]).toEqual({
        round: "Finale",
        ranking: 2,
        createdAt: new Date("2026-05-01"),
        totalParticipants: 12,
        event: event("Open de Lyon"),
      });
      // Le libellé `participant` nomme le partenaire : jamais exporté.
      expect(JSON.stringify(result)).not.toContain("Bob Martin");
    });

    it("exporte les inscriptions en tant que partenaire, sans les données du licencié principal", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const asPartner = exportSelect().registrationsAsPartner as {
        select: Record<string, unknown>;
        take: number;
      };
      expect(asPartner.take).toBe(500);
      expect(asPartner.select).toEqual(
        expect.objectContaining({
          status: true,
          createdAt: true,
          event: {
            select: expect.objectContaining({
              competition: { select: { title: true, date: true } },
            }),
          },
        }),
      );
      // Identité et paiement du licencié qui a inscrit le couple : tiers.
      for (const field of [
        "user",
        "userId",
        "partnerName",
        "partnerUserId",
        "feePaid",
      ]) {
        expect(asPartner.select[field]).toBeUndefined();
      }
    });

    it("exporte les musiques proposées en masquant le nom des pistes blacklistées", async () => {
      const createdAt = new Date("2026-06-01");
      const track = (title: string, blacklisted: boolean) => ({
        title,
        artist: "Artiste",
        blacklisted,
        status: "READY",
        createdAt,
      });
      prisma.user.findUnique.mockResolvedValue(
        makeExportedUser({
          submittedTracks: [
            track("Ma rumba", false),
            track("Titre retire", true),
          ],
        }),
      );

      const result = await service.exportMyData("u1");

      const tracks = exportSelect().submittedTracks as {
        select: Record<string, unknown>;
        take: number;
      };
      expect(tracks.take).toBe(500);
      // Fichier et clé de source : internes.
      expect(tracks.select.filename).toBeUndefined();
      expect(tracks.select.sourceKey).toBeUndefined();
      expect(result.data.submittedTracks).toEqual([
        { title: "Ma rumba", artist: "Artiste", status: "READY", createdAt },
        {
          title: "Musique retirée",
          artist: "",
          status: "READY",
          createdAt,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain("Titre retire");
    });

    it("exporte les signalements envoyés, sans la pile d'erreur", async () => {
      const report = {
        message: "[BUG] crash",
        deviceInfo: "iPhone 15 / iOS 26",
        createdAt: new Date("2026-07-01"),
      };
      prisma.bugReport.findMany.mockResolvedValue([report] as never);
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      const result = await service.exportMyData("u1");

      const query = prisma.bugReport.findMany.mock.calls[0][0];
      expect(query?.where).toEqual({ userId: "u1" });
      expect(query?.take).toBe(200);
      expect(query?.select).toEqual({
        message: true,
        deviceInfo: true,
        createdAt: true,
      });
      expect(result.data.bugReports).toEqual([report]);
    });

    it("exporte les impersonations reçues avec le seul rôle de l'auteur", async () => {
      const session = {
        actorRole: UserRole.STAFF,
        reason: "Support",
        startedAt: new Date("2026-08-01T10:00:00Z"),
        endedAt: null,
      };
      prisma.impersonationLog.findMany.mockResolvedValue([session] as never);
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      const result = await service.exportMyData("u1");

      const query = prisma.impersonationLog.findMany.mock.calls[0][0];
      expect(query?.where).toEqual({ targetUserId: "u1" });
      expect(query?.take).toBe(200);
      const select = query?.select as Record<string, unknown>;
      expect(select).toEqual({
        actorRole: true,
        reason: true,
        startedAt: true,
        endedAt: true,
      });
      // Identité et IP de l'administrateur : données d'un tiers.
      expect(select.actorId).toBeUndefined();
      expect(select.ip).toBeUndefined();
      expect(result.data.impersonationsReceived).toEqual([session]);
    });

    it("exporte les accès à ses données de santé avec la seule qualité de l'auteur (#732)", async () => {
      const access = {
        actorRole: "IMPERSONATOR",
        action: "READ",
        resourceType: "LICENSE_RENEWAL_REQUEST",
        route: "GET /licenses/renewal/my",
        createdAt: new Date("2026-09-01T10:00:00Z"),
      };
      prisma.healthDataAccessLog.findMany.mockResolvedValue([access] as never);
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      const result = await service.exportMyData("u1");

      const query = prisma.healthDataAccessLog.findMany.mock.calls[0][0];
      expect(query?.where).toEqual({ subjectUserId: "u1" });
      expect(query?.orderBy).toEqual({ createdAt: "desc" });
      expect(query?.take).toBe(500);
      const select = query?.select as Record<string, unknown>;
      expect(select).toEqual({
        actorRole: true,
        action: true,
        resourceType: true,
        route: true,
        createdAt: true,
      });
      // Identité de l'auteur : donnée d'un tiers ; UUID internes : inutiles.
      expect(select.actorUserId).toBeUndefined();
      expect(select.id).toBeUndefined();
      expect(select.resourceId).toBeUndefined();
      expect(result.data.healthDataAccesses).toEqual([access]);
    });

    it("lit le journal des accès de santé avant d'y tracer l'export en cours (#732)", async () => {
      const order: string[] = [];
      prisma.healthDataAccessLog.findMany.mockImplementation(() => {
        order.push("read");
        return Promise.resolve([]);
      });
      healthAccess.record.mockImplementation(() => {
        order.push("record");
        return Promise.resolve();
      });
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      expect(order).toEqual(["read", "record"]);
    });

    it("exporte les sessions de connexion en métadonnées, jamais le hash du token", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      const sessions = exportSelect().refreshTokens as {
        select: Record<string, unknown>;
        take: number;
      };
      expect(sessions.select).toEqual({
        createdAt: true,
        expiresAt: true,
        revoked: true,
        revokedAt: true,
      });
      expect(sessions.select.token).toBeUndefined();
      expect(sessions.take).toBe(100);
    });

    it("n'exporte pas le journal d'audit admin (traçabilité, données de tiers)", async () => {
      prisma.user.findUnique.mockResolvedValue(makeExportedUser());

      await service.exportMyData("u1");

      expect(exportSelect().adminAuditActions).toBeUndefined();
      expect(prisma.adminAuditLog.findMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // deleteMyAccount (RGPD art. 17 — droit à l'oubli, Apple 5.1.1(v))
  // -------------------------------------------------------------------------

  describe("deleteMyAccount", () => {
    const compare = bcrypt.compare as jest.Mock;

    beforeEach(() => {
      compare.mockReset();
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        password: "$2b$12$hash",
      });
      prisma.$transaction.mockResolvedValue([] as never);
      prisma.licenseRenewalDocument.findMany.mockResolvedValue([]);
      // Partner-name scrub (#395): no couple to look up.
      prisma.registration.findMany.mockResolvedValue([]);
      prisma.result.findMany.mockResolvedValue([]);
      // Notification name scrub (#423): nothing links here.
      prisma.partnership.findMany.mockResolvedValue([]);
      prisma.notification.findMany.mockResolvedValue([]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function withDocuments(...filePaths: string[]) {
      prisma.licenseRenewalDocument.findMany.mockResolvedValue(
        filePaths.map((filePath) => ({ filePath })),
      );
    }

    it("supprime le compte et les données à FK restrictive en transaction", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(compare).toHaveBeenCalledWith("correct-password", "$2b$12$hash");
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
      });
      expect(prisma.seatBooking.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
      });
      expect(prisma.registration.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: "u1" },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("anonymise les inscriptions d'autrui où l'utilisateur est partenaire (id ET nom copié)", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(prisma.registration.updateMany).toHaveBeenCalledWith({
        where: { partnerUserId: "u1" },
        data: { partnerUserId: null, partnerName: null },
      });
    });

    it("efface le commentaire libre de ses propositions de correction (le SetNull ne suffit pas)", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(prisma.trackCorrection.updateMany).toHaveBeenCalledWith({
        where: { proposedById: "u1" },
        data: { message: null },
      });
    });

    it("supprime les bug reports de l'utilisateur (userId sans FK)", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(prisma.bugReport.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
      });
    });

    it("anonymises admin audit rows that target the deleted user instead of deleting them", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(prisma.adminAuditLog.deleteMany).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.updateMany).toHaveBeenCalledWith({
        where: { targetType: "USER", targetId: "u1" },
        data: { before: Prisma.DbNull, after: Prisma.DbNull },
      });
    });

    it("toutes les écritures sont dans la même transaction, suppression du user en dernier", async () => {
      compare.mockResolvedValue(true);
      const marker = (name: string) => ({ op: name }) as never;
      prisma.result.updateMany.mockReturnValue(marker("resultAnon"));
      prisma.notification.deleteMany.mockReturnValue(marker("notifications"));
      prisma.seatBooking.deleteMany.mockReturnValue(marker("seatBookings"));
      prisma.registration.deleteMany.mockReturnValue(marker("registrations"));
      prisma.registration.updateMany.mockReturnValue(marker("partnerAnon"));
      prisma.trackCorrection.updateMany.mockReturnValue(
        marker("trackCorrectionAnon"),
      );
      prisma.bugReport.deleteMany.mockReturnValue(marker("bugReports"));
      prisma.adminAuditLog.updateMany.mockReturnValue(marker("adminAudit"));
      prisma.user.delete.mockReturnValue(marker("user"));

      await service.deleteMyAccount("u1", "correct-password");

      const ops = (
        prisma.$transaction.mock.calls[0][0] as unknown as Array<{
          op: string;
        }>
      ).map((o) => o.op);
      expect(ops).toEqual([
        "resultAnon",
        "notifications",
        "seatBookings",
        "registrations",
        "partnerAnon",
        // Imported results' second-member link (#652).
        "resultAnon",
        "trackCorrectionAnon",
        "bugReports",
        "adminAudit",
        "user",
      ]);
    });

    it("lit les références des documents de renouvellement avant la transaction (select partagé, borné)", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(prisma.licenseRenewalDocument.findMany).toHaveBeenCalledWith({
        where: { request: { userId: "u1" } },
        // id + type: the deletion of each medical certificate is journaled (#63).
        select: { id: true, type: true, filePath: true },
        take: MAX_RENEWAL_DOCUMENTS_TO_PURGE,
      });
      const readOrder =
        prisma.licenseRenewalDocument.findMany.mock.invocationCallOrder[0];
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(readOrder).toBeLessThan(txOrder);
    });

    it("délègue la suppression des fichiers APRÈS la transaction", async () => {
      compare.mockResolvedValue(true);
      withDocuments("document-1.jpg", "document-2.pdf");

      await service.deleteMyAccount("u1", "correct-password");

      expect(renewalDocumentFiles.deleteFiles).toHaveBeenCalledWith(
        ["document-1.jpg", "document-2.pdf"],
        "account-deletion",
      );
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      const cleanOrder =
        renewalDocumentFiles.deleteFiles.mock.invocationCallOrder[0];
      expect(txOrder).toBeLessThan(cleanOrder);
    });

    it("ne supprime aucun fichier si la transaction échoue", async () => {
      compare.mockResolvedValue(true);
      withDocuments("document-1.jpg");
      prisma.$transaction.mockRejectedValue(new Error("tx failed"));

      await expect(
        service.deleteMyAccount("u1", "correct-password"),
      ).rejects.toThrow("tx failed");

      expect(renewalDocumentFiles.deleteFiles).not.toHaveBeenCalled();
    });

    it("warning (sans identifiant utilisateur) si la lecture des documents atteint le plafond", async () => {
      compare.mockResolvedValue(true);
      withDocuments(
        ...Array.from(
          { length: MAX_RENEWAL_DOCUMENTS_TO_PURGE },
          (_, i) => `document-${i}.jpg`,
        ),
      );
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      await service.deleteMyAccount("u1", "correct-password");

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain(String(MAX_RENEWAL_DOCUMENTS_TO_PURGE));
      expect(message).not.toContain("u1");
      expect(renewalDocumentFiles.deleteFiles).toHaveBeenCalledTimes(1);
    });

    it("pas de warning sous le plafond", async () => {
      compare.mockResolvedValue(true);
      withDocuments("document-1.jpg");
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      await service.deleteMyAccount("u1", "correct-password");

      expect(warn).not.toHaveBeenCalled();
    });

    it("rejette en Unauthorized si le mot de passe est incorrect, sans rien supprimer", async () => {
      compare.mockResolvedValue(false);

      await expect(
        service.deleteMyAccount("u1", "wrong-password"),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.licenseRenewalDocument.findMany).not.toHaveBeenCalled();
      expect(renewalDocumentFiles.deleteFiles).not.toHaveBeenCalled();
    });

    it("rejette en NotFound si l'utilisateur n'existe pas", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMyAccount("ghost", "whatever"),
      ).rejects.toThrow(NotFoundException);

      expect(compare).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("searchUsers (#545)", () => {
    it("retourne [] sous 2 caractères sans requête DB", async () => {
      const res = await service.searchUsers("a");
      expect(res).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it("cherche par email/prénom/nom/licence, borné à 20", async () => {
      prisma.user.findMany.mockResolvedValue([] as never);

      await service.searchUsers("dupont");

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: expect.arrayContaining([
              { email: { contains: "dupont", mode: "insensitive" } },
              { lastName: { contains: "dupont", mode: "insensitive" } },
            ]) as unknown,
          },
          take: 20,
        }),
      );
    });
  });
});
