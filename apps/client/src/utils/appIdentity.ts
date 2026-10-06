import * as Updates from "expo-updates";
import {
  APP_ENV_LABEL,
  APP_GIT_SHA,
  APP_RUNTIME_VERSION,
  APP_VERSION_LABEL,
  envLabel,
} from "../config";

/**
 * Ce qui tourne réellement sur l'appareil, avec les mêmes identifiants que
 * TestFlight / Play (version + build), les tags et releases GitHub (SHA git) et
 * EAS (canal, id d'OTA). Source unique de Réglages → Informations techniques et
 * des retours envoyés depuis l'app.
 */
export interface AppIdentity {
  /** « 1.0.0 (85) » */
  version: string;
  /** Variante, lue sur le canal OTA réel (repli : variable build-time). */
  environment: string;
  /** SHA git court, ou "inconnu". */
  code: string;
  /** Bundle JS en cours : OTA (id + date), intégré au build, ou Metro. */
  update: string;
  /** runtimeVersion abrégée : quelles OTA ce binaire peut recevoir. */
  otaCompatibility: string;
}

const SHORT = 7;

export function getAppIdentity(): AppIdentity {
  let update: string;
  if (!Updates.isEnabled) {
    update = "dev (Metro, pas d'OTA)";
  } else if (Updates.isEmbeddedLaunch || !Updates.updateId) {
    update = "intégrée au build (aucune OTA appliquée)";
  } else {
    const published = Updates.createdAt
      ? ` du ${Updates.createdAt.toLocaleString("fr-FR")}`
      : "";
    update = `OTA ${Updates.updateId.slice(0, 8)}${published}`;
  }
  const runtime = Updates.runtimeVersion ?? APP_RUNTIME_VERSION;

  return {
    version: APP_VERSION_LABEL || "inconnue",
    environment: Updates.channel ? envLabel(Updates.channel) : APP_ENV_LABEL,
    code: APP_GIT_SHA ? APP_GIT_SHA.slice(0, SHORT) : "inconnu",
    update,
    otaCompatibility: runtime ? runtime.slice(0, SHORT) : "inconnue",
  };
}

/** Une ligne, pour un ticket : « 1.0.0 (85) · Bêta (TestFlight) · 302fc8c · OTA 01a11091 … ». */
export function formatAppIdentityInline(id: AppIdentity = getAppIdentity()) {
  return [id.version, id.environment, id.code, id.update].join(" · ");
}
