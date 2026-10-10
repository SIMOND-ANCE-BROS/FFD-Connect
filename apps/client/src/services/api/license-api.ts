import * as FileSystem from "expo-file-system";
import {
  type FileSystemUploadType,
  readAsStringAsync as fsReadAsStringAsync,
} from "expo-file-system/legacy";
import { Platform } from "react-native";
import {
  appleWalletControllerCreateDownloadLink,
  type AppleWalletPassLinkDto,
} from "../../api/generated";
import { BACKEND_URL } from "../../config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { httpGet, httpPost } from "../../utils/httpInterceptor";
import { createLogger } from "../../utils/logger";

const logger = createLogger("LicenseApi");

export type LicenseRenewalStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";
export type LicenseRenewalDocumentType =
  | "MEDICAL_CERTIFICATE"
  | "LICENSE_CERTIFICATE";

export interface LicenseRenewalDocument {
  id: string;
  requestId: string;
  type: LicenseRenewalDocumentType;
  filePath: string;
  ocrData?: {
    isApte?: boolean;
    date?: string;
    doctorName?: string;
    licenseNumber?: string;
    name?: string;
    expiryDate?: string;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface LicenseRenewalRequest {
  id: string;
  userId: string;
  status: LicenseRenewalStatus;
  createdAt: string;
  updatedAt: string;
  documents: LicenseRenewalDocument[];
}

export type { AppleWalletPassLinkDto };

/**
 * Failure of the "Add to Apple Wallet" link request (#163).
 *
 * `message` is already written for the user (French); `status` is the HTTP
 * code, `undefined` when no response came back (network).
 */
export class AppleWalletLinkError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status: number | undefined) {
    super(message);
    this.name = "AppleWalletLinkError";
    this.status = status;
  }
}

const APPLE_WALLET_MESSAGES: Partial<Record<number, string>> = {
  404: "Aucune licence n'est associée à votre compte.",
  422: "Votre licence est expirée : renouvelez-la pour l'ajouter à Apple Wallet.",
  429: "Trop de tentatives. Patientez une minute avant de réessayer.",
  503: "L'ajout à Apple Wallet est momentanément indisponible. Réessayez plus tard.",
};

export const APPLE_WALLET_NETWORK_ERROR =
  "Connexion impossible. Vérifiez votre réseau et réessayez.";
export const APPLE_WALLET_GENERIC_ERROR =
  "L'ajout à Apple Wallet a échoué. Réessayez.";

/** Builds the user-facing error from the response status (absent = network). */
export function toAppleWalletLinkError(
  status: number | undefined,
): AppleWalletLinkError {
  const message =
    status === undefined
      ? APPLE_WALLET_NETWORK_ERROR
      : (APPLE_WALLET_MESSAGES[status] ?? APPLE_WALLET_GENERIC_ERROR);
  return new AppleWalletLinkError(message, status);
}

/** The only shape of `path` the app accepts: the one-time download route. */
const APPLE_WALLET_PATH =
  /^\/?(licenses\/wallet\/apple\/[A-Za-z0-9_-]{32,128})$/;

/**
 * Rebuilds the `.pkpass` download URL from the server's relative `path` and
 * the app's own configured API URL. The absolute `url` of the response is
 * deliberately ignored (defense in depth): Safari only ever opens our API
 * host, whatever a tampered or misconfigured response says.
 */
export function buildAppleWalletPassUrl(
  path: string,
  apiUrl: string = BACKEND_URL,
): string {
  const match = APPLE_WALLET_PATH.exec(path);
  if (!match || !/^https?:\/\//.test(apiUrl)) {
    throw new AppleWalletLinkError(APPLE_WALLET_GENERIC_ERROR, undefined);
  }
  return `${apiUrl.replace(/\/+$/, "")}/${match[1]}`;
}

export const LicenseApi = {
  /**
   * Asks for a short-lived download link (a few downloads at most) to the
   * Apple Wallet pass of the signed-in user's license (#163), and returns the
   * URL to open in the browser, rebuilt from the app's API URL.
   */
  async createAppleWalletPassUrl(): Promise<string> {
    let result: Awaited<
      ReturnType<typeof appleWalletControllerCreateDownloadLink>
    >;
    try {
      result = await appleWalletControllerCreateDownloadLink();
    } catch {
      throw toAppleWalletLinkError(undefined);
    }
    const status = result.response?.status;
    if (result.error !== undefined || result.data === undefined) {
      throw toAppleWalletLinkError(status);
    }
    return buildAppleWalletPassUrl(result.data.path);
  },

  async getMyLicense<T = unknown>(token: string): Promise<T> {
    return httpGet(`${BACKEND_URL}/licenses/my`, {
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: ERROR_MESSAGES.LOADING_FAILED,
      logErrors: true,
    });
  },

  async startRenewalRequest(token: string): Promise<LicenseRenewalRequest> {
    return httpPost<LicenseRenewalRequest>(
      `${BACKEND_URL}/licenses/renewal/start`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
        logErrors: true,
      },
    );
  },

  async getMyRenewalRequest(
    token: string,
  ): Promise<LicenseRenewalRequest | null> {
    const data = await httpGet<LicenseRenewalRequest | null>(
      `${BACKEND_URL}/licenses/renewal/my`,
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.LOADING_FAILED,
        logErrors: true,
      },
    );
    return data ?? null;
  },

  async uploadRenewalDocument(
    token: string,
    requestId: string,
    type: "MEDICAL_CERTIFICATE" | "LICENSE_CERTIFICATE",
    fileUri: string,
  ): Promise<LicenseRenewalRequest> {
    const uploadUrl = `${BACKEND_URL}/licenses/renewal/${requestId}/documents`;

    if (Platform.OS === "web") {
      const fileUriNorm = fileUri.replace("file://", "");
      const base64 = await fsReadAsStringAsync(fileUriNorm, {
        encoding: "base64",
      });
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray as unknown as string], {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      const formData = new FormData();
      formData.append("type", type);
      (
        formData as FormData & { append(n: string, v: Blob, f: string): void }
      ).append("document", blob, "document.jpg");

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(err.message ?? `Upload failed ${response.status}`);
      }
      return response.json() as Promise<LicenseRenewalRequest>;
    }

    const formData = new FormData();
    formData.append("type", type);
    formData.append("document", {
      uri: fileUri,
      type: "image/jpeg",
      name: "document.jpg",
    });

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(err.message ?? `Upload failed ${response.status}`);
    }
    return response.json() as Promise<LicenseRenewalRequest>;
  },

  async submitRenewalRequest(
    token: string,
    requestId: string,
  ): Promise<LicenseRenewalRequest> {
    return httpPost<LicenseRenewalRequest>(
      `${BACKEND_URL}/licenses/renewal/${requestId}/submit`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        errorMessage: ERROR_MESSAGES.OPERATION_FAILED,
        logErrors: true,
      },
    );
  },

  async renewLicense(token: string, certificateUri: string) {
    const uploadUrl = `${BACKEND_URL}/licenses/renew`;

    try {
      const fileUri = certificateUri.replace("file://", "");
      const base64 = await fsReadAsStringAsync(fileUri, {
        encoding: "base64",
      });

      if (Platform.OS === "web") {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray as unknown as string], {
          type: "image/jpeg",
          lastModified: Date.now(),
        });

        const webFormData = new FormData();
        (
          webFormData as FormData & {
            append(n: string, v: Blob, f: string): void;
          }
        ).append("certificate", blob, "certificate.jpg");

        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: webFormData,
        });

        if (response.status !== 200 && response.status !== 201) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        return (await response.json()) as unknown;
      } else {
        const uploadResult = await FileSystem.uploadAsync(uploadUrl, fileUri, {
          httpMethod: "POST",
          uploadType: 1 as FileSystemUploadType,
          fieldName: "certificate",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (uploadResult.status !== 200 && uploadResult.status !== 201) {
          throw new Error(`Upload failed with status ${uploadResult.status}`);
        }

        return JSON.parse(uploadResult.body) as Record<string, unknown>;
      }
    } catch (error) {
      logger.error("[LicenseApi] Renewal failed", error);
      throw error;
    }
  },
};
