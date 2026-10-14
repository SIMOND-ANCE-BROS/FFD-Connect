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
import * as Sentry from "@sentry/react-native";
import { clearOfflineQueue } from "../services/offlineQueueStorage";
import * as SecureStore from "expo-secure-store";

import { TokenStoreUnavailableError } from "./tokenStoreErrors";

/**
 * Keychain items readable in the background once the iPhone has been unlocked
 * once since boot (#582). The default (WHEN_UNLOCKED) made every request
 * issued while the device was locked — push, refresh, backend wake — fail
 * with "User interaction is not allowed".
 *
 * New key names on purpose: on iOS, `setItemAsync` on an EXISTING item only
 * updates its data (SecItemUpdate) and keeps its original accessibility, so
 * rewriting the old keys would never change anything. Writing under new keys
 * goes through SecItemAdd with the new accessibility; the old item is deleted
 * only once the new one is written, so there is no window without a token.
 * Android ignores `keychainAccessible` (the migration is harmless there).
 */
const ACCESS_KEY = "ffd.session.access";
const REFRESH_KEY = "ffd.session.refresh";
/** Pre-#582 keys, written with the default WHEN_UNLOCKED accessibility. */
const OLD_ACCESS_KEY = "ffd.authToken";
const OLD_REFRESH_KEY = "ffd.refreshToken";
const LEGACY_KEY = "auth_config";

function storeOptions(): SecureStore.SecureStoreOptions {
  return { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
}

export interface Tokens {
  authToken?: string;
  refreshToken?: string;
}

/**
 * Serialises writes and migrations: a migration copying a stale old-key value
 * must never land after a refresh that wrote fresher tokens (the backend
 * rotates refresh tokens — a stale one would end the session later).
 */
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** Raw read, any failure turned into a typed, non-"logged out" error. */
async function readKey(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, storeOptions());
  } catch (error) {
    const typed = new TokenStoreUnavailableError(error);
    try {
      Sentry.addBreadcrumb({
        category: "auth.tokenStore",
        level: "warning",
        message: typed.locked
          ? "Token read refused: device locked"
          : "Token read failed",
      });
    } catch {
      /* breadcrumb is best-effort */
    }
    throw typed;
  }
}

/**
 * Reads one token: the new (AFTER_FIRST_UNLOCK) key first, then the old
 * (WHEN_UNLOCKED) key, moving the value over once (#582).
 */
async function readToken(key: string, oldKey: string): Promise<string | null> {
  const current = await readKey(key);
  if (current !== null) return current;

  return withLock(async () => {
    // Re-check under the lock: a concurrent write may have landed meanwhile.
    const again = await readKey(key);
    if (again !== null) return again;

    const old = await readKey(oldKey);
    if (old === null) return null;
    try {
      await SecureStore.setItemAsync(key, old, storeOptions());
      await SecureStore.deleteItemAsync(oldKey, storeOptions());
    } catch {
      // Migration is opportunistic: the value read is valid, the next read
      // retries the move.
    }
    return old;
  });
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

  if (authToken) {
    await SecureStore.setItemAsync(ACCESS_KEY, authToken, storeOptions());
  }
  if (refreshToken) {
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken, storeOptions());
  }

  // Retire les tokens du blob (on garde les préférences).
  delete cfg.authToken;
  delete cfg.refreshToken;
  await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(cfg));

  return { authToken, refreshToken };
}

/**
 * Lit les tokens (SecureStore, avec migration depuis les anciennes clés et
 * l'ancien blob si besoin).
 *
 * @throws {TokenStoreUnavailableError} si le Keychain/Keystore refuse la
 * lecture (iPhone verrouillé…). Ce n'est PAS « pas de session » : l'appelant
 * abandonne sa requête sans déconnecter (#582). `{}` ne veut dire « aucun
 * token » que lorsque la lecture a réussi.
 */
export async function getTokens(): Promise<Tokens> {
  const [access, refresh] = await Promise.all([
    readToken(ACCESS_KEY, OLD_ACCESS_KEY),
    readToken(REFRESH_KEY, OLD_REFRESH_KEY),
  ]);
  if (access || refresh) {
    return {
      authToken: access ?? undefined,
      refreshToken: refresh ?? undefined,
    };
  }
  return withLock(async () => {
    // Re-check under the lock: a login/refresh may have written meanwhile, and
    // the legacy blob must never overwrite fresher tokens.
    const [a, r] = await Promise.all([
      readKey(ACCESS_KEY),
      readKey(REFRESH_KEY),
    ]);
    if (a || r) {
      return { authToken: a ?? undefined, refreshToken: r ?? undefined };
    }
    return migrateLegacyTokens();
  });
}

/** Raccourci : access token courant (ou undefined). Mêmes erreurs que getTokens. */
export async function getAccessToken(): Promise<string | undefined> {
  return (await getTokens()).authToken;
}

/** Écrit les tokens fournis. N'efface JAMAIS sur undefined (voir clearTokens). */
export function setTokens(tokens: Tokens): Promise<void> {
  return withLock(async () => {
    if (tokens.authToken !== undefined) {
      await SecureStore.setItemAsync(
        ACCESS_KEY,
        tokens.authToken,
        storeOptions(),
      );
      // The fresh value now lives under the new key: drop the old one so a
      // stale token can never be migrated back over it.
      await deleteQuietly(OLD_ACCESS_KEY);
    }
    if (tokens.refreshToken !== undefined) {
      await SecureStore.setItemAsync(
        REFRESH_KEY,
        tokens.refreshToken,
        storeOptions(),
      );
      await deleteQuietly(OLD_REFRESH_KEY);
    }
  });
}

async function deleteQuietly(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, storeOptions());
  } catch {
    // Best-effort cleanup of a superseded key.
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
export function clearTokens(): Promise<void> {
  return withLock(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY, storeOptions()),
      SecureStore.deleteItemAsync(REFRESH_KEY, storeOptions()),
      // Pre-#582 keys too: otherwise a not-yet-migrated token would be
      // migrated back on the next read — a logout that does not log out.
      SecureStore.deleteItemAsync(OLD_ACCESS_KEY, storeOptions()),
      SecureStore.deleteItemAsync(OLD_REFRESH_KEY, storeOptions()),
      clearOfflineQueue(),
    ]);
  });
}
