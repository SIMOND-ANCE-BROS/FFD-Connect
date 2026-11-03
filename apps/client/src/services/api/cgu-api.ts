import {
  cguControllerAccept,
  cguControllerGetAcceptance,
} from "../../api/generated";

/**
 * Has the signed-in ACCOUNT accepted `version` of the CGU (#894)?
 *
 * true / false: the backend answered. null: unknown — an older backend
 * without the route (404), the store-review account (`{}` from routes outside
 * its allowlist), a network failure or a cold-starting backend. The caller
 * then falls back to the acceptance kept on the device for that account.
 *
 * Compared with the version THIS app shows, not the server's `accepted`: an
 * app can only collect consent to the text it embeds. Bump the backend's
 * CGU_VERSION first, then ship the app (OTA) with the new text.
 */
async function hasAccepted(version: string): Promise<boolean | null> {
  try {
    const result = await cguControllerGetAcceptance();
    const data = result.data as { acceptedVersion?: unknown } | undefined;
    if (result.error !== undefined || !data) return null;
    if (data.acceptedVersion === null) return false;
    if (typeof data.acceptedVersion !== "string") return null;
    return data.acceptedVersion === version;
  } catch {
    return null;
  }
}

/**
 * Outcome of recording an acceptance: saved; stale — the backend runs
 * another CGU version than the text this app showed (409), so nothing was
 * recorded; failed — anything else (network, cold start, older backend).
 */
export type CguAcceptResult = "saved" | "stale" | "failed";

/** Records the account's acceptance of `version`. Never rejects. */
async function accept(version: string): Promise<CguAcceptResult> {
  try {
    const result = await cguControllerAccept({ body: { version } });
    if (result.error === undefined) return "saved";
    return result.response?.status === 409 ? "stale" : "failed";
  } catch {
    return "failed";
  }
}

export const CguApi = { hasAccepted, accept };
