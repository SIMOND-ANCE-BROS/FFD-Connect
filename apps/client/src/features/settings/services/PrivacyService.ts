// Side-effect : configure le client OpenAPI généré (baseUrl + auth + refresh).
import "../../../api/client";
import {
  cacheDirectory,
  deleteAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import {
  usersControllerDeleteMyAccount,
  usersControllerExportMyData,
} from "../../../api/generated/sdk.gen";
import { getTokens } from "../../../api/tokenStore";
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
 * Deletes the data export file from the cache (#912). Idempotent and never
 * throws: a missing file is the normal case, and a failed purge must break
 * neither the share flow nor the logout.
 */
export async function deleteExportFile(): Promise<void> {
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
 * (iOS) ou en cas d'échec ; sinon au prochain lancement / fin de session (#912).
 */
export async function exportAndShareMyData(): Promise<void> {
  const { data, error } = await usersControllerExportMyData();
  if (error || !data) {
    throw new Error("EXPORT_FAILED");
  }

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
  // there and purged at the next launch or session end instead.
  if (Platform.OS !== "android") {
    await deleteExportFile();
  }
}

/**
 * Droit à l'oubli (art. 17) : suppression définitive du compte.
 * Le backend exige le mot de passe courant — un token volé ne suffit pas.
 * Lève "WRONG_PASSWORD" (401), "SESSION_ENDED" (401 qui a mis fin à la
 * session : compte déjà supprimé) ou "DELETE_FAILED" sans rien effacer. Une fois
 * la suppression confirmée, efface toutes les données locales du compte
 * (#933) ; l'appelant n'a plus qu'à rafraîchir l'état d'auth (pas de logout).
 */
export async function deleteMyAccount(password: string): Promise<void> {
  const { error, response } = await usersControllerDeleteMyAccount({
    body: { password },
  });
  if (error) {
    if (response?.status !== 401) throw new Error("DELETE_FAILED");
    // A wrong password keeps the session. A 401 that ended it means the
    // account is already gone (a retry after a lost deletion response): the
    // refresh was refused with ACCOUNT_DELETED and wiped this device (#935).
    throw new Error(
      (await sessionEnded()) ? "SESSION_ENDED" : "WRONG_PASSWORD",
    );
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
