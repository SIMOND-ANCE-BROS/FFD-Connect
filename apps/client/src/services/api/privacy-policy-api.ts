import {
  privacyPolicyControllerAcknowledge,
  privacyPolicyControllerGetNotice,
} from "../../api/generated";

/**
 * Version of the privacy policy to announce, or null: nothing to show (#734).
 *
 * Every non-answer reads as null — an older backend without the route (404),
 * the store-review account (`{}` from routes outside its allowlist), a network
 * failure or a cold-starting backend. The notice is information, never a
 * gate: missing it once only delays it to the next launch.
 */
async function pendingVersion(): Promise<string | null> {
  try {
    const result = await privacyPolicyControllerGetNotice();
    const data = result.data as
      | { pending?: unknown; currentVersion?: unknown }
      | undefined;
    if (result.error !== undefined || !data) return null;
    return data.pending === true && typeof data.currentVersion === "string"
      ? data.currentVersion
      : null;
  } catch {
    return null;
  }
}

/** Records that the user read `version`. Resolves false on any failure. */
async function acknowledge(version: string): Promise<boolean> {
  try {
    const result = await privacyPolicyControllerAcknowledge({
      body: { version },
    });
    return result.error === undefined;
  } catch {
    return false;
  }
}

export const PrivacyPolicyApi = { pendingVersion, acknowledge };
