import { useQuery } from "@tanstack/react-query";
import { useNotificationsRepository } from "./useNotificationsRepository";

/**
 * Nombre de notifications non lues (#546 lot A) — pour le badge de la cloche.
 *
 * Rafraîchi à l'ouverture de l'écran/au focus et périodiquement, pour que le
 * badge reste à jour sans action de l'utilisateur. Désactivé pour les invités
 * (pas de token → l'appel échouerait).
 */
export function useUnreadNotificationsCount(enabled: boolean): number {
  const repo = useNotificationsRepository();

  const { data } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => repo.getNotifications(),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  return data ? data.filter((n) => !n.isRead).length : 0;
}
