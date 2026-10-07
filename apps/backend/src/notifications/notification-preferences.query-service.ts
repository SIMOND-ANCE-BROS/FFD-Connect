import { Injectable } from "@nestjs/common";
import { NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  notificationPreferenceEnabledSelect,
  notificationPreferenceStateSelect,
} from "../utils/prisma-selects";
import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  configurableTypesForRole,
  isConfigurable,
  isEnabledByDefault,
  NOTIFICATION_CATALOG,
} from "./notification-catalog";

/** Une entrée du catalogue telle que l'écran de réglages la consomme. */
export interface ResolvedNotificationPreference {
  type: NotificationType;
  /** État effectif : choix explicite s'il existe, défaut du catalogue sinon. */
  enabled: boolean;
  label: string;
  description: string;
}

/**
 * Lectures des préférences de notification.
 *
 * Deux consommateurs, une seule règle de résolution : l'écran de réglages
 * (`getCatalogForUser`) et le filtrage de l'envoi push (`isPushEnabled`) lisent
 * tous deux « la ligne si elle existe, sinon le défaut du catalogue ». Les
 * garder dans la même classe évite que les deux chemins divergent — un
 * utilisateur verrait alors un interrupteur qui ne décrit pas ce qu'il reçoit.
 */
@Injectable()
export class NotificationPreferencesQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le catalogue d'un utilisateur : un interrupteur par type réglable QUI LE
   * CONCERNE, avec son état effectif et sa copie en français.
   *
   * Renvoyé entièrement serveur — libellés et périmètre de rôle compris — pour
   * que l'écran de réglages se contente de dérouler la réponse. Il ne connaît
   * ni l'enum ni les rôles : un type ajouté plus tard, ou un périmètre de rôle
   * modifié, s'applique sans publier de nouvelle version du client.
   *
   * Les lignes d'un type devenu hors périmètre (changement de rôle) ne sont pas
   * renvoyées, mais ne sont JAMAIS supprimées : un licencié promu gestionnaire
   * de club, puis redevenu licencié, retrouve ses réglages tels qu'il les avait
   * laissés.
   *
   * @param userId - Utilisateur authentifié
   * @param role - Rôle porté par le JWT de l'appelant
   * @returns Le catalogue applicable, dans l'ordre de déclaration de l'enum
   */
  async getCatalogForUser(
    userId: string,
    role: string,
  ): Promise<ResolvedNotificationPreference[]> {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: notificationPreferenceStateSelect,
      // Borne la lecture : au plus une ligne par valeur de l'enum, mais la
      // requête ne doit pas dépendre de cette garantie d'unicité pour rester
      // bornée (cf. convention Prisma du dépôt). Volontairement NON filtrée par
      // rôle : les lignes hors périmètre doivent survivre à la lecture.
      take: CONFIGURABLE_NOTIFICATION_TYPES.length + 1,
    });

    const explicit = new Map(
      stored.map((preference) => [preference.type, preference.enabled]),
    );

    return configurableTypesForRole(role).map((type) => ({
      type,
      enabled: explicit.get(type) ?? isEnabledByDefault(type),
      label: NOTIFICATION_CATALOG[type].label,
      description: NOTIFICATION_CATALOG[type].description,
    }));
  }

  /**
   * L'utilisateur accepte-t-il la PUSH de ce type ?
   *
   * Ne concerne que la livraison push : le feed in-app est écrit dans tous les
   * cas, couper un type n'efface rien de l'historique de la cloche (critère
   * d'acceptation de l'issue #37).
   *
   * Un type non réglable (diagnostic déclenché par l'utilisateur) n'interroge
   * même pas la base : il n'a par construction aucune ligne à lire.
   *
   * NE PREND PAS LE RÔLE, et ce n'est pas un oubli : le rôle décide de ce qui
   * est réglable, la préférence stockée décide de ce qui part. Filtrer aussi
   * l'envoi ferait disparaître des notifications à chaque changement de rôle,
   * sans que l'écran de réglages — qui, lui, n'afficherait plus la ligne —
   * permette de comprendre pourquoi.
   *
   * @param userId - Destinataire
   * @param type - Type d'événement
   * @returns `true` si la push doit partir
   */
  async isPushEnabled(
    userId: string,
    type: NotificationType,
  ): Promise<boolean> {
    if (!isConfigurable(type)) return true;

    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
      select: notificationPreferenceEnabledSelect,
    });

    return preference?.enabled ?? isEnabledByDefault(type);
  }

  /**
   * Version en lot d'{@link isPushEnabled} : parmi `userIds`, ceux qui acceptent
   * la push de ce type.
   *
   * UNE SEULE requête, et non une par destinataire : les producteurs de masse
   * (nouvelle compétition éligible, résultats publiés) s'adressent à des
   * centaines de licenciés, et autant d'allers-retours à la base avant même
   * d'avoir envoyé quoi que ce soit serait absurde.
   *
   * Même règle de lecture que l'unitaire — « la ligne si elle existe, sinon le
   * défaut du catalogue » — pour que les deux chemins ne divergent jamais :
   * l'absence de ligne signifie « jamais réglé », pas « refusé ».
   *
   * L'ordre d'entrée est préservé, et les doublons éventuels aussi : c'est
   * l'appelant qui décide de ce qu'il envoie.
   *
   * @param userIds - Destinataires envisagés
   * @param type - Type d'événement du catalogue
   * @returns Le sous-ensemble de `userIds` dont la push doit partir
   */
  async filterPushEnabled(
    userIds: readonly string[],
    type: NotificationType,
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    // Un type non réglable n'a pas d'interrupteur : personne ne peut l'avoir
    // refusé, inutile d'interroger la base.
    if (!isConfigurable(type)) return [...userIds];

    const preferences = await this.prisma.notificationPreference.findMany({
      where: { type, userId: { in: [...new Set(userIds)] } },
      select: { userId: true, enabled: true },
    });
    const decided = new Map(
      preferences.map((preference) => [preference.userId, preference.enabled]),
    );

    const fallback = isEnabledByDefault(type);
    return userIds.filter((userId) => decided.get(userId) ?? fallback);
  }
}
