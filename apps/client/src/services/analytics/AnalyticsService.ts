/**
 * Service d'analytics produit.
 * En __DEV__ : log en console. En prod : no-op par défaut.
 * Pour activer Firebase Analytics : ajouter @react-native-firebase/analytics
 * et remplacer l'implémentation dans createAnalytics().
 */

import type {
  AnalyticsEventName,
  AnalyticsEventParams,
  IAnalytics,
} from "./types";

function createAnalytics(): IAnalytics {
  // En prod : activer via EXPO_PUBLIC_ANALYTICS_ENABLED=true (après branchement Firebase)
  const enabled =
    !__DEV__ &&
    typeof process !== "undefined" &&
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED === "true";
  const logToConsole = __DEV__;

  const logEvent = (
    name: AnalyticsEventName,
    params?: AnalyticsEventParams,
  ) => {
    if (logToConsole) {
      // eslint-disable-next-line no-console
      console.log("[Analytics]", name, params ?? {});
    }
    if (!enabled) return;
    // TODO: when adding @react-native-firebase/analytics:
    // import analytics from '@react-native-firebase/analytics';
    // analytics().logEvent(name, params as Record<string, unknown>);
  };

  const logScreenView = (screenName: string, params?: AnalyticsEventParams) => {
    if (logToConsole) {
      // eslint-disable-next-line no-console
      console.log("[Analytics] screen_view", {
        screen_name: screenName,
        ...params,
      });
    }
    if (!enabled) return;
    // TODO: when adding Firebase: analytics().logScreenView({ screen_name: screenName, screen_class: screenName });
    logEvent("screen_view", { screen_name: screenName, ...params });
  };

  return { logEvent, logScreenView };
}

export const analytics: IAnalytics = createAnalytics();
