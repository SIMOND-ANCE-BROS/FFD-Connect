// Side-effect : configure le client OpenAPI généré (baseUrl + auth + refresh).
import "../../../api/client";
import { cacheDirectory, writeAsStringAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  usersControllerDeleteMyAccount,
  usersControllerExportMyData,
} from "../../../api/generated/sdk.gen";

/**
 * Droits RGPD côté client (#424) — s'appuie sur les endpoints backend
 * GET /users/me/export et DELETE /users/me (PR #512).
 */

/**
 * Export RGPD (portabilité, art. 20) : télécharge les données personnelles,
 * les écrit en JSON dans le cache puis ouvre la feuille de partage iOS/Android
 * (AirDrop, Fichiers, mail…).
 */
export async function exportAndShareMyData(): Promise<void> {
  const { data, error } = await usersControllerExportMyData();
  if (error || !data) {
    throw new Error("EXPORT_FAILED");
  }

  const fileUri = `${cacheDirectory}ffd-connect-mes-donnees.json`;
  await writeAsStringAsync(fileUri, JSON.stringify(data, null, 2));

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("SHARING_UNAVAILABLE");
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: "application/json",
    dialogTitle: "Exporter mes données FFD Connect",
    UTI: "public.json",
  });
}

/**
 * Droit à l'oubli (art. 17) : suppression définitive du compte.
 * Le backend exige le mot de passe courant — un token volé ne suffit pas.
 * Lève "WRONG_PASSWORD" (401) ou "DELETE_FAILED" ; l'appelant gère le logout.
 */
export async function deleteMyAccount(password: string): Promise<void> {
  const { error, response } = await usersControllerDeleteMyAccount({
    body: { password },
  });
  if (error) {
    throw new Error(
      response?.status === 401 ? "WRONG_PASSWORD" : "DELETE_FAILED",
    );
  }
}
