import { createLogger } from "../../../utils/logger";
import { loadNotificationHandler } from "./loadNotificationHandler";

const logger = createLogger("backgroundMessaging");

/** Set once the handler is registered, so a second call cannot re-register it. */
let registered = false;

/**
 * Registers the Firebase background message handler. Called from the entry
 * file (index.js) at module scope, synchronously, before registerRootComponent:
 * React Native Firebase requires it there, outside the React lifecycle,
 * otherwise a data-only message received while the app is killed is dropped —
 * on Android the headless task evaluates the bundle without mounting any
 * component, so a registration inside a useEffect never happens.
 *
 * Runs at boot, so it must never throw: on a build without Firebase the loader
 * returns null and this is a silent no-op. Returns whether a handler is now
 * registered.
 */
export const registerBackgroundMessageHandler = (): boolean => {
  if (registered) {
    return true;
  }
  try {
    const handler = loadNotificationHandler();
    if (!handler) {
      return false;
    }
    handler.registerBackgroundMessageHandler();
    registered = true;
    return true;
  } catch (error) {
    logger.error("Failed to register the background message handler", error);
    return false;
  }
};
