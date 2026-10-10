import { useLayoutEffect } from "react";
import { markSensitiveScreenShown } from "../utils/sentryPrivacy";

/**
 * Call at the top of a screen that displays health data or identity
 * documents: while it is mounted, Sentry attaches no screenshot to any event
 * (#242, RGPD art. 9). A layout effect so the flag is set before the first
 * paint; released on unmount.
 */
export function useSensitiveScreen(): void {
  useLayoutEffect(() => markSensitiveScreenShown(), []);
}
