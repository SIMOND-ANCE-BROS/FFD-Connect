import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { APP_VERSION, BACKEND_URL } from "../../config";
import {
  createUsageRecorder,
  type UsageContext,
  type UsageRecord,
  type UsageSpace,
} from "./usageRecorder";

let context: UsageContext = { space: "GUEST", storeReview: false };

/** Plain fetch: no auth header, outside the axios wake-and-replay interceptor. */
export async function sendUsageBatch(events: UsageRecord[]): Promise<number> {
  try {
    const res = await fetch(`${BACKEND_URL}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

const recorder = createUsageRecorder({
  storage: AsyncStorage,
  now: () => new Date(),
  random: Math.random,
  platform:
    Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null,
  appVersion: APP_VERSION || "0",
  context: () => context,
  send: sendUsageBatch,
});

interface ConfigLike {
  isLoggedIn: boolean;
  isGuest?: boolean;
  role: string;
  isStoreReview?: boolean;
}
const SPACES: readonly string[] = [
  "LICENSEE",
  "CLUB",
  "STAFF",
  "ADMIN",
  "GUEST",
];

export const usage = {
  recorder,
  contextFromConfig(config: ConfigLike): UsageContext {
    const role = SPACES.includes(config.role)
      ? (config.role as UsageSpace)
      : "GUEST";
    return {
      space: !config.isLoggedIn || config.isGuest ? "GUEST" : role,
      storeReview: config.isStoreReview === true,
    };
  },
  setContext(next: Partial<UsageContext>): void {
    const wasReview = context.storeReview;
    context = { ...context, ...next };
    if (!wasReview && context.storeReview) void recorder.clear();
  },
  onApiSuccess(): void {
    void recorder.onApiSuccess();
  },
  /** On background: close the pending screen view, then flush if awake. Returns an unsubscribe. */
  start(onBackground: () => void): () => void {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "background") return;
      onBackground();
      void recorder.onBackground();
    });
    return () => sub.remove();
  },
};
