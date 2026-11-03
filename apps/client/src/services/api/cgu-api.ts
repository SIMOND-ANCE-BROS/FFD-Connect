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

/** Records the account's acceptance of `version`. Resolves false on any failure. */
async function accept(version: string): Promise<boolean> {
  try {
    const result = await cguControllerAccept({ body: { version } });
    return result.error === undefined;
  } catch {
    return false;
  }
}

export const CguApi = { hasAccepted, accept };
