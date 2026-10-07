import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  configurableTypesForRole,
  NOTIFICATION_CATALOG,
} from "./notification-catalog";
import { NotificationPreferencesQueryService } from "./notification-preferences.query-service";

describe("NotificationPreferencesQueryService", () => {
  let service: NotificationPreferencesQueryService;

  const mockPrisma = {
    notificationPreference: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesQueryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(NotificationPreferencesQueryService);
    jest.clearAllMocks();
    mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
  });

  describe("getCatalogForUser", () => {
    it("renvoie un compte vierge au défaut documenté, sans aucune ligne en base", async () => {
      // Critère d'acceptation #37 : un compte existant, qui n'a évidemment
      // aucune ligne de préférence, se comporte selon le défaut — sans
      // migration de données.
      const catalog = await service.getCatalogForUser("u1", UserRole.CLUB);

      expect(catalog).toEqual(
        configurableTypesForRole(UserRole.CLUB).map((type) => ({
          type,
          enabled: NOTIFICATION_CATALOG[type].defaultEnabled,
          label: NOTIFICATION_CATALOG[type].label,
          description: NOTIFICATION_CATALOG[type].description,
        })),
      );
    });

    it("laisse le choix explicite primer sur le défaut, dans les deux sens", async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        // Un type activé par défaut, coupé par l'utilisateur…
        { type: NotificationType.REGISTRATION_STATUS, enabled: false },
        // …et un type désactivé par défaut, allumé par l'utilisateur.
        { type: NotificationType.NEW_COMPETITION, enabled: true },
      ]);

      const catalog = await service.getCatalogForUser("u1", UserRole.LICENSEE);
      const state = new Map(catalog.map((e) => [e.type, e.enabled]));

      expect(state.get(NotificationType.REGISTRATION_STATUS)).toBe(false);
      expect(state.get(NotificationType.NEW_COMPETITION)).toBe(true);
      // Le type non touché garde son défaut.
      expect(state.get(NotificationType.COMPETITION_RESULTS)).toBe(true);
    });

    it("porte les libellés : l'écran de réglages n'a pas à connaître l'enum", async () => {
      const catalog = await service.getCatalogForUser("u1", UserRole.LICENSEE);

      for (const entry of catalog) {
        expect(entry.label).toBe(NOTIFICATION_CATALOG[entry.type].label);
        expect(entry.description).toBe(
          NOTIFICATION_CATALOG[entry.type].description,
        );
      }
    });

    it("n'expose pas le diagnostic, qui n'est pas réglable", async () => {
      const catalog = await service.getCatalogForUser("u1", UserRole.ADMIN);

      expect(catalog.map((e) => e.type)).not.toContain(
        NotificationType.DIAGNOSTIC_TEST,
      );
    });

    it("lit les préférences du seul appelant, en requête bornée", async () => {
      await service.getCatalogForUser("u1", UserRole.LICENSEE);

      expect(mockPrisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        select: { type: true, enabled: true },
        take: CONFIGURABLE_NOTIFICATION_TYPES.length + 1,
      });
    });

    // ── Périmètre par rôle ───────────────────────────────────────────────────

    it("ne propose pas au licencié les types réservés au club et à la modération", async () => {
      const types = (
        await service.getCatalogForUser("u1", UserRole.LICENSEE)
      ).map((entry) => entry.type);

      expect(types).not.toContain(NotificationType.CLUB_MEMBER_REGISTRATION);
      expect(types).not.toContain(NotificationType.CLUB_PARTNERSHIP);
      expect(types).not.toContain(NotificationType.TRACK_REPORT);
      // Mais il garde tout ce qui le concerne.
      expect(types).toEqual([
        NotificationType.REGISTRATION_STATUS,
        NotificationType.COMPETITION_RESULTS,
        NotificationType.NEW_COMPETITION,
        NotificationType.TRACK_CORRECTION_DECISION,
      ]);
    });

    it("propose au gestionnaire de club ses propres types, et pas ceux des autres rôles", async () => {
      const types = (await service.getCatalogForUser("u1", UserRole.CLUB)).map(
        (entry) => entry.type,
      );

      expect(types).toContain(NotificationType.CLUB_MEMBER_REGISTRATION);
      expect(types).toContain(NotificationType.CLUB_PARTNERSHIP);
      // `NEW_COMPETITION` ne part qu'aux licenciés (where: { role: LICENSEE }),
      // `TRACK_REPORT` qu'aux admins : les proposer promettrait un réglage sans
      // effet.
      expect(types).not.toContain(NotificationType.NEW_COMPETITION);
      expect(types).not.toContain(NotificationType.TRACK_REPORT);
    });

    it("propose la modération au seul administrateur", async () => {
      const forAdmin = (
        await service.getCatalogForUser("u1", UserRole.ADMIN)
      ).map((entry) => entry.type);
      const forStaff = (
        await service.getCatalogForUser("u1", UserRole.STAFF)
      ).map((entry) => entry.type);

      expect(forAdmin).toContain(NotificationType.TRACK_REPORT);
      expect(forStaff).not.toContain(NotificationType.TRACK_REPORT);
    });

    it("garde les types universels pour tous les rôles", async () => {
      for (const role of Object.values(UserRole)) {
        const types = (await service.getCatalogForUser("u1", role)).map(
          (entry) => entry.type,
        );
        expect(types).toContain(NotificationType.REGISTRATION_STATUS);
        expect(types).toContain(NotificationType.COMPETITION_RESULTS);
      }
    });

    it("ne propose rien à un rôle inconnu plutôt qu'un réglage sans effet", async () => {
      // Jeton émis par une version antérieure, ou rôle retiré de l'enum.
      await expect(
        service.getCatalogForUser("u1", "SUPERVISOR"),
      ).resolves.toEqual([]);
    });

    it("conserve une préférence devenue hors périmètre : elle cesse d'être renvoyée, pas d'exister", async () => {
      // Un licencié promu gestionnaire, puis redevenu licencié, doit retrouver
      // ses réglages. Rien ne doit effacer la ligne au passage.
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { type: NotificationType.CLUB_MEMBER_REGISTRATION, enabled: true },
      ]);

      const asLicensee = await service.getCatalogForUser(
        "u1",
        UserRole.LICENSEE,
      );
      expect(asLicensee.map((e) => e.type)).not.toContain(
        NotificationType.CLUB_MEMBER_REGISTRATION,
      );

      const asClub = await service.getCatalogForUser("u1", UserRole.CLUB);
      expect(asClub).toContainEqual(
        expect.objectContaining({
          type: NotificationType.CLUB_MEMBER_REGISTRATION,
          enabled: true,
        }),
      );
    });

    it("ne filtre pas la lecture en base par rôle : les lignes hors périmètre survivent", async () => {
      await service.getCatalogForUser("u1", UserRole.LICENSEE);

      const where = mockPrisma.notificationPreference.findMany.mock.calls[0][0]
        .where as Record<string, unknown>;
      expect(where).toEqual({ userId: "u1" });
      expect(where.type).toBeUndefined();
    });
  });

  describe("filterPushEnabled", () => {
    it("ne touche pas la base sans destinataire", async () => {
      await expect(
        service.filterPushEnabled([], NotificationType.NEW_COMPETITION),
      ).resolves.toEqual([]);
      expect(mockPrisma.notificationPreference.findMany).not.toHaveBeenCalled();
    });

    // Un type non réglable n'a pas d'interrupteur : personne ne peut l'avoir
    // refusé, inutile d'interroger la base.
    it("laisse passer tout le monde sur un type non réglable", async () => {
      await expect(
        service.filterPushEnabled(
          ["u1", "u2"],
          NotificationType.DIAGNOSTIC_TEST,
        ),
      ).resolves.toEqual(["u1", "u2"]);
      expect(mockPrisma.notificationPreference.findMany).not.toHaveBeenCalled();
    });

    /**
     * LA raison d'être de cette méthode : les producteurs de masse s'adressent à
     * des centaines de licenciés. Une requête par destinataire avant même
     * d'avoir envoyé quoi que ce soit serait absurde.
     */
    it("lit toutes les décisions en UNE requête", async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);

      await service.filterPushEnabled(
        ["u1", "u2", "u3"],
        NotificationType.NEW_COMPETITION,
      );

      expect(mockPrisma.notificationPreference.findMany).toHaveBeenCalledTimes(
        1,
      );
      const [args] = mockPrisma.notificationPreference.findMany.mock
        .calls[0] as [{ where: { type: unknown; userId: { in: string[] } } }];
      expect(args.where.type).toBe(NotificationType.NEW_COMPETITION);
      expect(args.where.userId.in).toEqual(["u1", "u2", "u3"]);
    });

    it("respecte la décision enregistrée et le défaut du catalogue", async () => {
      // NEW_COMPETITION est activé par défaut : u3, qui n'a jamais réglé, passe.
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { userId: "u1", enabled: false },
        { userId: "u2", enabled: true },
      ]);

      await expect(
        service.filterPushEnabled(
          ["u1", "u2", "u3"],
          NotificationType.NEW_COMPETITION,
        ),
      ).resolves.toEqual(["u2", "u3"]);
    });

    // L'absence de ligne signifie « jamais réglé », pas « refusé ».
    it("applique le défaut OFF d'un type opt-in à qui n'a rien réglé", async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { userId: "u1", enabled: true },
      ]);

      await expect(
        service.filterPushEnabled(
          ["u1", "u2"],
          NotificationType.CLUB_MEMBER_REGISTRATION,
        ),
      ).resolves.toEqual(["u1"]);
    });

    it("dédoublonne la requête mais préserve l'ordre d'entrée", async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.filterPushEnabled(
        ["u2", "u1", "u2"],
        NotificationType.NEW_COMPETITION,
      );

      const [args] = mockPrisma.notificationPreference.findMany.mock
        .calls[0] as [{ where: { userId: { in: string[] } } }];
      expect(args.where.userId.in).toEqual(["u2", "u1"]);
      expect(result).toEqual(["u2", "u1", "u2"]);
    });
  });

  describe("isPushEnabled", () => {
    it("applique le défaut documenté quand aucune ligne n'existe", async () => {
      await expect(
        service.isPushEnabled("u1", NotificationType.REGISTRATION_STATUS),
      ).resolves.toBe(true);
      // Type encore en opt-in : il se déclenche sur l'activité d'autrui, donc
      // en rafale. NEW_COMPETITION ne sert plus d'exemple ici — son éligibilité
      // étant calculée avant l'envoi, son défaut est passé à ON.
      await expect(
        service.isPushEnabled("u1", NotificationType.CLUB_MEMBER_REGISTRATION),
      ).resolves.toBe(false);
    });

    it("respecte la coupure explicite d'un type activé par défaut", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: false,
      });

      await expect(
        service.isPushEnabled("u1", NotificationType.REGISTRATION_STATUS),
      ).resolves.toBe(false);
    });

    it("respecte l'activation explicite d'un type désactivé par défaut", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });

      await expect(
        service.isPushEnabled("u1", NotificationType.NEW_COMPETITION),
      ).resolves.toBe(true);
    });

    it("cible la ligne par la contrainte unique (userId, type)", async () => {
      await service.isPushEnabled("u1", NotificationType.TRACK_REPORT);

      expect(mockPrisma.notificationPreference.findUnique).toHaveBeenCalledWith(
        {
          where: {
            userId_type: {
              userId: "u1",
              type: NotificationType.TRACK_REPORT,
            },
          },
          select: { enabled: true },
        },
      );
    });

    it("autorise un type non réglable sans interroger la base", async () => {
      await expect(
        service.isPushEnabled("u1", NotificationType.DIAGNOSTIC_TEST),
      ).resolves.toBe(true);

      expect(
        mockPrisma.notificationPreference.findUnique,
      ).not.toHaveBeenCalled();
    });

    it("ignore le rôle : l'envoi suit la préférence stockée, pas le périmètre", async () => {
      // Exigence explicite : le rôle décide de ce qui est RÉGLABLE, la
      // préférence de ce qui est ENVOYÉ. Un gestionnaire redevenu licencié
      // continue d'être servi par la ligne qu'il avait posée — sinon des
      // notifications disparaîtraient sans explication possible.
      expect(service.isPushEnabled.length).toBe(2);

      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        enabled: true,
      });
      await expect(
        service.isPushEnabled("u1", NotificationType.CLUB_MEMBER_REGISTRATION),
      ).resolves.toBe(true);
    });
  });
});
