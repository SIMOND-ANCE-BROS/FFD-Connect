import { Platform } from "react-native";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("loadNotificationHandler");

type HandlerModule = typeof import("./NotificationHandler");
export type NotificationHandlerModule = HandlerModule["notificationHandler"];

/**
 * Loads the Firebase-backed handler, or null when this build has no Firebase.
 *
 * Firebase is gated per app variant in app.config.js (`resolveFirebaseFile` /
 * `FIREBASE_ENABLED`): the native plugins are only applied when a
 * GoogleService-Info / google-services file exists for that variant. On a
 * build without one the native module is missing and loading the handler
 * throws — so every caller, including the entry file at boot, must go through
 * here instead of importing @react-native-firebase/messaging statically.
 *
 * `require` rather than `await import()`, because the latter makes Metro split
 * the bundle and Jest's CJS runtime rejects it outright without
 * --experimental-vm-modules. It also keeps the load synchronous, which the
 * background handler registration (module scope, index.js) depends on.
 */
export const loadNotificationHandler = (): NotificationHandlerModule | null => {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("./NotificationHandler") as HandlerModule;
    return loaded.notificationHandler;
  } catch (error) {
    logger.info("Push notifications unavailable on this build", error);
    return null;
  }
};
