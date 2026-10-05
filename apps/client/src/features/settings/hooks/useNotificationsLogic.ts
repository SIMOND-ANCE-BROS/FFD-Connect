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
    } catch (error) {
      logger.error("[useNotificationsLogic] Mark read failed", error);
    }
  };

  const handleReadAll = async () => {
    try {
      await notificationsRepo.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (error) {
      logger.error("[useNotificationsLogic] Mark all read failed", error);
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
    },
  };
};
