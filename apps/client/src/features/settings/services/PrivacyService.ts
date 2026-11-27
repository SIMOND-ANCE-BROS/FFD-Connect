// Side-effect : configure le client OpenAPI généré (baseUrl + auth + refresh).
import "../../../api/client";
import {
  cacheDirectory,
  deleteAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { AppState, type NativeEventSubscription, Platform } from "react-native";
import {
  usersControllerDeleteMyAccount,
  usersControllerExportMyData,
} from "../../../api/generated/sdk.gen";
import { getTokens } from "../../../api/tokenStore";
import { isWrongPasswordRefusal } from "../../../api/wrongPassword";
import { onSessionEnd } from "../../../services/sessionCleanup";
import { AuthService } from "../../auth/services/AuthService";
import { createLogger } from "../../../utils/logger";

/**
 * Droits RGPD côté client (#424) — s'appuie sur les endpoints backend
 * GET /users/me/export et DELETE /users/me (PR #512).
 */

const logger = createLogger("PrivacyService");

const EXPORT_FILE_URI = `${cacheDirectory}ffd-connect-mes-donnees.json`;

/**
 * Minimum time between the share and the deferred Android purge, so the target
 * app (Drive, Quick Share…) can finish reading the content:// URI (#926).
 */
export const ANDROID_EXPORT_DELETE_DELAY_MS = 30_000;

let deferredDeleteSubscription: NativeEventSubscription | null = null;

function cancelDeferredExportDelete(): void {
  deferredDeleteSubscription?.remove();
  deferredDeleteSubscription = null;
}

/**
 * Android only (#926): purges the export the next time the app is back in the
 * foreground, once DELAY has elapsed since the share. Launch and session-end
 * purges stay as the safety net.
 */
function scheduleDeferredExportDelete(): void {
  cancelDeferredExportDelete();
  const sharedAt = Date.now();
  deferredDeleteSubscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    if (Date.now() - sharedAt < ANDROID_EXPORT_DELETE_DELAY_MS) return;
    void deleteExportFile(); // unsubscribes, never throws
  });
}

/**
 * Deletes the data export file from the cache (#912). Idempotent and never
 * throws: a missing file is the normal case, and a failed purge must break
 * neither the share flow nor the logout.
 */
export async function deleteExportFile(): Promise<void> {
  // The purge is happening anyway: a pending deferred purge is now moot.
  cancelDeferredExportDelete();
  // No file-system cache on web: nothing was ever written there.
  if (Platform.OS === "web") return;
  try {
    await deleteAsync(EXPORT_FILE_URI, { idempotent: true });
  } catch (error) {
    logger.warn("Could not delete the data export file", error);
  }
}

// A copy of the user's personal data must not outlive the session (#912).
// Covers an export whose post-share purge never ran (app killed while the
// share sheet was open) before another account signs in on the device.
onSessionEnd(deleteExportFile);

/**
 * Export RGPD (portabilité, art. 20) : télécharge les données personnelles,
 * les écrit en JSON dans le cache puis ouvre la feuille de partage iOS/Android
 * (AirDrop, Fichiers, mail…). Le fichier est supprimé dès la feuille fermée
 * (iOS) ou en cas d'échec ; sur Android, au prochain retour au premier plan
 * (≥ 30 s après le partage, #926), sinon au prochain lancement / fin de session.
 */
export async function exportAndShareMyData(): Promise<void> {
  const { data, error } = await usersControllerExportMyData();
  if (error || !data) {
    throw new Error("EXPORT_FAILED");
  }

  // A purge armed by a previous share must not delete the file this export is
  // about to rewrite while its target is still reading it (#926).
  cancelDeferredExportDelete();

  // Checked before writing: no personal data on disk when it cannot be shared.
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("SHARING_UNAVAILABLE");
  }

  try {
    await writeAsStringAsync(EXPORT_FILE_URI, JSON.stringify(data, null, 2));
    await Sharing.shareAsync(EXPORT_FILE_URI, {
      mimeType: "application/json",
      dialogTitle: "Exporter mes données FFD Connect",
      UTI: "public.json",
    });
  } catch (shareError) {
    await deleteExportFile();
    throw shareError;
  }

  // iOS resolves once the share sheet's activity is done with the file. On
  // Android the promise can resolve while the target (Drive, Quick Share…)
  // still reads the content:// URI in the background, so the file is kept
  // there and purged when the app is next foregrounded after a short delay
  // (#926), or at the next launch / session end at the latest.
  if (Platform.OS === "android") {
    scheduleDeferredExportDelete();
  } else {
    await deleteExportFile();
  }
}

/**
 * Droit à l'oubli (art. 17) : suppression définitive du compte.
 * Le backend exige le mot de passe courant — un token volé ne suffit pas.
 * Lève "WRONG_PASSWORD" (403 `code: WRONG_PASSWORD`, #937), "SESSION_ENDED"
 * (401 qui a mis fin à la session : compte déjà supprimé), "RATE_LIMITED"
 * (429 : trop d'essais, #1041) ou "DELETE_FAILED" (tout autre échec, 401
 * compris) sans rien effacer. Une fois
 * la suppression confirmée, efface toutes les données locales du compte
 * (#933) ; l'appelant n'a plus qu'à rafraîchir l'état d'auth (pas de logout).
 */
export async function deleteMyAccount(password: string): Promise<void> {
  const { error, response } = await usersControllerDeleteMyAccount({
    body: { password },
  });
  if (error) {
    // A wrong password is a 403 with its own code, not a 401: the session
    // stays valid and was not refreshed for nothing (#937).
    if (isWrongPasswordRefusal(response?.status, error)) {
      throw new Error("WRONG_PASSWORD");
    }
    // A 401 that ended the session means the account is already gone (a
    // retry after a lost deletion response): the refresh was refused with
    // ACCOUNT_DELETED and wiped this device (#935). Any other failure is
    // unconfirmed, not a wrong password.
    if (response?.status === 401 && (await sessionEnded())) {
      throw new Error("SESSION_ENDED");
    }
    // Too many tries (5/min per account, #1041): refused before anything
    // was checked or deleted.
    if (response?.status === 429) throw new Error("RATE_LIMITED");
    throw new Error("DELETE_FAILED");
  }
  // Not a logout (#933): e-mail, profile, tokens, licence snapshot, CGU
  // acceptance copy and device-side leftovers of the deleted account go,
  // biometrics or not. Device preferences only remain.
  await AuthService.endDeletedAccountSession();
}

/** Whether the session's refresh token is gone (unreadable store: kept). */
async function sessionEnded(): Promise<boolean> {
  try {
    const { refreshToken } = await getTokens();
    return !refreshToken;
  } catch {
    return false;
  }
}
