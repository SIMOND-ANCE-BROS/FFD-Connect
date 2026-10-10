/**
 * Analytics produit. En __DEV__ : log console. Hors dev : mesure d'audience
 * anonyme (lot 5, `usage.ts`), désactivable dans Réglages.
 */
import type {
  AnalyticsEventName,
  AnalyticsEventParams,
  IAnalytics,
} from "./types";
import type { UsageInput } from "./usageRecorder";

interface AnalyticsDeps {
  dev: boolean;
  now(): Date;
  record(input: UsageInput): Promise<void>;
}

export interface AnalyticsWithScreens extends IAnalytics {
  /** Closes the screen view in progress (app going to the background). */
  endScreen(): void;
}

export function createAnalytics(deps: AnalyticsDeps): AnalyticsWithScreens {
  let current: { screen: string; startedAt: Date } | null = null;

  const record = (input: UsageInput) => {
    void deps.record(input).catch(() => undefined);
  };

  const endScreen = () => {
    if (!current) return;
    const { screen, startedAt } = current;
    current = null;
    record({
      name: "screen_view",
      screen,
      occurredAt: startedAt,
      durationSec: (deps.now().getTime() - startedAt.getTime()) / 1000,
    });
  };

  return {
    logEvent(name: AnalyticsEventName, params?: AnalyticsEventParams) {
      if (deps.dev) {
        // eslint-disable-next-line no-console
        console.log("[Analytics]", name, params ?? {});
        return;
      }
      const competitionId = params?.competition_id;
      record(
        typeof competitionId === "string" ? { name, competitionId } : { name },
      );
    },
    logScreenView(screenName: string, params?: AnalyticsEventParams) {
      if (deps.dev) {
        // eslint-disable-next-line no-console
        console.log("[Analytics] screen_view", {
          screen_name: screenName,
          ...params,
        });
        return;
      }
      endScreen();
      current = { screen: screenName, startedAt: deps.now() };
    },
    endScreen,
  };
}

export const analytics: AnalyticsWithScreens = createAnalytics({
  dev: __DEV__,
  now: () => new Date(),
  // Lazy: keeps AsyncStorage / react-native out of modules that only log.
  record: async (input) => {
    const { usage } = await import("./usage");
    await usage.recorder.record(input);
  },
});
