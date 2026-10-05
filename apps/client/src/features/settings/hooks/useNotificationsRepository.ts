import { useCallback } from "react";
import { BackendService } from "../../../services/BackendService";
import { useAuthRepository } from "../../auth/context/AuthContext";

export interface Notification {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
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

  return {
    getNotifications,
    markAsRead,
    markAllAsRead,
  };
};
