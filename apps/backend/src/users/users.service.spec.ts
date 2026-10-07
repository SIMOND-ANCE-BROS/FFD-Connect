import {
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient, RegistrationStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { MAX_RENEWAL_DOCUMENTS_TO_PURGE, UsersService } from "./users.service";

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

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    renewalDocumentFiles = {
      deleteFiles: jest.fn().mockResolvedValue(new Set()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RenewalDocumentFileCleaner,
          useValue: renewalDocumentFiles,
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

    it("returns user data including the id and email", async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.findOne("u1");

      expect(result.id).toBe("u1");
      expect(result.email).toBe("alice@example.com");
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
        clubId: null,
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

    it("scopes the query to the organizer's club by clubName when no clubId exists", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: null,
        clubName: "DanceClub",
      });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([] as never);

      await service.findClubMembers("org1");

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clubName: "DanceClub", role: UserRole.LICENSEE },
        }),
      );
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
          where: { clubId: "club-42", role: UserRole.LICENSEE },
        }),
      );
    });

    it("computes the most frequent partnerName from active registrations", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "org1",
        role: UserRole.CLUB,
        clubId: null,
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
        clubId: null,
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
        clubId: null,
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
        clubId: null,
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
    it("retourne les données enveloppées avec format et date d'export", async () => {
      const exported = makeUser({
        registrations: [],
        partnershipsAsUser1: [],
        partnershipsAsUser2: [],
        notifications: [],
        trackCorrectionsProposed: [],
      });
      prisma.user.findUnique.mockResolvedValue(exported);

      const result = await service.exportMyData("u1");

      expect(result.format).toBe("ffd-connect-export-v1");
      expect(typeof result.exportedAt).toBe("string");
      expect(result.data).toEqual(exported);
    });

    it("ne sélectionne jamais le mot de passe ni les tokens", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ trackCorrectionsProposed: [] }),
      );

      await service.exportMyData("u1");

      const select = prisma.user.findUnique.mock.calls[0][0]?.select as Record<
        string,
        unknown
      >;
      expect(select.password).toBeUndefined();
      expect(select.refreshTokens).toBeUndefined();
      expect(select.passwordResetTokens).toBeUndefined();
      // Les données personnelles clés sont bien exportées
      expect(select.email).toBe(true);
      expect(select.birthDate).toBe(true);
    });

    it("exporte les appareils push en métadonnées, jamais la valeur du token", async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ trackCorrectionsProposed: [] }),
      );

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
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ trackCorrectionsProposed: [] }),
      );

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
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ trackCorrectionsProposed: [] }),
      );

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

    it("masque le nom des pistes modérées visées par ses propositions", async () => {
      const correction = (track: Record<string, unknown>) => ({
        reason: "TITLE",
        message: null,
        status: "PENDING",
        track,
      });
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          trackCorrectionsProposed: [
            correction({
              title: "Vrai titre",
              artist: "Artiste",
              titleMasked: true,
              blacklisted: false,
            }),
            correction({
              title: "Retirée",
              artist: "Secret",
              titleMasked: false,
              blacklisted: true,
            }),
            correction({
              title: "Public",
              artist: "Artiste",
              titleMasked: false,
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
        { title: "Titre masqué", artist: "Artiste" },
        { title: "Musique retirée", artist: "" },
        { title: "Public", artist: "Artiste" },
      ]);
      expect(JSON.stringify(result)).not.toContain("Vrai titre");
      expect(JSON.stringify(result)).not.toContain("Secret");
    });

    it("rejette en NotFound si l'utilisateur n'existe pas", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.exportMyData("ghost")).rejects.toThrow(
        NotFoundException,
      );
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

    it("purges admin audit rows that target the deleted user", async () => {
      compare.mockResolvedValue(true);

      await service.deleteMyAccount("u1", "correct-password");

      expect(prisma.adminAuditLog.deleteMany).toHaveBeenCalledWith({
        where: { targetType: "USER", targetId: "u1" },
      });
    });

    it("toutes les écritures sont dans la même transaction, suppression du user en dernier", async () => {
      compare.mockResolvedValue(true);
      const marker = (name: string) => ({ op: name }) as never;
      prisma.notification.deleteMany.mockReturnValue(marker("notifications"));
      prisma.seatBooking.deleteMany.mockReturnValue(marker("seatBookings"));
      prisma.registration.deleteMany.mockReturnValue(marker("registrations"));
      prisma.registration.updateMany.mockReturnValue(marker("partnerAnon"));
      prisma.trackCorrection.updateMany.mockReturnValue(
        marker("trackCorrectionAnon"),
      );
      prisma.bugReport.deleteMany.mockReturnValue(marker("bugReports"));
      prisma.adminAuditLog.deleteMany.mockReturnValue(marker("adminAudit"));
      prisma.user.delete.mockReturnValue(marker("user"));

      await service.deleteMyAccount("u1", "correct-password");

      const ops = (
        prisma.$transaction.mock.calls[0][0] as unknown as Array<{
          op: string;
        }>
      ).map((o) => o.op);
      expect(ops).toEqual([
        "notifications",
        "seatBookings",
        "registrations",
        "partnerAnon",
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
        select: { filePath: true },
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
