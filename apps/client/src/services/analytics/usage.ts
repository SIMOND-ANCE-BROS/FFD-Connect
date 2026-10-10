import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { APP_VERSION, BACKEND_URL } from "../../config";
import { rawFetch } from "../../utils/backendWake";
import {
  createUsageRecorder,
  type UsageContext,
  type UsageRecord,
  type UsageSpace,
} from "./usageRecorder";

let context: UsageContext = { space: "GUEST", storeReview: false };

const SEND_TIMEOUT_MS = 10_000;

/**
 * Sent with the RAW fetch: the global fetch is wrapped by backendWake, which
 * would wake the backend and show the overlay on a failure. No auth header.
 */
export async function sendUsageBatch(events: UsageRecord[]): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await rawFetch()(`${BACKEND_URL}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
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
  /**
   * On background: record the closing screen view FIRST, then flush if the
   * backend is awake. Returns an unsubscribe.
   */
  start(onBackground: () => Promise<void> | void): () => void {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "background") return;
      void Promise.resolve(onBackground())
        .catch(() => undefined)
        .then(() => recorder.onBackground());
    });
    return () => sub.remove();
  },
};
