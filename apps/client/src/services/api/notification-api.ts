import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { httpGet, httpPost, httpRequest } from "../../utils/httpInterceptor";

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
