import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  isApplicableToRoles,
  isConfigurable,
  NOTIFICATION_CATALOG,
} from "./notification-catalog";
import type { ResolvedNotificationPreference } from "./notification-preferences.query-service";

/**
 * Écritures des préférences de notification.
 *
 * Une ligne n'existe qu'après un choix explicite de l'utilisateur : rien n'est
 * créé à l'inscription, et remettre un interrupteur sur sa valeur par défaut
 * laisse volontairement la ligne en place. La reposer à `enabled = défaut`
 * plutôt que de la supprimer garde une trace du consentement donné, et évite
 * surtout qu'un changement ultérieur du défaut rebascule silencieusement un
 * utilisateur qui s'était prononcé.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enregistre le choix de l'utilisateur pour un type.
   *
   * Idempotent (upsert sur la contrainte unique `userId_type`) : le client peut
   * renvoyer le même état sans créer de doublon ni d'erreur.
   *
   * @param userId - Utilisateur authentifié
   * @param roles - Rôles effectifs de l'appelant (`req.user.roles`)
   * @param type - Type réglable et applicable à l'un de ces rôles
   * @param enabled - `true` pour recevoir la push de ce type
   * @returns L'entrée de catalogue mise à jour, prête à remplacer celle du client
   * @throws BadRequestException si le type n'est pas réglable
   * @throws ForbiddenException si le type ne s'adresse pas à ce rôle
   */
  async setPreference(
    userId: string,
    roles: readonly string[],
    type: NotificationType,
    enabled: boolean,
  ): Promise<ResolvedNotificationPreference> {
    if (!isConfigurable(type)) {
      // `@IsEnum` accepte toutes les valeurs de l'enum, y compris celles que le
      // catalogue ne propose pas. Refuser ici plutôt qu'écrire une ligne que
      // personne ne relira : la préférence serait inopérante et invisible.
      throw new BadRequestException(
        `Le type de notification ${type} n'est pas réglable.`,
      );
    }

    if (!isApplicableToRoles(type, roles)) {
      // Même raison, portée au rôle : écrire une préférence que l'appelant ne
      // peut pas relire (GET ne la renvoie pas) serait incohérent. 403 et non
      // 404 : le type existe et figure dans la documentation OpenAPI, c'est le
      // rôle qui ne donne pas la main — la sémantique du `RolesGuard` du dépôt.
      throw new ForbiddenException(
        `Le type de notification ${type} ne concerne pas votre profil.`,
      );
    }

    const { enabled: stored } = await this.prisma.notificationPreference.upsert(
      {
        where: { userId_type: { userId, type } },
        create: { userId, type, enabled },
        update: { enabled },
        select: { enabled: true },
      },
    );

    return {
      type,
      enabled: stored,
      label: NOTIFICATION_CATALOG[type].label,
      description: NOTIFICATION_CATALOG[type].description,
    };
  }
}
