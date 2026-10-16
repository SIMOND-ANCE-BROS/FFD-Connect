import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Check-in policy of each competition a scanner opened (#668, ADR-0024),
 * cached so a scanner without network applies it too: when the organiser
 * made the rotating entry QR mandatory, a static QR (Wallet pass, older app)
 * is refused offline with the same reason as online.
 *
 * Not personal data (a competition setting): kept across logouts, bounded to
 * the most recently refreshed competitions.
 */
const POLICY_KEY = "checkin_policy_v1";

/** Competitions kept in the cache; a scanner rarely serves more. */
export const CHECKIN_POLICY_MAX_ENTRIES = 20;

export interface CheckinPolicy {
  requireRotatingQr: boolean;
}

interface StoredPolicy extends CheckinPolicy {
  fetchedAt: number;
}

type StoredPolicies = Record<string, StoredPolicy>;

function isStoredPolicy(value: unknown): value is StoredPolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Partial<StoredPolicy>;
  return (
    typeof policy.requireRotatingQr === "boolean" &&
    typeof policy.fetchedAt === "number"
  );
}

async function readAll(): Promise<StoredPolicies> {
  try {
    const raw = await AsyncStorage.getItem(POLICY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const policies: StoredPolicies = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isStoredPolicy(value)) policies[id] = value;
    }
    return policies;
  } catch {
    return {};
  }
}

export async function saveCheckinPolicy(
  competitionId: string,
  policy: CheckinPolicy,
  now: Date = new Date(),
): Promise<void> {
  try {
    const policies = await readAll();
    policies[competitionId] = {
      requireRotatingQr: policy.requireRotatingQr,
      fetchedAt: now.getTime(),
    };
    // Keep the most recently refreshed competitions only.
    const kept = Object.entries(policies)
      .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
      .slice(0, CHECKIN_POLICY_MAX_ENTRIES);
    await AsyncStorage.setItem(
      POLICY_KEY,
      JSON.stringify(Object.fromEntries(kept)),
    );
  } catch {
    // Best-effort: the next opening of the scanner online retries.
  }
}

/** Cached policy of the competition, or null if never fetched on this device. */
export async function loadCheckinPolicy(
  competitionId: string,
): Promise<CheckinPolicy | null> {
  const policies = await readAll();
  if (!Object.prototype.hasOwnProperty.call(policies, competitionId)) {
    return null;
  }
  return { requireRotatingQr: policies[competitionId].requireRotatingQr };
}
