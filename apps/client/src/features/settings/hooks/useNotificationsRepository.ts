import { useCallback, useMemo } from "react";
import { NotificationApi } from "../../../services/api/notification-api";
import { BackendService } from "../../../services/BackendService";
import { useAuthRepository } from "../../auth/context/AuthContext";

export interface Notification {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  /**
   * Charge utile du producteur, destinée au lien profond. Colonne `Json?` côté
   * serveur, donc de forme libre et potentiellement inconnue du client : un
   * producteur ajouté plus tard ne doit pas exiger une nouvelle version de
   * l'app. L'écran y pioche ce qu'il reconnaît et ignore le reste.
   */
  data?: Record<string, unknown> | null;
}

/**
 * Hook Repository pour les notifications
 * Encapsule les appels à BackendService pour respecter le pattern Repository
 */
export const useNotificationsRepository = () => {
  const auth = useAuthRepository();

  const getNotifications = useCallback(async (): Promise<Notification[]> => {
    const config = await auth.getAuthConfig();
    if (!config.authToken) {
      throw new Error("No auth token available");
    }
    return BackendService.getNotifications<Notification[]>(config.authToken);
  }, [auth]);

  const markAsRead = useCallback(
    async (id: string): Promise<void> => {
      const config = await auth.getAuthConfig();
      if (!config.authToken) {
        throw new Error("No auth token available");
      }
      await BackendService.markNotificationAsRead(config.authToken, id);
    },
    [auth],
  );

  const markAllAsRead = useCallback(async (): Promise<void> => {
    const config = await auth.getAuthConfig();
    if (!config.authToken) {
      throw new Error("No auth token available");
    }
    await BackendService.markAllNotificationsAsRead(config.authToken);
  }, [auth]);

  /**
   * Les deux suppressions passent par `NotificationApi` et non par
   * `BackendService` : ce dernier est figé, les nouveaux appels vont dans les
   * modules par domaine (cf. CLAUDE.md). Elles n'ont pas non plus besoin du
   * jeton — le client généré porte lui-même l'authentification.
   */
  const deleteNotification = useCallback(
    (id: string): Promise<void> => NotificationApi.deleteNotification(id),
    [],
  );

  const deleteAllNotifications = useCallback(
    (): Promise<number> => NotificationApi.deleteAllNotifications(),
    [],
  );

  /**
   * MÉMOÏSÉ, ET CE N'EST PAS DE L'OPTIMISATION PRÉMATURÉE.
   *
   * L'objet renvoyé est une dépendance du `loadNotifications` de
   * `useNotificationsLogic`, lui-même dépendance de l'effet de chargement. Un
   * littéral neuf à chaque rendu redéclenchait donc l'effet à chaque rendu, et
   * comme chaque réponse remplace l'état, chaque réponse provoquait le rendu qui
   * relançait la requête : l'écran rechargeait le feed en boucle tant qu'il
   * restait ouvert.
   *
   * Invisible à l'œil — la liste ne clignote pas — mais c'est une requête par
   * rendu sur une API qui se réveille à la demande (cf. « Runtime & costs »).
   */
  return useMemo(
    () => ({
      getNotifications,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      deleteAllNotifications,
    }),
    [
      getNotifications,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      deleteAllNotifications,
    ],
  );
};
