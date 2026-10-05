import messaging, {
  type RemoteMessage,
} from "@react-native-firebase/messaging";
import { Alert } from "react-native";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("NotificationHandler");

/**
 * Body of the background handler: the single place where a message received
 * while the app is backgrounded or killed is processed. Must stay headless —
 * on Android it runs in a headless JS task with no UI, so no Alert, no
 * navigation, no store that assumes a mounted tree. Visible notifications are
 * displayed by the OS itself; only data-only payloads need work here, and none
 * is consumed yet, so this just traces the receipt (id only, never the payload,
 * which may carry personal data).
 */
export const handleBackgroundMessage = (
  remoteMessage: RemoteMessage,
): Promise<void> => {
  logger.info(
    `Background message received (id=${remoteMessage.messageId ?? "unknown"})`,
  );
  return Promise.resolve();
};

class NotificationHandler {
  async requestUserPermission() {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      return await this.getToken();
    }
    return undefined;
  }

  async getToken() {
    try {
      const token = await messaging().getToken();

      return token;
    } catch (error) {
      logger.error("Failed to get FCM token:", error);
      return undefined;
    }
  }

  /**
   * Registers the handler for messages received while the app is in the
   * background or killed. RNFB requires this at module scope in the entry file
   * (index.js), never inside the React lifecycle — only call it through
   * registerBackgroundMessageHandler (backgroundMessaging.ts), which also
   * guards builds without Firebase.
   */
  registerBackgroundMessageHandler(): void {
    messaging().setBackgroundMessageHandler(handleBackgroundMessage);
  }

  /**
   * Wires the foreground listeners. Called from App.tsx at startup. The
   * background handler is not part of this on purpose, see
   * registerBackgroundMessageHandler.
   */
  setupNotificationListeners() {
    // Foreground message handler
    const unsubscribe = messaging().onMessage((remoteMessage) => {
      if (remoteMessage.notification) {
        Alert.alert(
          remoteMessage.notification.title ?? "Notification",
          remoteMessage.notification.body ?? "",
        );
      }
    });

    // Handle user interaction when app is in background
    messaging().onNotificationOpenedApp((_remoteMessage) => {});

    // Check if app was opened from a quit state
    messaging()
      .getInitialNotification()
      .then((_remoteMessage) => {
        if (_remoteMessage) {
        }
      })
      .catch(() => {});

    return unsubscribe;
  }

  /**
   * FCM rotates registration tokens (app reinstall, restore from backup, token
   * invalidation). The backend only knows the token we last sent it, so every
   * rotation has to be pushed again or the device silently stops receiving
   * notifications. Returns the unsubscribe function.
   */
  onTokenRefresh(listener: (token: string) => void): () => void {
    return messaging().onTokenRefresh(listener);
  }

  /**
   * Drops the registration token on the device itself. Used at full logout so
   * delivery stops immediately, without depending on the backend round-trip
   * succeeding. FCM mints a fresh token on the next getToken().
   */
  async deleteToken(): Promise<void> {
    await messaging().deleteToken();
  }

  async subscribeToTopic(topic: string) {
    await messaging().subscribeToTopic(topic);
  }

  async unsubscribeFromTopic(topic: string) {
    await messaging().unsubscribeFromTopic(topic);
  }
}

export const notificationHandler = new NotificationHandler();
