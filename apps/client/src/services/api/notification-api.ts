import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import {
  notificationsControllerGetMyPreferences,
  notificationsControllerUpdateMyPreference,
  type UpdateNotificationPreferenceDto,
} from "../../api/generated";
import { httpGet, httpPost, httpRequest } from "../../utils/httpInterceptor";

/**
 * Une entrée du catalogue de notifications, telle que le serveur la décrit.
 *
 * `type` est volontairement typé `string` et NON par l'union littérale du SDK
 * généré : le client ne fait jamais de branchement dessus, et un type ajouté
 * côté backend doit continuer de s'afficher sans régénérer ni livrer de client.
 * Libellé et description viennent du serveur pour la même raison.
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

  async getPreferences(): Promise<NotificationPreference[]> {
    const { data, error } = await notificationsControllerGetMyPreferences();
    if (error || !data) {
      throw new Error(ERROR_MESSAGES.LOADING_FAILED);
    }
    return data;
  },

  async updatePreference(
    type: string,
    enabled: boolean,
  ): Promise<NotificationPreference> {
    const { data, error } = await notificationsControllerUpdateMyPreference({
      // Le serveur publie une union littérale ; le client la traite comme une
      // clé opaque, d'où la conversion au seul point de contact.
      body: { type: type as UpdateNotificationPreferenceDto["type"], enabled },
    });
    if (error || !data) {
      throw new Error(ERROR_MESSAGES.OPERATION_FAILED);
    }
    return data;
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
