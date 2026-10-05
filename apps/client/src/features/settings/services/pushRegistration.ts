import { Platform } from "react-native";
import {
  notificationsControllerRegisterDeviceToken,
  notificationsControllerUnregisterDeviceToken,
} from "../../../api/generated";
import { createLogger } from "../../../utils/logger";
import { loadNotificationHandler } from "./loadNotificationHandler";

const logger = createLogger("pushRegistration");

/**
 * Bridges Firebase Messaging to the backend: the client obtains an FCM token,
 * the backend stores it (POST /notifications/device-token) so it can actually
 * deliver a notification. Without this the two halves never meet — the app
 * held a token it sent to nobody, and the backend could only send to a token
 * it never received.
 *
 * Everything here is best-effort and MUST NOT be able to fail a login or a
 * logout. Two reasons it can legitimately do nothing:
 *
 *  - Firebase is gated per app variant in app.config.js: the native plugins
 *    are only applied when a GoogleService-Info / google-services file exists
 *    for that variant. On a build without one the native module is missing, so
 *    even importing the handler can throw. Hence the lazy, guarded load
 *    (loadNotificationHandler) rather than a static import — a static import
 *    would take the whole auth flow down.
 *  - The user can refuse the notification permission.
 */

/** Set once the app-lifetime message listeners are wired, to avoid stacking them. */
let listenersReady = false;
/** Unsubscribe for the token-rotation listener, dropped on logout. */
let unsubscribeTokenRefresh: (() => void) | undefined;
/** Claimed synchronously so concurrent callers cannot stack two listeners. */
let refreshSubscribed = false;

const devicePlatform = (): "IOS" | "ANDROID" =>
  Platform.OS === "ios" ? "IOS" : "ANDROID";

type AuthMod = typeof import("../../auth/services/AuthService");

const isImpersonating = async (): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const auth = require("../../auth/services/AuthService") as AuthMod;
    const config = await auth.AuthService.getAuthConfig();
    return config.impersonating === true;
  } catch (error) {
    // Fail closed: if we cannot tell, do not risk re-attributing the device.
    logger.warn("Could not read the auth config, skipping registration", error);
    return true;
  }
};

const sendToken = async (token: string): Promise<void> => {
  // Never during an impersonation (#545): the request would carry the
  // impersonated user's JWT, and the upsert would re-attribute the ADMIN's
  // device to them — the admin would then receive that user's notifications.
  // The window is narrow (FCM only rotates on reinstall/restore) but real.
  //
  // Required lazily: AuthService imports this module, so a static import
  // would close a require cycle.
  if (await isImpersonating()) {
    logger.info("Skipping device token registration during impersonation");
    return;
  }

  const { error } = await notificationsControllerRegisterDeviceToken({
    body: { token, platform: devicePlatform() },
  });
  if (error) {
    // Nothing to retry here on purpose: the token is re-sent on the next login
    // and on every FCM rotation, and the backend upserts, so a missed call is
    // self-healing. Ad-hoc retry/wake logic in features is against the grain
    // (the http layer already handles the scale-to-zero wake).
    logger.warn("Failed to register the device token with the backend", error);
    return;
  }
  logger.info(`Device token registered (${devicePlatform()})`);
};

/**
 * Wires the app-lifetime foreground listeners (onMessage,
 * onNotificationOpenedApp, getInitialNotification). Separate from registration
 * and called at startup from App.tsx, not from the login path:
 * getInitialNotification has to be read on the launch that a notification tap
 * caused — a session restored from the Keychain never goes through login(), so
 * wiring this there meant a tap from the killed state did nothing.
 *
 * The background handler is deliberately NOT wired here: RNFB requires it at
 * module scope in the entry file — see registerBackgroundMessageHandler.
 */
export const setupPushListeners = (): void => {
  if (listenersReady) {
    return;
  }
  const handler = loadNotificationHandler();
  if (!handler) {
    return;
  }
  try {
    handler.setupNotificationListeners();
    listenersReady = true;
  } catch (error) {
    logger.error("Failed to wire the push listeners", error);
  }
};

/**
 * Asks for the notification permission, sends the resulting FCM token to the
 * backend, and keeps it in sync when FCM rotates it. Safe to call on every
 * login, on registration, and on a restored session: the backend upserts on
 * the token and the rotation listener is wired once.
 */
export const registerDeviceTokenForPush = async (): Promise<void> => {
  const handler = loadNotificationHandler();
  if (!handler) {
    return;
  }

  try {
    const token = await handler.requestUserPermission();
    if (!token) {
      logger.info("No FCM token (permission refused or unavailable)");
      return;
    }

    // Claimed synchronously, before any await: `??=` spanning the await below
    // is not atomic, so two concurrent calls (login racing a session restore)
    // would each subscribe and only one would ever be unsubscribed.
    if (!refreshSubscribed) {
      refreshSubscribed = true;
      unsubscribeTokenRefresh = handler.onTokenRefresh((refreshed: string) => {
        void sendToken(refreshed).catch((error: unknown) => {
          logger.warn("Failed to re-register a rotated device token", error);
        });
      });
    }

    await sendToken(token);
  } catch (error) {
    logger.error("Device token registration failed", error);
  }
};

/**
 * Upper bound on how long a logout may wait for the unregister round-trip.
 * The backend scales to zero, so an unlucky call can sit through a 60-120s
 * cold start — unacceptable for someone who just asked to be logged out. On
 * timeout we give up and let the logout proceed: the stale token is corrected
 * on the next login (the backend upserts and re-attributes it) or dropped by
 * the backend's pruning when FCM reports it dead.
 */
const UNREGISTER_TIMEOUT_MS = 3000;

/**
 * Drops this device from the user's push targets. Must run BEFORE the auth
 * tokens are cleared: the DELETE is authenticated, so afterwards it would be
 * rejected and the device would keep receiving the previous user's
 * notifications. Bounded by UNREGISTER_TIMEOUT_MS so it can never hold a
 * logout hostage.
 */
export const unregisterDeviceTokenForPush = async (): Promise<void> => {
  // Every statement lives under the guard, deliberately. AuthService.logout
  // wraps its whole body in a single catch that only logs, so an exception
  // escaping from here would skip clearTokens(), clearLicenseSnapshot() and
  // saveAuthConfig() — leaving the user signed in with their tokens in the
  // Keychain and the offline E-Licence snapshot (PII) on disk, silently. A
  // best-effort call must never own the session teardown.
  try {
    const handler = loadNotificationHandler();
    if (!handler) {
      return;
    }

    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = undefined;
    refreshSubscribed = false;

    const token = await handler.getToken();
    if (!token) {
      return;
    }

    // The abort is what makes the timeout real. Racing the promise alone would
    // only stop us waiting: the request would keep going, and the patched
    // global fetch would then show the "waking the server" overlay on top of
    // the login screen for up to 2.5 minutes, plus pay a full cold start.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, UNREGISTER_TIMEOUT_MS);

    // Isolé dans son propre try : une annulation lève, et si on la laissait
    // remonter au catch extérieur elle sauterait le deleteToken() ci-dessous —
    // c'est-à-dire précisément le filet censé fonctionner sans l'aller-retour.
    try {
      const { error } = await notificationsControllerUnregisterDeviceToken({
        body: { token },
        signal: controller.signal,
      });
      if (error) {
        logger.warn("Failed to unregister the device token", error);
      } else {
        logger.info("Device token unregistered");
      }
    } catch (error) {
      logger.warn("Device token unregistration aborted or failed", error);
    } finally {
      clearTimeout(timer);
    }

    await handler.deleteToken();
  } catch (error) {
    logger.error("Device token unregistration failed", error);
  }
};
