import { authControllerLogout } from "../../../api/generated";
import { rawFetch } from "../../../utils/backendWake";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("RefreshTokenRevocation");

/**
 * Upper bound of the revocation request. Nothing ever waits for it (it is
 * fire-and-forget), so it only caps how long the request may stay open: long
 * enough to outlast a typical cold start of the scale-to-zero backend (30-60 s,
 * Azure holds the request while the app boots), so the revocation still lands
 * when the backend was asleep.
 */
export const REVOKE_TIMEOUT_MS = 60_000;

/**
 * Revokes on the server a refresh token this device is dropping (#942): a
 * full logout, or the previous session's token replaced by a new login.
 * Without it the token would stay usable for its whole lifetime (30 days) by
 * anyone holding a copy (device backup, extraction).
 *
 * Best-effort and fire-and-forget: returns at once and never throws, so a
 * logout neither waits for the server nor fails because of it. Sent through
 * the raw `fetch`, outside the wake wrapper (backendWake): no "waking the
 * server" overlay over the login screen and no wake-and-replay. Offline, or
 * when the token is already revoked or expired, it simply fails quietly; the
 * token then expires on its own.
 */
export function revokeRefreshTokenInBackground(
  refreshToken: string | undefined,
): void {
  if (!refreshToken) return;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REVOKE_TIMEOUT_MS);
  const done = () => clearTimeout(timer);
  try {
    void authControllerLogout({
      body: { refresh_token: refreshToken },
      signal: controller.signal,
      fetch: rawFetch(),
    })
      .then(({ error }) => {
        if (error) logger.warn("Refresh token not revoked by the server");
        else logger.info("Refresh token revoked");
      })
      .catch(() => {
        logger.warn("Refresh token revocation failed or timed out");
      })
      .finally(done);
  } catch {
    done();
    logger.warn("Refresh token revocation could not be sent");
  }
}
