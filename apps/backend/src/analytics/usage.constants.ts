/**
 * Mesure d'audience anonyme (lot 5). Les noms d'événements sont le miroir
 * exact de `AnalyticsEventName` côté client (vérifié par usage.constants.spec).
 */
export const USAGE_EVENT_NAMES = [
  "login",
  "login_biometric",
  "login_guest",
  "screen_view",
  "competition_view",
  "license_scan",
  "register",
  "registration_start",
  "license_wallet_add",
] as const;
export type UsageEventName = (typeof USAGE_EVENT_NAMES)[number];

/** Events shown per day on the dashboard (screen views have their own table). */
export const USAGE_KEY_EVENTS = [
  "login",
  "login_biometric",
  "login_guest",
  "register",
  "license_scan",
  "license_wallet_add",
] as const satisfies readonly UsageEventName[];

export const USAGE_SPACES = [
  "LICENSEE",
  "CLUB",
  "STAFF",
  "ADMIN",
  "GUEST",
] as const;
export type UsageSpace = (typeof USAGE_SPACES)[number];

export const USAGE_PLATFORMS = ["ios", "android"] as const;
export type UsagePlatform = (typeof USAGE_PLATFORMS)[number];

export const USAGE_MAX_BATCH = 200;
export const USAGE_MAX_DURATION_SEC = 1800;
export const USAGE_PAST_WINDOW_MS = 7 * 86_400_000;
export const USAGE_FUTURE_SKEW_MS = 5 * 60_000;
export const USAGE_RAW_RETENTION_DAYS = 90;
export const USAGE_AGG_RETENTION_MONTHS = 25;
export const USAGE_SESSION_GAP_MINUTES = 30;
