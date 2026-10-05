/**
 * Stockage sécurisé des tokens d'authentification (Keychain iOS / Keystore
 * Android) via expo-secure-store, au lieu d'AsyncStorage (non chiffré).
 *
 * Les PRÉFÉRENCES restent dans AsyncStorage (`auth_config`) ; seuls les SECRETS
 * (access + refresh token) vivent ici. Migration transparente : au premier
 * accès, si SecureStore est vide mais que l'ancien blob AsyncStorage contient
 * des tokens, on les déplace une fois puis on les retire du blob.
 *
 * Sémantique volontairement SANS suppression implicite : `setTokens` n'écrit que
 * les valeurs fournies (jamais de delete sur undefined) pour éviter tout
 * lockout accidentel lors d'une simple mise à jour de préférence. La
 * déconnexion appelle explicitement `clearTokens`.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearOfflineQueue } from "../services/offlineQueueStorage";
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "ffd.authToken";
const REFRESH_KEY = "ffd.refreshToken";
const LEGACY_KEY = "auth_config";

export interface Tokens {
  authToken?: string;
  refreshToken?: string;
}

/** Déplace une fois les tokens de l'ancien blob AsyncStorage vers SecureStore. */
async function migrateLegacyTokens(): Promise<Tokens> {
  const json = await AsyncStorage.getItem(LEGACY_KEY);
  if (!json) return {};

  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }

  const authToken =
    typeof cfg.authToken === "string" ? cfg.authToken : undefined;
  const refreshToken =
    typeof cfg.refreshToken === "string" ? cfg.refreshToken : undefined;
  if (!authToken && !refreshToken) return {};

  if (authToken) await SecureStore.setItemAsync(ACCESS_KEY, authToken);
  if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);

  // Retire les tokens du blob (on garde les préférences).
  delete cfg.authToken;
  delete cfg.refreshToken;
  await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(cfg));

  return { authToken, refreshToken };
}

/** Lit les tokens (SecureStore, avec migration depuis l'ancien blob si besoin). */
export async function getTokens(): Promise<Tokens> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (access || refresh) {
    return {
      authToken: access ?? undefined,
      refreshToken: refresh ?? undefined,
    };
  }
  return migrateLegacyTokens();
}

/** Raccourci : access token courant (ou undefined). */
export async function getAccessToken(): Promise<string | undefined> {
  return (await getTokens()).authToken;
}

/** Écrit les tokens fournis. N'efface JAMAIS sur undefined (voir clearTokens). */
export async function setTokens(tokens: Tokens): Promise<void> {
  if (tokens.authToken !== undefined) {
    await SecureStore.setItemAsync(ACCESS_KEY, tokens.authToken);
  }
  if (tokens.refreshToken !== undefined) {
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
  }
}

/**
 * Efface les deux tokens (déconnexion / refresh invalide / bascule
 * d'impersonation) ET la file hors-ligne (#416).
 *
 * La file est purgée ICI et pas seulement dans `logout()` parce que la session
 * se termine aussi sans passer par lui : `sessionRefresh` sur un 401/403 du
 * refresh token, et les deux bascules d'impersonation. Une entrée survivante
 * serait rejouée avec le token du compte SUIVANT — inscription de B à l'épreuve
 * de A, avec le nom de partenaire de A. `clearTokens` est le seul point de
 * passage commun à toutes les fins de session, présentes et futures.
 *
 * Sans risque de perte indue : un échec transitoire du refresh (réseau,
 * timeout, 5xx) ne vient PAS ici — `performRefresh` conserve la session dans
 * ce cas et ne vide les tokens que sur 401/403.
 */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    clearOfflineQueue(),
  ]);
}
