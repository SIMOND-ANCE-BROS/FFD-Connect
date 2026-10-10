import { useLayoutEffect } from "react";
import { markSensitiveScreenShown } from "../utils/sentryPrivacy";

/**
 * Call at the top of a screen that displays health data or identity
 * documents (#242, RGPD art. 9): while it is mounted — even covered by another
 * stack screen — `beforeScreenshot` refuses the screenshot of every
 * JS-captured error. Native crashes never get one (`attachScreenshot: false`,
 * see utils/sentryOptions.ts). A layout effect so the flag is set before the
 * first paint; released on unmount.
 */
export function useSensitiveScreen(): void {
  useLayoutEffect(() => markSensitiveScreenShown(), []);
}
