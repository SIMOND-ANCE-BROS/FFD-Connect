import { Test, TestingModule } from "@nestjs/testing";
import {
  PartnershipManagementMode,
  PartnershipStatus,
  UserRole,
} from "@prisma/client";
import { AppModule } from "./../src/app.module";
import { ClubsHelloAssoService } from "./../src/clubs/clubs-helloasso.service";
import { ClubsService } from "./../src/clubs/clubs.service";
import { PartnershipQueryService } from "./../src/clubs/partnership-query.service";
import { PartnershipService } from "./../src/clubs/partnership.service";
import { SoloTeamService } from "./../src/clubs/solo-team.service";
import { NotificationsService } from "./../src/notifications/notifications.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { TtsService } from "./../src/tts/tts.service";
import { applyE2EOverrides } from "./test-app.factory";

/**
 * Tests d'intégration pour ClubsService avec vraie base de données.
 * Teste la logique métier (partenariats, équipes solo, inter-club) avec de vraies contraintes DB.
 * NotificationsService et TtsService sont mockés (pas de push réel).
 */
describe("ClubsService (integration with real DB)", () => {
  let moduleFixture: TestingModule;
  let clubsService: ClubsService;
  let partnershipService: PartnershipService;
  let partnershipQueryService: PartnershipQueryService;
  let soloTeamService: SoloTeamService;
  let helloAssoService: ClubsHelloAssoService;
  let prisma: PrismaService;

  const suffix = Date.now();
  const testClubAName = `Club Alpha Test ${suffix}`;
  const testClubBName = `Club Beta Test ${suffix}`;

  let clubAId: string;
  let clubBId: string;
  let organizerAId: string;
  let organizerBId: string;
  let licensee1Id: string;
  let licensee2Id: string;
  let licensee3Id: string; // membre club B

  beforeAll(async () => {
    moduleFixture = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TtsService)
        .useValue({ speak: jest.fn(), getOrCreateCachedAudio: jest.fn() })
        .overrideProvider(NotificationsService)
        .useValue({
          createForUser: jest.fn().mockResolvedValue(undefined),
          // Les producteurs envoient désormais de vraies push (#38) : sans ces
          // doublures, le service réel manquerait à l'appel et l'inscription
          // échouerait — ce que seules les suites sur base réelle ont montré.
          createManyForUsers: jest.fn().mockResolvedValue({ count: 0 }),
          sendToUser: jest
            .fn()
            .mockResolvedValue({ sent: 0, failed: 0, pruned: 0 }),
          sendToUsers: jest.fn().mockResolvedValue({
            recipients: 0,
            sent: 0,
            failed: 0,
            pruned: 0,
          }),
          sendToDevice: jest.fn().mockResolvedValue(undefined),
          sendToTopic: jest.fn().mockResolvedValue(undefined),
        }),
    ).compile();

    clubsService = moduleFixture.get<ClubsService>(ClubsService);
    partnershipService =
      moduleFixture.get<PartnershipService>(PartnershipService);
    partnershipQueryService = moduleFixture.get<PartnershipQueryService>(
      PartnershipQueryService,
    );
    soloTeamService = moduleFixture.get<SoloTeamService>(SoloTeamService);
    helloAssoService = moduleFixture.get<ClubsHelloAssoService>(
      ClubsHelloAssoService,
    );
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Créer les clubs
    const clubA = await prisma.club.create({ data: { name: testClubAName } });
    const clubB = await prisma.club.create({ data: { name: testClubBName } });
    clubAId = clubA.id;
    clubBId = clubB.id;

    // Créer les organisateurs
    const [orgA, orgB] = await Promise.all([
      prisma.user.create({
        data: {
          email: `organizer-a-${suffix}@test.com`,
          password: "hashed",
          firstName: "Org",
          lastName: "Alpha",
          role: UserRole.CLUB,
          clubId: clubAId,
        },
      }),
      prisma.user.create({
        data: {
          email: `organizer-b-${suffix}@test.com`,
          password: "hashed",
          firstName: "Org",
          lastName: "Beta",
          role: UserRole.CLUB,
          clubId: clubBId,
        },
      }),
    ]);
    organizerAId = orgA.id;
    organizerBId = orgB.id;

    // Créer les licenciés
    const [l1, l2, l3] = await Promise.all([
      prisma.user.create({
        data: {
          email: `licensee1-${suffix}@test.com`,
          password: "hashed",
          firstName: "Alice",
          lastName: "Dupont",
          role: UserRole.LICENSEE,
          clubId: clubAId,
          birthDate: new Date("2000-01-01"),
          category: "Ten Dance",
          // A different level in each discipline.
          competitionLevelLatin: "International",
          competitionLevelStandard: "Débutant",
        },
      }),
      prisma.user.create({
        data: {
          email: `licensee2-${suffix}@test.com`,
          password: "hashed",
          firstName: "Bob",
          lastName: "Martin",
          role: UserRole.LICENSEE,
          clubId: clubAId,
          birthDate: new Date("1998-06-15"),
          category: "Ten Dance",
          competitionLevelLatin: "Avancé",
          competitionLevelStandard: "Intermédiaire",
        },
      }),
      prisma.user.create({
        data: {
          email: `licensee3-${suffix}@test.com`,
          password: "hashed",
          firstName: "Charlie",
          lastName: "Durand",
          role: UserRole.LICENSEE,
          clubId: clubBId,
          birthDate: new Date("2001-03-20"),
          competitionLevel: "Débutant",
        },
      }),
    ]);
    licensee1Id = l1.id;
    licensee2Id = l2.id;
    licensee3Id = l3.id;
  }, 30000);

  afterAll(async () => {
    // Nettoyage dans l'ordre des dépendances
    await prisma.soloTeamMember
      .deleteMany({
        where: { user: { email: { contains: `${suffix}@test.com` } } },
      })
      .catch(() => {});
    await prisma.soloTeam
      .deleteMany({ where: { clubId: { in: [clubAId, clubBId] } } })
      .catch(() => {});
    await prisma.partnership
      .deleteMany({ where: { clubId: { in: [clubAId, clubBId] } } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { contains: `${suffix}@test.com` } } })
      .catch(() => {});
    await prisma.club
      .deleteMany({ where: { id: { in: [clubAId, clubBId] } } })
      .catch(() => {});
    await moduleFixture.close();
  }, 15000);

  // ─────────────────────────────────────────────
  // findOrCreateByName
  // ─────────────────────────────────────────────
  describe("findOrCreateByName", () => {
    it("crée un nouveau club", async () => {
      const name = `New Club ${suffix}-fnc`;
      const club = await clubsService.findOrCreateByName(name);
      expect(club.name).toBe(name);
      await prisma.club.delete({ where: { id: club.id } }).catch(() => {});
    });

    it("retourne un club existant (insensible à la casse)", async () => {
      const club = await clubsService.findOrCreateByName(
        testClubAName.toUpperCase(),
      );
      expect(club.id).toBe(clubAId);
    });

    it("rejette un nom vide", async () => {
      await expect(clubsService.findOrCreateByName("   ")).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────
  // getClubIdForOrganizer
  // ─────────────────────────────────────────────
  describe("getClubIdForOrganizer", () => {
    it("retourne le clubId de l'organisateur", async () => {
      const id = await clubsService.getClubIdForOrganizer(organizerAId);
      expect(id).toBe(clubAId);
    });

    it("rejette un user avec un rôle non-CLUB", async () => {
      await expect(
        clubsService.getClubIdForOrganizer(licensee1Id),
      ).rejects.toThrow("Only club role can manage club data");
    });

    it("rejette un userId inexistant", async () => {
      await expect(
        clubsService.getClubIdForOrganizer("non-existent-id"),
      ).rejects.toThrow("User not found");
    });
  });

  // ─────────────────────────────────────────────
  // createPartnership — même club
  // ─────────────────────────────────────────────
  describe("createPartnership (même club)", () => {
    it("crée un couple actif entre deux membres du même club", async () => {
      const result = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee2Id,
      });
      expect(result.partnership.status).toBe(PartnershipStatus.ACTIVE);
      expect(result.partnership.clubId).toBe(clubAId);
      expect(result.partnership.secondaryClubId).toBeNull();
      // Nettoyage
      await prisma.partnership.delete({ where: { id: result.partnership.id } });
    });

    it("rejette un couple avec le même utilisateur deux fois", async () => {
      await expect(
        partnershipService.createPartnership(organizerAId, {
          user1Id: licensee1Id,
          user2Id: licensee1Id,
        }),
      ).rejects.toThrow("Cannot create partnership with same user");
    });

    it("rejette si un licencié n'appartient pas au club", async () => {
      await expect(
        partnershipService.createPartnership(organizerAId, {
          user1Id: licensee1Id,
          user2Id: licensee3Id, // membre du club B
        }),
      ).rejects.toThrow();
    });

    it("rejette un doublon de couple actif", async () => {
      const first = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee2Id,
      });
      await expect(
        partnershipService.createPartnership(organizerAId, {
          user1Id: licensee1Id,
          user2Id: licensee2Id,
        }),
      ).rejects.toThrow(
        "Un couple actif existe déjà entre ces deux partenaires",
      );
      await prisma.partnership.delete({ where: { id: first.partnership.id } });
    });

    it("calcule le groupe d'âge et le niveau suggéré", async () => {
      const result = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee2Id,
      });
      expect(result.coupleAgeGroup).toBe("Adulte");
      // Per discipline: lower partner level in each (Latin: International vs
      // Avancé; Standard: Débutant vs Intermédiaire, Adulte starts at Inter.).
      expect(result.suggestedLevelLatin).toBe("Avancé");
      expect(result.suggestedLevelStandard).toBe("Intermédiaire");
      expect(result.suggestedLevel).toBe("Intermédiaire");
      expect(result.suggestedCategories).toEqual([
        "Latines",
        "Standards",
        "10 danses",
      ]);
      await prisma.partnership.delete({ where: { id: result.partnership.id } });
    });
  });

  // ─────────────────────────────────────────────
  // createPartnership — inter-club
  // ─────────────────────────────────────────────
  describe("createPartnership (inter-club)", () => {
    it("crée un couple PENDING_SECOND_CLUB avec un club partenaire", async () => {
      const result = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee3Id, // club B
        secondaryClubId: clubBId,
      });
      expect(result.partnership.status).toBe(
        PartnershipStatus.PENDING_SECOND_CLUB,
      );
      expect(result.partnership.secondaryClubId).toBe(clubBId);
      await prisma.partnership.delete({ where: { id: result.partnership.id } });
    });

    it("rejette si secondaryClubId === clubId de l'organisateur", async () => {
      await expect(
        partnershipService.createPartnership(organizerAId, {
          user1Id: licensee1Id,
          user2Id: licensee2Id,
          secondaryClubId: clubAId,
        }),
      ).rejects.toThrow("Le second club doit être différent de votre club");
    });
  });

  // ─────────────────────────────────────────────
  // endPartnership
  // ─────────────────────────────────────────────
  describe("endPartnership", () => {
    let partnershipId: string;

    beforeEach(async () => {
      const result = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee2Id,
      });
      partnershipId = result.partnership.id;
    });

    afterEach(async () => {
      await prisma.partnership
        .delete({ where: { id: partnershipId } })
        .catch(() => {});
    });

    it("clôture un couple actif", async () => {
      const endDate = new Date().toISOString();
      const updated = await partnershipService.endPartnership(
        organizerAId,
        partnershipId,
        { endDate },
      );
      expect(updated.endDate).not.toBeNull();
    });

    it("rejette si le club n'a pas les droits de gestion", async () => {
      // Club B essaie de clôturer un couple du club A (PRIMARY_ONLY)
      await expect(
        partnershipService.endPartnership(organizerBId, partnershipId, {
          endDate: new Date().toISOString(),
        }),
      ).rejects.toThrow(
        "Seul le club gestionnaire de ce couple peut le clôturer",
      );
    });

    it("rejette un partnershipId inexistant", async () => {
      await expect(
        partnershipService.endPartnership(organizerAId, "non-existent-id", {
          endDate: new Date().toISOString(),
        }),
      ).rejects.toThrow("Partnership not found or already ended");
    });
  });

  // ─────────────────────────────────────────────
  // validatePartnership (inter-club)
  // ─────────────────────────────────────────────
  describe("validatePartnership", () => {
    let pendingPartnershipId: string;

    beforeEach(async () => {
      const result = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee3Id,
        secondaryClubId: clubBId,
        managementMode: PartnershipManagementMode.BOTH,
      });
      pendingPartnershipId = result.partnership.id;
    });

    afterEach(async () => {
      await prisma.partnership
        .delete({ where: { id: pendingPartnershipId } })
        .catch(() => {});
    });

    it("accepte le couple → statut ACTIVE", async () => {
      const updated = await partnershipService.validatePartnership(
        organizerBId,
        pendingPartnershipId,
        true,
      );
      expect(updated.status).toBe(PartnershipStatus.ACTIVE);
    });

    it("refuse le couple → statut REJECTED", async () => {
      const updated = await partnershipService.validatePartnership(
        organizerBId,
        pendingPartnershipId,
        false,
      );
      expect(updated.status).toBe(PartnershipStatus.REJECTED);
    });

    it("rejette si le club n'est pas le club secondaire", async () => {
      await expect(
        partnershipService.validatePartnership(
          organizerAId, // club primaire, pas secondaire
          pendingPartnershipId,
          true,
        ),
      ).rejects.toThrow("Aucun couple en attente de validation par votre club");
    });
  });

  // ─────────────────────────────────────────────
  // getMembersForPartnership
  // ─────────────────────────────────────────────
  describe("getMembersForPartnership", () => {
    it("retourne les licenciés disponibles du club", async () => {
      const members =
        await partnershipQueryService.getMembersForPartnership(organizerAId);
      const ids = members.map((m) => m.id);
      expect(ids).toContain(licensee1Id);
      expect(ids).toContain(licensee2Id);
      expect(ids).not.toContain(licensee3Id); // club B
    });

    it("exclut les membres déjà en couple actif", async () => {
      const result = await partnershipService.createPartnership(organizerAId, {
        user1Id: licensee1Id,
        user2Id: licensee2Id,
      });
      const members =
        await partnershipQueryService.getMembersForPartnership(organizerAId);
      const ids = members.map((m) => m.id);
      expect(ids).not.toContain(licensee1Id);
      expect(ids).not.toContain(licensee2Id);
      await prisma.partnership.delete({ where: { id: result.partnership.id } });
    });

    it("inclut les licenciés du club partenaire si secondaryClubId fourni", async () => {
      const members = await partnershipQueryService.getMembersForPartnership(
        organizerAId,
        clubBId,
      );
      const ids = members.map((m) => m.id);
      expect(ids).toContain(licensee3Id);
    });
  });

  // ─────────────────────────────────────────────
  // SoloTeam
  // ─────────────────────────────────────────────
  describe("SoloTeam", () => {
    let teamId: string;

    beforeEach(async () => {
      const team = await soloTeamService.createSoloTeam(organizerAId, {
        name: `Team Test ${suffix}`,
        level: "Débutant",
      });
      teamId = team.id;
    });

    afterEach(async () => {
      await prisma.soloTeamMember
        .deleteMany({ where: { teamId } })
        .catch(() => {});
      await prisma.soloTeam.delete({ where: { id: teamId } }).catch(() => {});
    });

    it("crée une équipe solo", async () => {
      const team = await prisma.soloTeam.findUnique({ where: { id: teamId } });
      expect(team).not.toBeNull();
      expect(team!.clubId).toBe(clubAId);
    });

    it("permet la création d'une équipe avec le même nom (pas de contrainte unique en DB)", async () => {
      // The schema has no unique constraint on (clubId, name), so duplicates are allowed
      const duplicate = await soloTeamService.createSoloTeam(organizerAId, {
        name: `Team Test ${suffix}`,
        level: "Débutant",
      });
      expect(duplicate).toHaveProperty("id");
      expect(duplicate.name).toBe(`Team Test ${suffix}`);
      // Clean up the duplicate
      await prisma.soloTeam.delete({ where: { id: duplicate.id } });
    });

    it("ajoute un membre et retourne le niveau recalculé", async () => {
      const team = await soloTeamService.addSoloTeamMember(
        organizerAId,
        teamId,
        licensee2Id, // Latin Avancé / Standard Intermédiaire → highest counts
      );
      expect(team.level).toBe("Intermédiaire");
    });

    it("rejette un membre qui n'appartient pas au club", async () => {
      await expect(
        soloTeamService.addSoloTeamMember(organizerAId, teamId, licensee3Id),
      ).rejects.toThrow("User must be a member of your club");
    });

    it("supprime un membre et recalcule le niveau", async () => {
      await soloTeamService.addSoloTeamMember(
        organizerAId,
        teamId,
        licensee2Id, // Intermédiaire → team devient Intermédiaire
      );
      const team = await soloTeamService.removeSoloTeamMember(
        organizerAId,
        teamId,
        licensee2Id,
      );
      expect(team.level).toBe("Débutant");
    });

    it("rejette une équipe solo appartenant à un autre club", async () => {
      await expect(
        soloTeamService.addSoloTeamMember(organizerBId, teamId, licensee3Id),
      ).rejects.toThrow("Solo team not found");
    });
  });

  // ─────────────────────────────────────────────
  // HelloAsso
  // ─────────────────────────────────────────────
  describe("connectHelloAsso / getMyClubHelloAssoStatus", () => {
    it("connecte HelloAsso et retourne le statut connecté", async () => {
      await helloAssoService.connectHelloAsso(organizerAId, {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        organizationSlug: "test-org",
      });
      const status =
        await helloAssoService.getMyClubHelloAssoStatus(organizerAId);
      expect(status.helloAssoConnected).toBe(true);
      expect(status.organizationSlug).toBe("test-org");
      // Remise à zéro
      await prisma.club.update({
        where: { id: clubAId },
        data: {
          helloAssoClientId: null,
          helloAssoClientSecret: null,
          helloAssoOrgSlug: null,
        },
      });
    });

    it("retourne helloAssoConnected: false si pas configuré", async () => {
      const status =
        await helloAssoService.getMyClubHelloAssoStatus(organizerAId);
      expect(status.helloAssoConnected).toBe(false);
      expect(status.organizationSlug).toBeNull();
    });
  });
});
