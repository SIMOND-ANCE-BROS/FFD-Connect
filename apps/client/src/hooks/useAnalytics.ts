import { useCallback } from "react";
import {
  analytics,
  type AnalyticsEventName,
  type AnalyticsEventParams,
} from "../services/analytics";

/**
 * Hook pour envoyer des événements analytics depuis les écrans.
 */
export function useAnalytics() {
  const logEvent = useCallback(
    (name: AnalyticsEventName, params?: AnalyticsEventParams) => {
      analytics.logEvent(name, params);
    },
    [],
  );

  const logScreenView = useCallback(
    (screenName: string, params?: AnalyticsEventParams) => {
      analytics.logScreenView(screenName, params);
    },
    [],
  );

  return { logEvent, logScreenView };
}
