/**
 * Refresh silencieux de la session.
 *
 * Quand l'access token (60 min) expire, une requête renvoie 401. Au lieu de
 * déconnecter l'utilisateur, on échange le refresh token (30 j) contre un
 * nouveau access token via POST /auth/refresh, puis on rejoue la requête. La
 * session ne se termine QUE si le refresh token lui-même est invalide/expiré
 * (401/403) ou à la déconnexion explicite — comportement "Instagram".
 *
 * Module autonome (pas d'import d'AuthService ni du client HTTP intercepté) pour
 * éviter tout cycle d'import et toute récursion de refresh. Utilise un axios nu
 * (sans interceptor) pour appeler /auth/refresh.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

import { API_TIMEOUT_MS, API_URL } from "../config";
import { clearLicenseSnapshot } from "../features/license/utils/licenseSnapshot";
import { runSessionEndCleanups } from "../services/sessionCleanup";
import { useAuthStore } from "../stores/auth.store";
import { createLogger } from "../utils/logger";
import {
  IMPERSONATION_BACKUP_KEY,
  clearImpersonationBackupTokens,
  clearTokensIfRefreshIs,
  getTokens,
  setTokensIfRefreshIs,
  setUnreadableSessionHandler,
} from "./tokenStore";
import { isTokenStoreUnavailable } from "./tokenStoreErrors";

const AUTH_KEY = "auth_config";
const logger = createLogger("sessionRefresh");

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
}

/** Met à jour le flag isLoggedIn dans le blob de préférences (AsyncStorage). */
async function setLoggedInFlag(value: boolean): Promise<void> {
  const json = await AsyncStorage.getItem(AUTH_KEY);
  let prefs: Record<string, unknown> = {};
  if (json) {
    try {
      prefs = JSON.parse(json) as Record<string, unknown>;
    } catch {
      prefs = {};
    }
  }
  prefs.isLoggedIn = value;
  if (!value) {
    // A session end is never an impersonation any more.
    delete prefs.impersonating;
    delete prefs.impersonatedName;
  }
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(prefs));
}

/**
 * Session over without logout(): the admin's tokens set aside by an
 * impersonation go with it (#591, #598 review). Best-effort.
 */
async function endSessionState(): Promise<void> {
  await setLoggedInFlag(false);
  // The next account to sign in must not find this one's server cache (#879):
  // memory + persisted copy, as at a logout. Never throws.
  await runSessionEndCleanups();
  try {
    await Promise.all([
      AsyncStorage.removeItem(IMPERSONATION_BACKUP_KEY),
      clearImpersonationBackupTokens(),
    ]);
  } catch {
    // best-effort
  }
}

// Le backend ROTE le refresh token à chaque appel (révoque l'ancien, en émet un
// nouveau). Deux refresh en parallèle se révoqueraient mutuellement → on
// sérialise via une seule promesse en vol partagée par tous les appelants.
let inFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  let refreshToken: string | undefined;
  try {
    ({ refreshToken } = await getTokens());
  } catch (error) {
    // Token store unreadable (locked iPhone, #582): the refresh token is still
    // there — keep the session, just give up this refresh.
    if (isTokenStoreUnavailable(error)) {
      logger.info("Token store unavailable — refresh skipped, session kept");
      return null;
    }
    throw error;
  }
  if (!refreshToken) return null;

  try {
    // axios nu (aucun interceptor) → pas de récursion sur le 401 de /auth/refresh.
    const res = await axios.post<RefreshResponse>(
      `${API_URL}/auth/refresh`,
      { refresh_token: refreshToken },
      { timeout: API_TIMEOUT_MS },
    );
    const { access_token, refresh_token } = res.data;
    // Compare-and-set: the session may have changed while the request was in
    // flight (impersonation switch, logout, new login). The rotated tokens
    // then belong to the previous session and must never land over the
    // current one (#598 review).
    const stored = await setTokensIfRefreshIs(refreshToken, {
      authToken: access_token,
      refreshToken: refresh_token,
    });
    if (!stored) {
      logger.info(
        "Session changed during the refresh — rotated tokens dropped",
      );
      return null;
    }
    await setLoggedInFlag(true);
    return access_token;
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;

    // Seul un refresh token invalide/expiré/révoqué met fin à la session.
    if (status === 401 || status === 403) {
      // Compare-and-set too: a stale refresh answered 401 after a NEW login
      // (a cold start stretches the request) must not end the newer session.
      const cleared = await clearTokensIfRefreshIs(refreshToken);
      if (!cleared) {
        logger.info("Rejected refresh of a previous session — current kept");
        return null;
      }
      logger.warn("Refresh token invalide/expiré — déconnexion");
      // Session over: the offline license snapshot (PII + signed QR) goes with
      // it, like on an explicit logout. Cleared explicitly here, then the
      // session-end registry runs (endSessionState, #879). The snapshot is
      // not in that registry: logout() also runs it when it only locks the
      // app for a biometric unlock, which keeps the snapshot for the same
      // user.
      await clearLicenseSnapshot();
      await endSessionState();
      // Notifie le store pour que l'UI reflète la déconnexion (au lieu de rester
      // "connectée" avec un token mort).
      try {
        await useAuthStore.getState().refreshAuth();
      } catch {
        // best-effort
      }
      return null;
    }

    // Réseau / timeout / 5xx : NE PAS déconnecter (le refresh token est encore
    // valable). La requête courante échoue, mais la session est conservée et un
    // prochain essai (en ligne) refera le refresh.
    logger.warn("Échec transitoire du refresh — session conservée");
    return null;
  }
}

/**
 * Token store permanently unreadable in the foreground (not a locked iPhone:
 * Keystore unable to decrypt, entitlement error…). tokenStore has already
 * cleared the tokens; end the session visibly — same effects as a rejected
 * refresh token — instead of a user "logged in" with every screen empty.
 */
async function endUnreadableSession(): Promise<void> {
  logger.warn("Token store unreadable — session ended");
  await clearLicenseSnapshot();
  await endSessionState();
  try {
    await useAuthStore.getState().refreshAuth();
  } catch {
    // best-effort
  }
}
setUnreadableSessionHandler(endUnreadableSession);

/**
 * Rafraîchit l'access token de façon silencieuse. Les appels concurrents
 * partagent la même requête en vol. Renvoie le nouvel access token, ou `null`
 * si la session n'a pas pu être rafraîchie.
 */
/**
 * Resolves once the refresh in flight, if any, has settled. The impersonation
 * switch waits for it so it backs up the admin's CURRENT refresh token, not
 * the one this refresh is rotating out.
 */
export async function waitForPendingRefresh(): Promise<void> {
  try {
    await inFlight;
  } catch {
    // its outcome is not ours to handle
  }
}

export function refreshSession(): Promise<string | null> {
  inFlight ??= performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
