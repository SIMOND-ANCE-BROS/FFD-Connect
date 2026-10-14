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
import { AppState } from "react-native";

import {
  TokenStoreUnavailableError,
  isTokenStoreUnavailable,
} from "./tokenStoreErrors";

/**
 * Keychain items readable in the background once the iPhone has been unlocked
 * once since boot (#582). The default (WHEN_UNLOCKED) made every request
 * issued while the device was locked — push, refresh, backend wake — fail
 * with "User interaction is not allowed". THIS_DEVICE_ONLY: the tokens never
 * travel in an encrypted backup / Quick Start migration — a restored refresh
 * token would race the original device on rotation.
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
  return {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
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

/**
 * Called when the store is PERMANENTLY unreadable while the app is in the
 * foreground (Android Keystore unable to decrypt, entitlement error…): the
 * session can never be used again, so it must end visibly rather than leave
 * a user "logged in" with every screen empty. Registered by sessionRefresh
 * (which owns the session-end side effects) to avoid an import cycle.
 */
let unreadableSessionHandler: (() => Promise<void>) | null = null;
export function setUnreadableSessionHandler(
  handler: (() => Promise<void>) | null,
): void {
  unreadableSessionHandler = handler;
}

/**
 * Policy for a NON-lock read failure (Keystore unable to decrypt, missing
 * entitlement, "system error" under load…). Several of these are transient
 * (iOS -34018 around launch or right after an update, Android Keystore
 * "not initialized" under load), and ending a valid session on one of them
 * is worse than the bug being fixed. Classifying errors by message as
 * "definitely permanent" is fragile across OS versions, so instead:
 *
 * 1. retry the read once after RETRY_DELAY_MS;
 * 2. a failure that survives the retry is reported to Sentry (once per app
 *    session) — never ends the session by itself;
 * 3. the session ends only if a SECOND, independent read also fails for good
 *    at least CONFIRM_AFTER_MS later, with the app in the foreground and no
 *    successful read in between (any success clears the suspicion).
 */
const RETRY_DELAY_MS = 500;
const CONFIRM_AFTER_MS = 5_000;

let unreadableReported = false;
/** Time of the first unconfirmed permanent failure, null when none. */
let firstPermanentFailureAt: number | null = null;
/** sessionGeneration at that first failure. */
let firstFailureGeneration = 0;
/**
 * Latch: the session is ended at most once per app session and the latch is
 * intentionally NEVER reset once the tokens were cleared — with a broken Keystore every later
 * read fails too, and resetting would loop logout → login → logout.
 */
let unreadableSessionEnded = false;
/**
 * Bumped by every setTokens/clearTokens. A login or refresh landing after
 * the failure means the store works again: the pending session end is
 * dropped.
 */
let sessionGeneration = 0;

function breadcrumb(message: string): void {
  try {
    Sentry.addBreadcrumb({
      category: "auth.tokenStore",
      level: "warning",
      message,
    });
  } catch {
    /* breadcrumb is best-effort */
  }
}

function onPermanentReadFailure(typed: TokenStoreUnavailableError): void {
  if (!unreadableReported) {
    // Once per app session; the message carries no token nor user data.
    unreadableReported = true;
    try {
      Sentry.captureException(typed, { tags: { tokenStore: "unreadable" } });
    } catch {
      /* reporting is best-effort */
    }
  }

  const now = Date.now();
  if (
    firstPermanentFailureAt === null ||
    // A login/refresh since the first failure: the store worked meanwhile,
    // this failure starts a new suspicion instead of confirming the old one.
    firstFailureGeneration !== sessionGeneration
  ) {
    firstPermanentFailureAt = now;
    firstFailureGeneration = sessionGeneration;
    return;
  }
  // Same burst (e.g. the access and refresh reads of one getTokens): not an
  // independent confirmation.
  if (now - firstPermanentFailureAt < CONFIRM_AFTER_MS) return;
  if (AppState.currentState !== "active") return;
  if (unreadableSessionEnded || !unreadableSessionHandler) return;

  unreadableSessionEnded = true;
  const handler = unreadableSessionHandler;
  const generation = sessionGeneration;
  // Fire-and-forget: the caller may hold the write lock, which clearing the
  // tokens needs — awaiting here would deadlock.
  void (async () => {
    try {
      const cleared = await withLock(async () => {
        if (generation !== sessionGeneration) return false;
        await deleteAllTokens();
        sessionGeneration += 1;
        return true;
      });
      if (!cleared) {
        // Superseded by a login/refresh: not a session end, so the latch is
        // released (the only case where it is).
        unreadableSessionEnded = false;
        return;
      }
      // Re-checked: a login may have landed while the handler was queued.
      if (generation + 1 === sessionGeneration) await handler();
    } catch {
      /* best-effort; the latch stays set on purpose (see above) */
    }
  })();
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Raw read, any failure turned into a typed error. A refusal because the
 * device is locked is NEVER "logged out" (#582); any other failure follows
 * the policy above.
 */
async function readKey(key: string): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(key, storeOptions());
    firstPermanentFailureAt = null;
    return value;
  } catch (error) {
    const typed = new TokenStoreUnavailableError(error);
    if (typed.locked) {
      breadcrumb("Token read refused: device locked");
      throw typed;
    }
    breadcrumb("Token read failed, retrying once");
    await delay(RETRY_DELAY_MS);
    try {
      const value = await SecureStore.getItemAsync(key, storeOptions());
      firstPermanentFailureAt = null;
      return value;
    } catch (retryError) {
      const final = new TokenStoreUnavailableError(retryError);
      if (!final.locked) onPermanentReadFailure(final);
      throw final;
    }
  }
}

/**
 * Reads one token: the new (AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY) key first,
 * then the old (WHEN_UNLOCKED) key, moving the value over once (#582).
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
  const [accessRead, refreshRead] = await Promise.allSettled([
    readToken(ACCESS_KEY, OLD_ACCESS_KEY),
    readToken(REFRESH_KEY, OLD_REFRESH_KEY),
  ]);
  if (accessRead.status === "rejected") throw accessRead.reason;
  const access = accessRead.value;
  let refresh: string | null;
  if (refreshRead.status === "fulfilled") {
    refresh = refreshRead.value;
  } else if (
    access &&
    isTokenStoreUnavailable(refreshRead.reason) &&
    refreshRead.reason.locked
  ) {
    // Access token readable (already migrated) but the not-yet-migrated
    // refresh token is locked: serve the request, skip the refresh (#582).
    return { authToken: access };
  } else {
    throw refreshRead.reason;
  }
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
    if (tokens.authToken !== undefined || tokens.refreshToken !== undefined) {
      // A login/refresh written successfully: the store works, and this
      // supersedes any pending "unreadable store" session end.
      sessionGeneration += 1;
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
    sessionGeneration += 1;
    await deleteAllTokens();
  });
}

/** clearTokens' body, for callers already holding the lock. */
async function deleteAllTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY, storeOptions()),
    SecureStore.deleteItemAsync(REFRESH_KEY, storeOptions()),
    // Pre-#582 keys too: otherwise a not-yet-migrated token would be
    // migrated back on the next read — a logout that does not log out.
    SecureStore.deleteItemAsync(OLD_ACCESS_KEY, storeOptions()),
    SecureStore.deleteItemAsync(OLD_REFRESH_KEY, storeOptions()),
    clearOfflineQueue(),
  ]);
}
