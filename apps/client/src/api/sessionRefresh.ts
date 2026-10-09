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
import { useAuthStore } from "../stores/auth.store";
import { createLogger } from "../utils/logger";
import { clearTokens, getTokens, setTokens } from "./tokenStore";

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
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(prefs));
}

// Le backend ROTE le refresh token à chaque appel (révoque l'ancien, en émet un
// nouveau). Deux refresh en parallèle se révoqueraient mutuellement → on
// sérialise via une seule promesse en vol partagée par tous les appelants.
let inFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return null;

  try {
    // axios nu (aucun interceptor) → pas de récursion sur le 401 de /auth/refresh.
    const res = await axios.post<RefreshResponse>(
      `${API_URL}/auth/refresh`,
      { refresh_token: refreshToken },
      { timeout: API_TIMEOUT_MS },
    );
    const { access_token, refresh_token } = res.data;
    await setTokens({ authToken: access_token, refreshToken: refresh_token });
    await setLoggedInFlag(true);
    return access_token;
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;

    // Seul un refresh token invalide/expiré/révoqué met fin à la session.
    if (status === 401 || status === 403) {
      logger.warn("Refresh token invalide/expiré — déconnexion");
      await clearTokens();
      // Session over: the offline license snapshot (PII + signed QR) goes with
      // it, like on an explicit logout. Not via runSessionEndCleanups — that
      // registry also runs on the biometric lock, which keeps the snapshot.
      await clearLicenseSnapshot();
      await setLoggedInFlag(false);
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
 * Rafraîchit l'access token de façon silencieuse. Les appels concurrents
 * partagent la même requête en vol. Renvoie le nouvel access token, ou `null`
 * si la session n'a pas pu être rafraîchie.
 */
export function refreshSession(): Promise<string | null> {
  inFlight ??= performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
