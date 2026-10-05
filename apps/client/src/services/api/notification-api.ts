import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { getAccessToken } from "../../api/tokenStore";
import { httpGet, httpPost, httpRequest } from "../../utils/httpInterceptor";

/** Même source de token que l'intercepteur du client généré (SecureStore). */
async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Une entrée du catalogue de notifications, telle que le serveur la décrit.
 *
 * `type` est opaque pour le client : il ne fait jamais de branchement dessus,
 * il l'utilise comme clé. Libellé et description viennent du serveur, de sorte
 * qu'un type ajouté côté backend devienne réglable sans livrer de client.
 */
export interface NotificationPreference {
  type: string;
  label: string;
  description: string;
  enabled: boolean;
}

export const NotificationApi = {
  async getNotifications<T = unknown>(token: string): Promise<T> {
    return httpGet(`${BACKEND_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async markNotificationAsRead(token: string, id: string) {
    return httpRequest(`${BACKEND_URL}/notifications/${id}/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
      logErrors: true,
    });
  },

  // TODO(#37) : basculer ces deux méthodes sur le SDK généré
  // (`notificationsControllerGetPreferences` / `...UpdatePreference`) dès que le
  // backend aura livré les routes et que `pnpm api:sync` les aura exposées.
  // La signature est déjà celle du SDK — sans token — donc le basculement ne
  // touchera que ce fichier.
  async getPreferences(): Promise<NotificationPreference[]> {
    return httpGet(`${BACKEND_URL}/notifications/preferences`, {
      headers: await authHeader(),
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async updatePreference(type: string, enabled: boolean) {
    return httpRequest(`${BACKEND_URL}/notifications/preferences/${type}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
      logErrors: true,
    });
  },

  async markAllNotificationsAsRead(token: string) {
    return httpPost(
      `${BACKEND_URL}/notifications/read-all`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
        logErrors: true,
      },
    );
  },
};
