import { NotificationType, UserRole } from "@prisma/client";
import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  configurableTypesForRole,
  isApplicableToRole,
  isConfigurable,
  isEnabledByDefault,
  NOTIFICATION_CATALOG,
} from "./notification-catalog";

/**
 * Le catalogue EST la documentation du défaut exigé par l'issue #37 (« le
 * défaut appliqué à un compte existant, sans ligne de préférence, est celui
 * documenté »). Ce fichier le fige : changer un défaut doit être un acte
 * délibéré, pas un effet de bord d'une autre modification.
 */
describe("catalogue des notifications", () => {
  describe("défauts documentés", () => {
    /**
     * Opt-out (activé) quand la notification porte sur le dossier de
     * l'utilisateur ou appelle une action de sa part ; opt-in (désactivé) pour
     * la diffusion.
     */
    const DOCUMENTED_DEFAULTS: Record<NotificationType, boolean> = {
      [NotificationType.REGISTRATION_STATUS]: true,
      [NotificationType.COMPETITION_RESULTS]: true,
      [NotificationType.NEW_COMPETITION]: false,
      [NotificationType.CLUB_MEMBER_REGISTRATION]: false,
      [NotificationType.CLUB_PARTNERSHIP]: true,
      [NotificationType.TRACK_REPORT]: true,
      [NotificationType.DIAGNOSTIC_TEST]: true,
    };

    it.each(Object.entries(DOCUMENTED_DEFAULTS))(
      "%s est %s par défaut",
      (type, expected) => {
        expect(isEnabledByDefault(type as NotificationType)).toBe(expected);
      },
    );

    it("n'active par défaut aucun type de diffusion", () => {
      // Une diffusion part vers une population éligible, pas vers quelqu'un que
      // l'événement concerne personnellement : elle doit être choisie.
      expect(isEnabledByDefault(NotificationType.NEW_COMPETITION)).toBe(false);
      expect(
        isEnabledByDefault(NotificationType.CLUB_MEMBER_REGISTRATION),
      ).toBe(false);
    });
  });

  describe("couverture de l'enum", () => {
    it("décrit chaque valeur de NotificationType", () => {
      // Garantie déjà posée par le typage `Record<NotificationType, …>` ; ce
      // test la rend lisible dans le rapport de tests et couvre le cas d'une
      // entrée ajoutée vide.
      for (const type of Object.values(NotificationType)) {
        expect(NOTIFICATION_CATALOG[type]).toBeDefined();
      }
    });

    it.each(Object.values(NotificationType))(
      "%s porte un libellé et une description en français, non vides",
      (type) => {
        const { label, description } = NOTIFICATION_CATALOG[type];
        expect(label.trim().length).toBeGreaterThan(0);
        expect(description.trim().length).toBeGreaterThan(0);
        // La copie est destinée à l'écran de réglages : pas de nom d'enum qui
        // aurait fuité à la place d'une vraie phrase.
        expect(label).not.toBe(type);
      },
    );
  });

  describe("types réglables", () => {
    it("exclut le diagnostic, déclenché par l'utilisateur lui-même", () => {
      // Le couper rendrait POST /notifications/test menteur : il renverrait
      // `sent: 0`, le symptôme exact qu'il sert à distinguer.
      expect(isConfigurable(NotificationType.DIAGNOSTIC_TEST)).toBe(false);
      expect(CONFIGURABLE_NOTIFICATION_TYPES).not.toContain(
        NotificationType.DIAGNOSTIC_TEST,
      );
    });

    it("expose tous les autres types, dans l'ordre de déclaration de l'enum", () => {
      // L'ordre est le contrat d'affichage de l'écran de réglages.
      expect(CONFIGURABLE_NOTIFICATION_TYPES).toEqual([
        NotificationType.REGISTRATION_STATUS,
        NotificationType.COMPETITION_RESULTS,
        NotificationType.NEW_COMPETITION,
        NotificationType.CLUB_MEMBER_REGISTRATION,
        NotificationType.CLUB_PARTNERSHIP,
        NotificationType.TRACK_REPORT,
      ]);
    });
  });

  describe("périmètre par rôle", () => {
    /**
     * Chaque périmètre est recopié du `where` du producteur, pas décidé ici :
     * un rôle absent ne peut par construction jamais recevoir la notification.
     */
    const DOCUMENTED_ROLES: Record<NotificationType, UserRole[]> = {
      // Destinataire = registration.userId, aucun filtre de rôle.
      [NotificationType.REGISTRATION_STATUS]: [
        UserRole.LICENSEE,
        UserRole.CLUB,
        UserRole.STAFF,
        UserRole.ADMIN,
      ],
      [NotificationType.COMPETITION_RESULTS]: [
        UserRole.LICENSEE,
        UserRole.CLUB,
        UserRole.STAFF,
        UserRole.ADMIN,
      ],
      // notifyNewCompetition : where { role: LICENSEE }
      [NotificationType.NEW_COMPETITION]: [UserRole.LICENSEE],
      // notifyClubOrganizers : where { role: CLUB }
      [NotificationType.CLUB_MEMBER_REGISTRATION]: [UserRole.CLUB],
      // notifyClubOrganizersForClub : where { role: "CLUB" }
      [NotificationType.CLUB_PARTNERSHIP]: [UserRole.CLUB],
      // reportTrack : where { role: ADMIN }
      [NotificationType.TRACK_REPORT]: [UserRole.ADMIN],
      // Chacun déclenche son propre diagnostic (type non réglable de toute façon).
      [NotificationType.DIAGNOSTIC_TEST]: [
        UserRole.LICENSEE,
        UserRole.CLUB,
        UserRole.STAFF,
        UserRole.ADMIN,
      ],
    };

    it.each(Object.entries(DOCUMENTED_ROLES))(
      "%s s'adresse exactement à %s",
      (type, roles) => {
        expect([
          ...NOTIFICATION_CATALOG[type as NotificationType].roles,
        ]).toEqual(roles);
      },
    );

    it("déclare au moins un rôle pour chaque type", () => {
      // Un type sans destinataire serait un interrupteur que personne ne voit,
      // sur une notification que personne ne reçoit.
      for (const type of Object.values(NotificationType)) {
        expect(NOTIFICATION_CATALOG[type].roles.length).toBeGreaterThan(0);
      }
    });

    it("isApplicableToRole répond non à un rôle inconnu", () => {
      expect(
        isApplicableToRole(NotificationType.REGISTRATION_STATUS, "SUPERVISOR"),
      ).toBe(false);
    });

    it("configurableTypesForRole conserve l'ordre d'affichage", () => {
      const forLicensee = configurableTypesForRole(UserRole.LICENSEE);

      expect(forLicensee).toEqual([
        NotificationType.REGISTRATION_STATUS,
        NotificationType.COMPETITION_RESULTS,
        NotificationType.NEW_COMPETITION,
      ]);
      // Sous-suite de l'ordre global, jamais une réorganisation.
      expect(forLicensee).toEqual(
        CONFIGURABLE_NOTIFICATION_TYPES.filter((type) =>
          forLicensee.includes(type),
        ),
      );
    });

    it("n'expose jamais un type non réglable, quel que soit le rôle", () => {
      for (const role of Object.values(UserRole)) {
        expect(configurableTypesForRole(role)).not.toContain(
          NotificationType.DIAGNOSTIC_TEST,
        );
      }
    });

    it("couvre chaque rôle par au moins un interrupteur", () => {
      // Un rôle sans aucun type verrait un écran de réglages vide.
      for (const role of Object.values(UserRole)) {
        expect(configurableTypesForRole(role).length).toBeGreaterThan(0);
      }
    });
  });
});
