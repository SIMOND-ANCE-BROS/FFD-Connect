import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { createLogger } from "../../../utils/logger";
import {
  Notification,
  useNotificationsRepository,
} from "./useNotificationsRepository";
export type { Notification };

const logger = createLogger("useNotificationsLogic");

export const useNotificationsLogic = () => {
  const notificationsRepo = useNotificationsRepository();
  const queryClient = useQueryClient();

  /**
   * La pastille de la cloche lit une requête React Query distincte
   * (`useUnreadNotificationsCount`), alors que les lectures passent par des
   * appels manuels. Sans invalidation, elle gardait son ancienne valeur
   * jusqu'à son `refetchInterval` — une minute — quoi qu'on fasse à l'écran.
   */
  const refreshUnreadBadge = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["notifications", "unread-count"],
    });
  }, [queryClient]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await notificationsRepo.getNotifications();
      setNotifications(data);
    } catch (error) {
      logger.error("[useNotificationsLogic] Load failed", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notificationsRepo]);

  useEffect(() => {
    loadNotifications().catch(() => {});
  }, [loadNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsRepo.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      refreshUnreadBadge();
    } catch (error) {
      logger.error("[useNotificationsLogic] Mark read failed", error);
    }
  };

  const handleReadAll = async () => {
    try {
      await notificationsRepo.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      refreshUnreadBadge();
    } catch (error) {
      logger.error("[useNotificationsLogic] Mark all read failed", error);
    }
  };

  /**
   * Suppression optimiste : la ligne disparaît avant l'aller-retour réseau, et
   * la liste d'avant est restaurée si le serveur refuse.
   *
   * L'instantané est pris sur le rendu courant — celui dans lequel
   * l'utilisateur a appuyé — donc il décrit bien l'écran qu'il faut rétablir.
   */
  const handleDelete = async (id: string) => {
    const previous = notifications;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await notificationsRepo.deleteNotification(id);
      // Une notification non lue qui disparaît change le compte de la cloche.
      refreshUnreadBadge();
    } catch (error) {
      logger.error("[useNotificationsLogic] Delete failed", error);
      setNotifications(previous);
    }
  };

  const handleDeleteAll = async () => {
    const previous = notifications;
    setNotifications([]);
    try {
      await notificationsRepo.deleteAllNotifications();
      refreshUnreadBadge();
    } catch (error) {
      logger.error("[useNotificationsLogic] Delete all failed", error);
      setNotifications(previous);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications().catch(() => {});
  };

  return {
    state: {
      notifications,
      loading,
      refreshing,
    },
    actions: {
      onRefresh,
      onMarkAsRead: handleMarkAsRead,
      onReadAll: handleReadAll,
      onDelete: handleDelete,
      onDeleteAll: handleDeleteAll,
    },
  };
};
